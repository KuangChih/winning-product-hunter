/**
 * Recovery for runs nobody is driving (a killed function, a broken hand-off between ticks):
 * the status poll and the cron use these to decide whether to run a tick themselves.
 */
import type { AnyDatabase } from "@/db/client";
import { abandonRun, type PipelineRunRow } from "./store";
import { MAX_RUN_AGE_MS, MAX_TICKS } from "./tick";

/** A running run without a lease holder and with no update for this long is stalled. */
export const STALLED_AFTER_MS = 45_000;

/** Nobody holds the lease (or it expired). */
export function isLeaseFree(run: PipelineRunRow, now: number): boolean {
  return !run.lockedUntil || run.lockedUntil.getTime() < now;
}

/** Running, nobody driving it, and quiet for `STALLED_AFTER_MS`: someone should run a tick. */
export function isStalled(run: PipelineRunRow, now: number): boolean {
  return (
    run.status === "running" &&
    isLeaseFree(run, now) &&
    now - run.updatedAt.getTime() > STALLED_AFTER_MS
  );
}

/**
 * Fails a run past its hard limits that nobody holds (a tick would fail it too, but a run that
 * used up its ticks can no longer be ticked). Returns true when it was failed.
 */
export async function expireRun(
  db: AnyDatabase,
  run: PipelineRunRow,
  now: number,
  { maxTicks = MAX_TICKS }: { maxTicks?: number } = {},
): Promise<boolean> {
  if (run.status !== "running" || !isLeaseFree(run, now)) return false;
  const reason =
    now - run.createdAt.getTime() > MAX_RUN_AGE_MS
      ? "Run exceeded 20 hours"
      : run.ticks >= maxTicks
        ? `Run exceeded ${maxTicks} ticks`
        : null;
  return reason ? abandonRun(db, run.id, reason) : false;
}
