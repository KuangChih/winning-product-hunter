/**
 * What the website's pipeline routes share (ADR-013): where the runner may run, whether the
 * start button works, the status JSON, and "run one tick, then hand the run to the next
 * function". No Next.js imports, so it is unit-tested directly; routes wrap it in `after()`.
 */
import type { AnyDatabase } from "@/db/client";
import { isCronConfigured } from "@/lib/internal-auth";
import { createLiveDeps, pipelineEgress, pipelineEnv } from "./live-deps";
import { toProgress, type PipelineProgress } from "./progress";
import {
  expireRun,
  isStalled,
  loadProgressInput,
  recordKickResult,
  runTick,
  tickBudgetMs,
  type PipelineRunRow,
  type RunnerDeps,
  type TickResult,
} from "./runner";
import { kickTick, type KickResult } from "./transport";

type Env = Record<string, string | undefined>;

/** Deployment environments that run their own copy of the pipeline (Vercel's `VERCEL_ENV`). */
const VERCEL_ENVS = new Set(["production", "preview", "development"]);

export type PipelineGate = null | "disabled" | "preview";

/**
 * Whether this deployment may run the pipeline: production on Vercel, or a local server.
 * Preview deployments would copy a running run with Neon branching and sweep Meta a second time
 * (`PIPELINE_ALLOW_PREVIEW=1` allows it); `PIPELINE_DISABLED=1` turns everything off (e2e).
 */
export function pipelineGate(env: Env = process.env): PipelineGate {
  if (env.PIPELINE_DISABLED === "1") return "disabled";
  if (env.VERCEL && env.VERCEL_ENV !== "production" && env.PIPELINE_ALLOW_PREVIEW !== "1") {
    return "preview";
  }
  return null;
}

/**
 * Whether this deployment may drive `run`: the deployment that created it, or any deployment for
 * a run of the CLI (a dead CLI run is resumed instead of blocking the button). Never a run of
 * another Vercel environment (a preview database branch copies production's rows).
 */
export function canDriveRun(run: Pick<PipelineRunRow, "env">, env: Env = process.env): boolean {
  return run.env === pipelineEnv(env) || !VERCEL_ENVS.has(run.env);
}

export type StartBlockedReason =
  "no_database" | "migrations" | "disabled" | "preview" | "site_password_required";

/** Why the start button cannot work here (null: it can). */
export function startBlockedReason(
  { configured, migrated }: { configured: boolean; migrated: boolean },
  env: Env = process.env,
): StartBlockedReason | null {
  const gate = pipelineGate(env);
  if (gate) return gate;
  // Fail closed (ADR-008): a public production site must not let anyone start sweeps.
  if (env.VERCEL_ENV === "production" && !env.SITE_PASSWORD) return "site_password_required";
  if (!configured) return "no_database";
  if (!migrated) return "migrations";
  return null;
}

type Nullable<T> = { [K in keyof T]: T[K] | null };

/** `GET /api/pipeline/status`. Progress fields are null when the database cannot be read. */
export interface PipelineStatus extends Nullable<PipelineProgress> {
  /** A database is configured (`DATABASE_URL`). */
  configured: boolean;
  /** "migrations": the tables do not exist yet. */
  setup: null | "migrations";
  /** The pipeline is turned off on this deployment (see `pipelineGate`). */
  disabled: boolean;
  /** The daily cron can run (`CRON_SECRET` is set). Never the secret itself. */
  cronConfigured: boolean;
  /** CJ discovery can run (`CJ_API_KEY` is set). Never the key itself. */
  cjConfigured: boolean;
  /** The official Meta Ad Library API step can run (`META_ACCESS_TOKEN` is set). Never the token. */
  metaApiConfigured: boolean;
  canStart: boolean;
  startBlockedReason: StartBlockedReason | null;
}

export function toStatus(
  progress: PipelineProgress | null,
  { configured, migrated }: { configured: boolean; migrated: boolean },
  env: Env = process.env,
): PipelineStatus {
  const blocked = startBlockedReason({ configured, migrated }, env);
  return {
    run: progress?.run ?? null,
    lastRun: progress?.lastRun ?? null,
    adLibrary: progress?.adLibrary ?? null,
    configured,
    setup: configured && !migrated ? "migrations" : null,
    disabled: pipelineGate(env) !== null,
    cronConfigured: isCronConfigured(env),
    cjConfigured: !!env.CJ_API_KEY?.trim(),
    metaApiConfigured: !!env.META_ACCESS_TOKEN?.trim(),
    canStart: blocked === null,
    startBlockedReason: blocked,
  };
}

export async function loadProgress(
  db: AnyDatabase,
  env: Env = process.env,
  now = Date.now(),
): Promise<PipelineProgress> {
  return toProgress(await loadProgressInput(db, { egress: pipelineEgress(env), now }));
}

/**
 * What a status poll or the cron should do about a running run: fail it if it is past its
 * limits, "resume" it (run a tick) if nobody has driven it for a while, else nothing.
 */
export async function watchdogAction(
  db: AnyDatabase,
  run: PipelineRunRow,
  env: Env = process.env,
  now = Date.now(),
): Promise<"none" | "expired" | "resume"> {
  if (run.status !== "running") return "none";
  // Failing a run past its limits is safe from any deployment (only when nobody holds it), so
  // a run of another environment cannot block the day's cron run forever.
  if (await expireRun(db, run, now)) return "expired";
  return canDriveRun(run, env) && isStalled(run, now) ? "resume" : "none";
}

/**
 * CSRF check of the start button: the browser's `Origin` must be this site's host. Requests
 * without an `Origin` (not from a browser form or fetch) are refused too.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

export const KICK_RETRY_DELAY_MS = 2_000;

export interface TickAndKickOptions {
  runId: number;
  /** Where to send the next tick (`resolveSelfOrigin`); null: no hand-off. */
  origin: string | null;
  env?: Env;
  deps?: RunnerDeps;
  budgetMs?: number;
  kick?: typeof kickTick;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs one tick of the run, and when the run is not finished hands it to the next function.
 * A failed hand-off is recorded on the run (`last_kick_error`); the status poll and the cron
 * resume it.
 */
export async function tickAndKick(
  db: AnyDatabase,
  {
    runId,
    origin,
    env = process.env,
    deps,
    budgetMs = tickBudgetMs(env),
    kick = kickTick,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: TickAndKickOptions,
): Promise<{ tick: TickResult; kick: KickResult | null }> {
  const tick = await runTick(db, deps ?? createLiveDeps(env), { runId, budgetMs });
  const units = "units" in tick ? ` (${tick.units} units)` : "";
  console.info(`[pipeline] run #${runId} tick: ${tick.kind}${units}`);
  if (tick.kind !== "continue") return { tick, kick: null };

  let result: KickResult = origin
    ? await kick({ origin, runId, env })
    : { ok: false, error: "No trusted origin to hand the next tick to", retryable: false };
  if (!result.ok && result.retryable && origin) {
    await sleep(KICK_RETRY_DELAY_MS);
    result = await kick({ origin, runId, env });
  }
  await recordKickResult(db, runId, result.ok ? null : result.error);
  if (!result.ok) console.warn(`[pipeline] run #${runId} hand-off failed: ${result.error}`);
  return { tick, kick: result };
}

/** Wraps background work so a failure is logged instead of becoming an unhandled rejection. */
export function logFailure(what: string, work: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    try {
      await work();
    } catch (err) {
      console.error(`[pipeline] ${what} failed:`, err);
    }
  };
}
