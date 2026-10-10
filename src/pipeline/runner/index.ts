/**
 * The resumable pipeline runner (ADR-013): pure logic over the database, no Next.js imports.
 * Routes, the cron and the CLI use these entry points.
 */
import type { AnyDatabase } from "@/db/client";
import type { ProgressInput } from "../progress";
import { AD_LIBRARY_PROVIDER, getBackoff, sweepsOnDay } from "./guards";
import { getLastFinishedRun, getLatestRun } from "./store";

export type { Clock, RunnerDeps, Wait } from "./deps";
export { driveRun, type DriveOptions } from "./drive";
export {
  AD_LIBRARY_PROVIDER,
  adLibraryAllowance,
  backoffMs,
  isAdLibraryBlock,
  shouldCronStart,
  sweepsOnDay,
} from "./guards";
export {
  DAILY_SWEEP_CAP,
  DEFAULT_RUN_OPTIONS,
  MAX_AD_REQUESTS_PER_RUN,
  MAX_CUSTOM_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  parseKeywords,
  parseRunOptions,
  RunOptionsError,
} from "./options";
export {
  abandonRun,
  createRun,
  getActiveRun,
  getLastFinishedRun,
  getLatestRun,
  getRun,
  recordKickResult,
  type PipelineRunRow,
} from "./store";
export {
  DEFAULT_TICK_BUDGET_MS,
  leaseSecondsFor,
  runTick,
  tickBudgetMs,
  type TickOptions,
  type TickResult,
} from "./tick";
export type { RunOptions, RunState, RunStatus, StepName, Trigger } from "./types";
export { expireRun, isLeaseFree, isStalled, STALLED_AFTER_MS } from "./watchdog";

/** Everything `toProgress` needs, read from the database. */
export async function loadProgressInput(
  db: AnyDatabase,
  { egress, now = Date.now() }: { egress: string; now?: number },
): Promise<ProgressInput> {
  const [latest, lastFinished, backoff, sweepsToday] = await Promise.all([
    getLatestRun(db),
    getLastFinishedRun(db),
    getBackoff(db, AD_LIBRARY_PROVIDER, egress),
    sweepsOnDay(db, new Date(now)),
  ]);
  return { latest, lastFinished, backoff, sweepsToday, now };
}
