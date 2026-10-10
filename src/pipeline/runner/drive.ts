import type { AnyDatabase } from "@/db/client";
import type { RunnerDeps } from "./deps";
import { getRun, type PipelineRunRow } from "./store";
import { MAX_TICKS, realClock, runTick, type TickResult } from "./tick";
import { expireRun } from "./watchdog";

export interface DriveOptions {
  /** Per-tick soft budget; Infinity (default) runs to the end in one tick. */
  budgetMs?: number;
  maxTicks?: number;
  /** How long to wait before retrying when another process holds the run. */
  busyWaitMs?: number;
  /** Give up after waiting this long in total for another holder. */
  maxBusyWaitMs?: number;
  onTick?(result: TickResult, tick: number): void;
}

/**
 * Drives a run to the end, tick after tick, in this process (CLI and tests). Waits while
 * another process holds the run, and takes it over once that lease expires.
 */
export async function driveRun(
  db: AnyDatabase,
  deps: RunnerDeps,
  runId: number,
  {
    budgetMs = Infinity,
    maxTicks = MAX_TICKS,
    busyWaitMs = 15_000,
    maxBusyWaitMs = 15 * 60_000,
    onTick,
  }: DriveOptions = {},
): Promise<PipelineRunRow> {
  const clock = deps.clock ?? realClock;
  let waited = 0;
  for (let tick = 1; ; tick++) {
    const result = await runTick(db, deps, { runId, budgetMs, maxTicks });
    onTick?.(result, tick);
    if (result.kind === "finished" || result.kind === "not_active") break;
    if (result.kind === "continue") continue;
    // busy / lost_lease: someone else holds it (or held it and died).
    const run = await getRun(db, runId);
    if (!run || run.status !== "running") break;
    if (await expireRun(db, run, clock.now(), { maxTicks })) break;
    if (waited >= maxBusyWaitMs) {
      throw new Error(`Pipeline run #${runId} is held by another process`);
    }
    await clock.sleep(busyWaitMs);
    waited += busyWaitMs;
  }
  const run = await getRun(db, runId);
  if (!run) throw new Error(`Pipeline run #${runId} not found`);
  return run;
}
