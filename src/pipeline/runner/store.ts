/**
 * Database operations of the pipeline runner. Every operation is a single statement (safe on
 * Neon's HTTP driver, which has no interactive transactions) and uses the database clock for
 * leases, so machines with different clocks agree on who holds a run.
 */
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { ingestionRuns, pipelineRuns, pipelineStage } from "@/db/schema";
import type { FetchedItem } from "@/ingestion/types";
import { initialState, fromStaged, toStaged } from "./state";
import type { RunOptions, RunState, RunStatus, Trigger } from "./types";

export type PipelineRunRow = typeof pipelineRuns.$inferSelect;

const leaseFree = () =>
  or(isNull(pipelineRuns.lockedUntil), lt(pipelineRuns.lockedUntil, sql`now()`));

/**
 * Creates a running run, or returns the active one (`created: false`): at most one run is
 * active at a time (partial unique index), so a double click or two tabs share one run.
 */
export async function createRun(
  db: AnyDatabase,
  opts: { trigger: Trigger; options: RunOptions; env: string; now?: Date },
): Promise<{ run: PipelineRunRow; created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [run] = await db
      .insert(pipelineRuns)
      .values({
        trigger: opts.trigger,
        env: opts.env,
        options: opts.options,
        state: initialState(opts.now ?? new Date()),
      })
      .onConflictDoNothing()
      .returning();
    if (run) return { run, created: true };
    const active = await getActiveRun(db);
    // The active run may have finished in between: try again.
    if (active) return { run: active, created: false };
  }
  throw new Error("Could not create a pipeline run");
}

export async function getRun(db: AnyDatabase, runId: number): Promise<PipelineRunRow | null> {
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  return run ?? null;
}

export async function getActiveRun(db: AnyDatabase): Promise<PipelineRunRow | null> {
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.status, "running"));
  return run ?? null;
}

export async function getLatestRun(db: AnyDatabase): Promise<PipelineRunRow | null> {
  const [run] = await db
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.createdAt), desc(pipelineRuns.id))
    .limit(1);
  return run ?? null;
}

export async function getLastFinishedRun(db: AnyDatabase): Promise<PipelineRunRow | null> {
  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(ne(pipelineRuns.status, "running"))
    .orderBy(desc(pipelineRuns.finishedAt), desc(pipelineRuns.id))
    .limit(1);
  return run ?? null;
}

/**
 * Takes the run's lease if nobody holds it (or the holder's lease expired) and counts a tick.
 * Returns the row, or null when the run is held, finished or missing.
 */
export async function acquireLease(
  db: AnyDatabase,
  runId: number,
  token: string,
  leaseSeconds: number,
): Promise<PipelineRunRow | null> {
  const [run] = await db
    .update(pipelineRuns)
    .set({
      lockToken: token,
      lockedUntil: sql`now() + ${Math.ceil(leaseSeconds)}::int * interval '1 second'`,
      ticks: sql`${pipelineRuns.ticks} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.status, "running"), leaseFree()))
    .returning();
  return run ?? null;
}

/**
 * Saves the state while still holding the lease (fencing): false means another process took
 * the run over, and the caller must stop at once. `renewSeconds` extends the lease.
 */
export async function persistState(
  db: AnyDatabase,
  runId: number,
  token: string,
  state: RunState,
  { renewSeconds }: { renewSeconds?: number } = {},
): Promise<boolean> {
  const rows = await db
    .update(pipelineRuns)
    .set({
      state,
      adLibraryRequests: state.adLibrary.requests,
      updatedAt: sql`now()`,
      ...(renewSeconds
        ? { lockedUntil: sql`now() + ${Math.ceil(renewSeconds)}::int * interval '1 second'` }
        : {}),
    })
    .where(
      and(
        eq(pipelineRuns.id, runId),
        eq(pipelineRuns.lockToken, token),
        sql`${pipelineRuns.lockedUntil} > now()`,
      ),
    )
    .returning({ id: pipelineRuns.id });
  return rows.length > 0;
}

/** Extends the lease while still holding it (heartbeat of a long unit); false when lost. */
export async function renewLease(
  db: AnyDatabase,
  runId: number,
  token: string,
  leaseSeconds: number,
): Promise<boolean> {
  const rows = await db
    .update(pipelineRuns)
    .set({ lockedUntil: sql`now() + ${Math.ceil(leaseSeconds)}::int * interval '1 second'` })
    .where(
      and(
        eq(pipelineRuns.id, runId),
        eq(pipelineRuns.lockToken, token),
        sql`${pipelineRuns.lockedUntil} > now()`,
      ),
    )
    .returning({ id: pipelineRuns.id });
  return rows.length > 0;
}

/** Saves the state and gives the lease back so the next tick can start right away. */
export async function releaseLease(
  db: AnyDatabase,
  runId: number,
  token: string,
  state: RunState,
): Promise<boolean> {
  const rows = await db
    .update(pipelineRuns)
    .set({
      state,
      adLibraryRequests: state.adLibrary.requests,
      lockToken: null,
      lockedUntil: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.lockToken, token)))
    .returning({ id: pipelineRuns.id });
  return rows.length > 0;
}

/** Marks the run finished (only by the lease holder). */
export async function completeRun(
  db: AnyDatabase,
  runId: number,
  token: string,
  state: RunState,
  status: Exclude<RunStatus, "running">,
  error?: string,
): Promise<boolean> {
  const rows = await db
    .update(pipelineRuns)
    .set({
      state,
      status,
      adLibraryRequests: state.adLibrary.requests,
      error: error?.slice(0, 2000) ?? null,
      lockToken: null,
      lockedUntil: null,
      updatedAt: sql`now()`,
      finishedAt: sql`now()`,
    })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.lockToken, token)))
    .returning({ id: pipelineRuns.id });
  return rows.length > 0;
}

/**
 * Fails a running run nobody holds (e.g. a process died and the run is past its limits, or the
 * local CLI replaces an interrupted run). Closes its ingestion rows and staged items.
 */
export async function abandonRun(db: AnyDatabase, runId: number, reason: string): Promise<boolean> {
  const rows = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      error: reason.slice(0, 2000),
      lockToken: null,
      lockedUntil: null,
      updatedAt: sql`now()`,
      finishedAt: sql`now()`,
    })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.status, "running"), leaseFree()))
    .returning({ id: pipelineRuns.id });
  if (rows.length === 0) return false;
  await closeOpenIngestionRuns(db, runId, reason);
  await deleteStage(db, runId);
  return true;
}

/** Closes the run's ingestion_runs rows still marked running. */
export async function closeOpenIngestionRuns(
  db: AnyDatabase,
  runId: number,
  error: string,
): Promise<number> {
  const rows = await db
    .update(ingestionRuns)
    .set({ status: "failed", finishedAt: sql`now()`, error: error.slice(0, 2000) })
    .where(and(eq(ingestionRuns.pipelineRunId, runId), eq(ingestionRuns.status, "running")))
    .returning({ id: ingestionRuns.id });
  return rows.length;
}

/** Remembers why the last hand-off to the next tick failed (null clears it). */
export async function recordKickResult(
  db: AnyDatabase,
  runId: number,
  error: string | null,
): Promise<void> {
  await db
    .update(pipelineRuns)
    .set({ lastKickError: error?.slice(0, 500) ?? null })
    .where(eq(pipelineRuns.id, runId));
}

// --- Staged Ad Library results ---------------------------------------------------------------

export type StageBucket = "keyword" | "advertiser";

export async function upsertStage(
  db: AnyDatabase,
  runId: number,
  bucket: StageBucket,
  idx: number,
  items: FetchedItem[],
  failure: string | null,
): Promise<void> {
  const values = { items: items.map(toStaged), failure };
  await db
    .insert(pipelineStage)
    .values({ runId, bucket, idx, ...values })
    .onConflictDoUpdate({
      target: [pipelineStage.runId, pipelineStage.bucket, pipelineStage.idx],
      set: values,
    });
}

/** What one request staged (null: not staged yet), for a retry that must not send it again. */
export async function getStagedRequest(
  db: AnyDatabase,
  runId: number,
  bucket: StageBucket,
  idx: number,
): Promise<{ ads: number; failure: string | null } | null> {
  const [row] = await db
    .select({ items: pipelineStage.items, failure: pipelineStage.failure })
    .from(pipelineStage)
    .where(
      and(
        eq(pipelineStage.runId, runId),
        eq(pipelineStage.bucket, bucket),
        eq(pipelineStage.idx, idx),
      ),
    );
  if (!row) return null;
  return { ads: row.items.filter((i) => i.kind === "ad").length, failure: row.failure };
}

/** Staged items of a bucket in request order, and the first failure (the sweep ended there). */
export async function loadStage(
  db: AnyDatabase,
  runId: number,
  bucket: StageBucket,
): Promise<{ items: FetchedItem[]; failure: string | null; requests: number }> {
  const rows = await db
    .select({ items: pipelineStage.items, failure: pipelineStage.failure })
    .from(pipelineStage)
    .where(and(eq(pipelineStage.runId, runId), eq(pipelineStage.bucket, bucket)))
    .orderBy(asc(pipelineStage.idx));
  return {
    items: rows.flatMap((r) => r.items.map(fromStaged)),
    failure: rows.find((r) => r.failure)?.failure ?? null,
    requests: rows.length,
  };
}

export async function deleteStage(db: AnyDatabase, runId: number): Promise<void> {
  await db.delete(pipelineStage).where(eq(pipelineStage.runId, runId));
}

/** Staged items of runs that are no longer running (left by a run that was abandoned). */
export async function deleteOrphanStage(db: AnyDatabase): Promise<void> {
  const finished = db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(ne(pipelineRuns.status, "running"));
  await db.delete(pipelineStage).where(inArray(pipelineStage.runId, finished));
}
