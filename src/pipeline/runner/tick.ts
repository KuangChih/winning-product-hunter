/**
 * One tick: take the run's lease, run units until the time budget is used, save, give the lease
 * back. The web (Vercel functions, 300 s each), the daily cron and the CLI all drive runs with
 * ticks; the CLI simply has no budget.
 */
import { randomUUID } from "node:crypto";
import type { AnyDatabase } from "@/db/client";
import { defaultSleep } from "@/ingestion/http";
import type { Clock, RunnerDeps } from "./deps";
import {
  failUnit,
  fastForward,
  finalStatus,
  initialState,
  isCompatibleState,
  upgradeState,
  setStep,
  STEP_OF_UNIT,
} from "./state";
import {
  acquireLease,
  closeOpenIngestionRuns,
  completeRun,
  deleteStage,
  getRun,
  persistState,
  releaseLease,
  renewLease,
} from "./store";
import type { RunState, RunStatus, UnitName } from "./types";
import { LostLeaseError, UNITS } from "./units";

/** Soft budget: no unit starts unless its worst case fits before this (Vercel functions). */
export const DEFAULT_TICK_BUDGET_MS = 200_000;
/** In-flight I/O is aborted this long after the soft budget… */
export const HARD_ABORT_AFTER_BUDGET_MS = 50_000;
/** …and the lease outlives the hard abort by this much, so a killed tick never overlaps. */
export const LEASE_AFTER_HARD_ABORT_MS = 70_000;
/** Lease of a tick without a budget (CLI); renewed on every save and by a heartbeat. */
export const UNBOUNDED_LEASE_SECONDS = 320;
/** How often a tick without a budget renews its lease while a long unit (e.g. score) runs. */
export const HEARTBEAT_MS = 60_000;
export const MAX_TICKS = 40;
/** Wrap up (merge → score) when this few ticks are left. */
export const WRAP_UP_TICKS = 5;
/** A unit interrupted more often than this is skipped. */
export const MAX_UNIT_ATTEMPTS = 3;
/** No unit finished for this long: skip to the wrap-up. */
export const STALL_MS = 2 * 3_600_000;
/** A run older than this is failed outright. */
export const MAX_RUN_AGE_MS = 20 * 3_600_000;

export const realClock: Clock = { now: () => Date.now(), sleep: defaultSleep };

/** `PIPELINE_TICK_BUDGET_MS` overrides the soft budget (e.g. a plan with shorter functions). */
export function tickBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PIPELINE_TICK_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TICK_BUDGET_MS;
}

export function leaseSecondsFor(budgetMs: number): number {
  if (!Number.isFinite(budgetMs)) return UNBOUNDED_LEASE_SECONDS;
  return Math.ceil((budgetMs + HARD_ABORT_AFTER_BUDGET_MS + LEASE_AFTER_HARD_ABORT_MS) / 1000);
}

export interface TickOptions {
  runId: number;
  /** Soft budget (ms); Infinity = run to the end (CLI). The first unit always runs. */
  budgetMs?: number;
  /** When in-flight I/O is aborted (default: budget + 50 s). */
  hardAbortMs?: number;
  maxTicks?: number;
  /** Lease renewal interval of a tick without a budget (tests). */
  heartbeatMs?: number;
}

export type TickResult =
  | { kind: "finished"; status: Exclude<RunStatus, "running">; units: number }
  | { kind: "continue"; units: number }
  /** Another process holds the run. */
  | { kind: "busy" }
  /** The run is finished or does not exist. */
  | { kind: "not_active" }
  /** Another process took the run over mid-tick; this one stopped. */
  | { kind: "lost_lease"; units: number };

/** Starts the in-flight marker of the unit at the cursor (a retry keeps its observation time). */
export function beginUnit(s: RunState, now: number): RunState {
  const key = unitKey(s);
  const same = s.unit && s.unit.name === s.cursor && s.unit.key === key;
  const unit = same
    ? { ...s.unit!, attempts: s.unit!.attempts + 1 }
    : { name: s.cursor, key, observedAt: new Date(now).toISOString(), attempts: 1 };
  const step = STEP_OF_UNIT[s.cursor];
  const next = { ...s, unit };
  return step && next.steps[step].status === "pending"
    ? setStep(next, step, { status: "running" })
    : next;
}

function unitKey(s: RunState): string {
  const planned = (v: unknown) => (v === null ? "plan" : "");
  switch (s.cursor) {
    case "discover":
      return `${planned(s.plan.keywordRequests)}${s.progress.keyword}`;
    case "advertisers":
      return `${planned(s.plan.advertiserRequests)}${s.progress.advertiser}`;
    case "collect":
      return `${planned(s.plan.collect)}${s.progress.collect}`;
    case "stores":
      return `${planned(s.plan.stores)}${s.progress.stores}`;
    case "hash":
      return String(s.progress.hashAttempted);
    case "store_redirects":
      return `${s.plan.redirects ? "" : "plan"}${s.progress.redirects ?? 0}`;
    case "cj_freight":
      return String(s.progress.cjFreight ?? 0);
    case "listing_hash":
      return `${s.progress.galleryHashAttempted ?? 0}-${s.progress.listingHashAttempted ?? 0}`;
    default:
      return "";
  }
}

export async function runTick(
  db: AnyDatabase,
  deps: RunnerDeps,
  opts: TickOptions,
): Promise<TickResult> {
  const clock = deps.clock ?? realClock;
  const budgetMs = opts.budgetMs ?? Infinity;
  const bounded = Number.isFinite(budgetMs);
  const leaseSeconds = leaseSecondsFor(budgetMs);
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const token = randomUUID();

  const row = await acquireLease(db, opts.runId, token, leaseSeconds);
  if (!row) {
    const run = await getRun(db, opts.runId);
    return run?.status === "running" ? { kind: "busy" } : { kind: "not_active" };
  }

  const renew = bounded ? {} : { renewSeconds: leaseSeconds };
  let saved: RunState;
  const save = async (st: RunState) => {
    if (!(await persistState(db, opts.runId, token, st, renew))) throw new LostLeaseError();
    saved = st;
  };
  const fail = async (st: RunState, error: string): Promise<TickResult> => {
    await closeOpenIngestionRuns(db, opts.runId, error);
    await deleteStage(db, opts.runId);
    if (!(await completeRun(db, opts.runId, token, st, "failed", error))) {
      return { kind: "lost_lease", units: 0 };
    }
    return { kind: "finished", status: "failed", units: 0 };
  };

  // Limits: incompatible state, age, ticks, stalls.
  let s: RunState = isCompatibleState(row.state)
    ? upgradeState(row.state)
    : fastForward(initialState(row.createdAt, new Date(clock.now())), "incompatible_state");
  saved = s;
  const t0 = clock.now();
  if (t0 - row.createdAt.getTime() > MAX_RUN_AGE_MS) {
    return fail(s, "Run exceeded 20 hours");
  }
  if (row.ticks > maxTicks) return fail(s, `Run exceeded ${maxTicks} ticks`);
  if (row.ticks > maxTicks - WRAP_UP_TICKS) s = fastForward(s, "tick_limit");
  if (t0 - new Date(s.progressAt).getTime() > STALL_MS) s = fastForward(s, "stalled");

  const softStop = t0 + budgetMs;
  const ac = new AbortController();
  const timer = bounded
    ? setTimeout(
        () => ac.abort(new Error("Tick time budget exceeded")),
        opts.hardAbortMs ?? budgetMs + HARD_ABORT_AFTER_BUDGET_MS,
      )
    : undefined;
  // Without a budget a unit may take longer than the lease (merge, match and score on a large
  // database do not save while they run): keep the lease alive, and stop if it was taken.
  let leaseLost = false;
  const heartbeat = bounded
    ? undefined
    : setInterval(() => {
        renewLease(db, opts.runId, token, leaseSeconds).then(
          (ok) => {
            if (!ok && !leaseLost) {
              leaseLost = true;
              ac.abort(new LostLeaseError());
            }
          },
          () => undefined, // a failed renewal is retried on the next beat; saves renew too
        );
      }, opts.heartbeatMs ?? HEARTBEAT_MS);
  let units = 0;
  try {
    while (s.cursor !== "done") {
      const cursor: Exclude<UnitName, "done"> = s.cursor;
      const def = UNITS[cursor];
      if (units > 0 && (ac.signal.aborted || clock.now() + def.worstMs > softStop)) break;
      s = beginUnit(s, clock.now());
      const unitSignal = ac.signal;
      const ctx = {
        db,
        deps,
        clock,
        runId: opts.runId,
        runCreatedAt: row.createdAt,
        options: row.options,
        state: s,
        signal: unitSignal,
        softStop,
        observedAt: new Date(s.unit!.observedAt),
        save,
      };
      if (s.unit!.attempts > MAX_UNIT_ATTEMPTS) {
        const skipped = new Error(`Interrupted ${MAX_UNIT_ATTEMPTS} times; skipped`);
        try {
          s = def.poison ? await def.poison(ctx, cursor) : failUnit(s, cursor, skipped);
        } catch (err) {
          if (err instanceof LostLeaseError) throw err;
          // Never let a failing skip hold the run: the step fails and the run moves on.
          s = failUnit(s, cursor, err);
        }
      } else {
        await save(s); // write-ahead marker
        try {
          s = await def.run(ctx);
        } catch (err) {
          if (err instanceof LostLeaseError || leaseLost) throw new LostLeaseError();
          if (unitSignal.aborted) {
            // Out of time: the unit stays in flight and the next tick retries it.
            await releaseLease(db, opts.runId, token, saved!);
            return { kind: "continue", units };
          }
          s = failUnit(s, cursor, err);
        }
      }
      if (leaseLost) throw new LostLeaseError();
      units++;
      s = { ...s, unit: null, progressAt: new Date(clock.now()).toISOString() };
      if (s.cursor === "done") {
        const status = finalStatus(s);
        if (!(await completeRun(db, opts.runId, token, s, status))) {
          return { kind: "lost_lease", units };
        }
        return { kind: "finished", status, units };
      }
      await save(s);
    }
    if (s.cursor === "done") {
      // Only when the saved state was already done (the process died before completing it).
      const status = finalStatus(s);
      if (!(await completeRun(db, opts.runId, token, s, status))) {
        return { kind: "lost_lease", units };
      }
      return { kind: "finished", status, units };
    }
    await releaseLease(db, opts.runId, token, s);
    return { kind: "continue", units };
  } catch (err) {
    if (err instanceof LostLeaseError) return { kind: "lost_lease", units };
    throw err;
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
  }
}
