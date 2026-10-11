/**
 * Collection guards (ADR-006, ADR-013): Meta back-off per egress after a block, and the daily
 * sweep cap.
 */
import { and, count, eq, gt, gte, lt, ne, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { pipelineRuns, sourceBackoff } from "@/db/schema";
import {
  AdLibraryBlockedError,
  AdLibraryResponseError,
} from "@/ingestion/sources/meta-ad-library-web";
import { adLibraryFailureKind, isBlockKind } from "@/ingestion/sources/meta-ad-library-failure";
import { HttpError } from "@/ingestion/http";
import { DAILY_SWEEP_CAP } from "./options";
import type { AdLibraryPlan } from "./types";

export const AD_LIBRARY_PROVIDER = "ad_library_web";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** First back-off after a block; doubles on every further block… */
export const BACKOFF_FIRST_HOURS = 6;
/** …up to this long. A successful request resets it. */
export const BACKOFF_MAX_HOURS = 7 * 24;

/** Back-off after the n-th block in a row (1-based): 6 h, 12 h, 24 h … at most 7 days. */
export function backoffMs(strikes: number): number {
  return Math.min(BACKOFF_FIRST_HOURS * 2 ** Math.max(0, strikes - 1), BACKOFF_MAX_HOURS) * HOUR;
}

/** Meta refused us (CAPTCHA, login wall, 403/429): stop and back off. */
export function isAdLibraryBlock(err: unknown): boolean {
  return (
    err instanceof AdLibraryBlockedError ||
    (err instanceof HttpError && (err.status === 403 || err.status === 429))
  );
}

/**
 * Meta served a page we could not use without refusing us (no embedded results, unreadable
 * results). Not a block, so no egress back-off: the run sends no more Meta requests, and the
 * daily sweep cap (3 runs, each stopping at its first such page) bounds the requests to a few
 * a day while the cause is looked into.
 */
export function isAdLibraryStop(err: unknown): boolean {
  return err instanceof AdLibraryResponseError && !isAdLibraryBlock(err);
}

/** The same for a stored failure message (a retried request reuses its staged answer). */
export function isAdLibraryStopMessage(message: string): boolean {
  const kind = adLibraryFailureKind(message);
  return kind !== null && !isBlockKind(kind);
}

export async function getBackoff(db: AnyDatabase, provider: string, egress: string) {
  const [row] = await db
    .select()
    .from(sourceBackoff)
    .where(and(eq(sourceBackoff.provider, provider), eq(sourceBackoff.egress, egress)));
  return row ?? null;
}

/** Records a block: the next back-off is twice the previous one (see `backoffMs`). */
export async function recordBlock(
  db: AnyDatabase,
  provider: string,
  egress: string,
  reason: string,
  at: Date,
): Promise<Date> {
  const iso = at.toISOString();
  const [row] = await db
    .insert(sourceBackoff)
    .values({
      provider,
      egress,
      strikes: 1,
      until: new Date(at.getTime() + backoffMs(1)),
      reason: reason.slice(0, 500),
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [sourceBackoff.provider, sourceBackoff.egress],
      set: {
        strikes: sql`${sourceBackoff.strikes} + 1`,
        until: sql`${iso}::timestamptz + least(${BACKOFF_FIRST_HOURS} * power(2, ${sourceBackoff.strikes}), ${BACKOFF_MAX_HOURS}) * interval '1 hour'`,
        reason: reason.slice(0, 500),
        updatedAt: at,
      },
    })
    .returning({ until: sourceBackoff.until });
  return row.until;
}

/** A request went through: forget earlier blocks of this egress. */
export async function clearBackoff(db: AnyDatabase, provider: string, egress: string) {
  await db
    .delete(sourceBackoff)
    .where(and(eq(sourceBackoff.provider, provider), eq(sourceBackoff.egress, egress)));
}

export function utcDayStart(t: Date): Date {
  return new Date(Math.floor(t.getTime() / DAY) * DAY);
}

/** Runs created on `day` (UTC) that sent at least one Meta request: today's sweeps. */
export async function sweepsOnDay(
  db: AnyDatabase,
  day: Date,
  excludeRunId?: number,
): Promise<number> {
  const start = utcDayStart(day);
  const [row] = await db
    .select({ n: count() })
    .from(pipelineRuns)
    .where(
      and(
        gte(pipelineRuns.createdAt, start),
        lt(pipelineRuns.createdAt, new Date(start.getTime() + DAY)),
        gt(pipelineRuns.adLibraryRequests, 0),
        excludeRunId === undefined ? undefined : ne(pipelineRuns.id, excludeRunId),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Whether a run may sweep Meta now: not while this egress is backing off from a block, and at
 * most `DAILY_SWEEP_CAP` sweeps per UTC day (`day`).
 */
export async function adLibraryAllowance(
  db: AnyDatabase,
  opts: { egress: string; now: Date; day?: Date; excludeRunId?: number },
): Promise<AdLibraryPlan & { strikes: number }> {
  const [backoff, sweepsBefore] = await Promise.all([
    getBackoff(db, AD_LIBRARY_PROVIDER, opts.egress),
    sweepsOnDay(db, opts.day ?? opts.now, opts.excludeRunId),
  ]);
  const strikes = backoff?.strikes ?? 0;
  if (backoff && backoff.until.getTime() > opts.now.getTime()) {
    return {
      allowed: false,
      reason: "backoff",
      until: backoff.until.toISOString(),
      sweep: null,
      sweepsBefore,
      strikes,
    };
  }
  if (sweepsBefore >= DAILY_SWEEP_CAP) {
    return { allowed: false, reason: "daily_cap", until: null, sweep: null, sweepsBefore, strikes };
  }
  return {
    allowed: true,
    reason: null,
    until: null,
    sweep: sweepsBefore + 1,
    sweepsBefore,
    strikes,
  };
}

/**
 * Whether the daily cron should start a run now (`now`'s UTC day). Vercel calls the cron several
 * times a day (the later calls are for recovery): only the first one that finds the day not yet
 * swept starts a run. A cron run that failed does not count, so the next call retries it.
 */
export async function shouldCronStart(
  db: AnyDatabase,
  now: Date,
): Promise<{ start: true } | { start: false; reason: "cron_ran_today" | "swept_today" }> {
  const start = utcDayStart(now);
  const [cron] = await db
    .select({ n: count() })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.trigger, "cron"),
        ne(pipelineRuns.status, "failed"),
        gte(pipelineRuns.createdAt, start),
        lt(pipelineRuns.createdAt, new Date(start.getTime() + DAY)),
      ),
    );
  if (Number(cron?.n ?? 0) > 0) return { start: false, reason: "cron_ran_today" };
  if ((await sweepsOnDay(db, now)) > 0) return { start: false, reason: "swept_today" };
  return { start: true };
}
