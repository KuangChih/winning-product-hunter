import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { ingestionRuns, pipelineRuns, signalSnapshots, sourceItems } from "@/db/schema";
import { sortByMarketPriority, toCountries } from "@/lib/markets";
import type { FetchContext, FetchedItem, SourceAdapter } from "./types";

export interface IngestionResult {
  runId: number;
  status: "succeeded" | "failed";
  itemsFetched: number;
  error?: string;
}

export const INTERRUPTED_RUN_ERROR = "Interrupted: the process stopped before recording a result";

/** What identifies a source in ingestion_runs. */
export type AdapterMeta = Pick<SourceAdapter, "source" | "provider">;

/** Opens an ingestion_runs row (status "running") and returns its id. */
export async function startIngestionRun(
  db: AnyDatabase,
  meta: AdapterMeta,
  startedAt: Date,
  pipelineRunId?: number,
): Promise<number> {
  const [run] = await db
    .insert(ingestionRuns)
    .values({
      source: meta.source,
      provider: meta.provider,
      startedAt,
      pipelineRunId: pipelineRunId ?? null,
    })
    .returning({ id: ingestionRuns.id });
  return run.id;
}

export async function finishIngestionRun(
  db: AnyDatabase,
  runId: number,
  r: { status: "succeeded" | "failed"; itemsFetched?: number; error?: string; finishedAt: Date },
): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      status: r.status,
      finishedAt: r.finishedAt,
      ...(r.itemsFetched === undefined ? {} : { itemsFetched: r.itemsFetched }),
      ...(r.error === undefined ? {} : { error: r.error.slice(0, 2000) }),
    })
    .where(eq(ingestionRuns.id, runId));
}

async function storeItem(db: AnyDatabase, meta: AdapterMeta, item: FetchedItem, observedAt: Date) {
  const values = {
    source: meta.source,
    provider: meta.provider,
    externalId: item.externalId,
    kind: item.kind,
    title: item.title,
    url: item.url,
    imageUrl: item.imageUrl,
    region: item.region,
    countries: sortByMarketPriority((item.countries ?? [item.region]).flatMap(toCountries)),
    advertiserId: item.advertiserId,
    advertiserName: item.advertiserName,
    format: item.format,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    priceCents: item.priceCents,
    currency: item.currency,
    raw: item.raw,
    ...(item.productId ? { productId: item.productId } : {}),
  };
  const [stored] = await db
    .insert(sourceItems)
    .values({ ...values, firstSeenAt: observedAt, lastSeenAt: observedAt })
    .onConflictDoUpdate({
      target: [sourceItems.source, sourceItems.externalId],
      // first_seen_at is deliberately left untouched.
      set: {
        ...values,
        lastSeenAt: observedAt,
        // A new photo needs a new hash (ADR-016).
        imageHash: sql`case when ${sourceItems.imageUrl} is distinct from excluded.image_url then null else ${sourceItems.imageHash} end`,
      },
    })
    .returning({ id: sourceItems.id });

  if (item.metrics.length > 0) {
    await db
      .insert(signalSnapshots)
      .values(
        item.metrics.map((m) => ({
          sourceItemId: stored.id,
          metric: m.metric,
          value: m.value,
          observedAt: m.observedAt ?? observedAt,
        })),
      )
      .onConflictDoNothing();
  }
}

export interface IngestOptions {
  now?: () => Date;
  /** Items buffered before they are written. */
  batchSize?: number;
  /**
   * Buffered items are also written once the oldest has waited this long, so a killed process
   * loses little of a slow source's output.
   */
  maxBufferMs?: number;
  /** Items with different external ids written in parallel. */
  concurrency?: number;
  /**
   * The caller's abort signal. When it has aborted, the iterator's error is rethrown (after
   * storing what was buffered) instead of being reported as a source failure.
   */
  signal?: AbortSignal;
  /** Called after each item is stored. */
  onStored?: (item: FetchedItem) => void;
}

/** Thrown by `ingestItems` when the caller aborted; carries how many items were stored. */
export class IngestionAbortedError extends Error {
  constructor(
    readonly reason: unknown,
    readonly itemsFetched: number,
  ) {
    super("Ingestion aborted by the caller");
    this.name = "IngestionAbortedError";
  }
}

/**
 * Upserts items as source items and appends one snapshot per metric. Items are written in
 * batches: items sharing an external id are written in order (later wins, as if one by one),
 * different ids in parallel. When the iterator throws, the items read so far are still stored
 * and the error is returned.
 */
export async function ingestItems(
  db: AnyDatabase,
  meta: AdapterMeta,
  items: AsyncIterable<FetchedItem> | Iterable<FetchedItem>,
  {
    now = () => new Date(),
    batchSize = 100,
    maxBufferMs = 2_000,
    concurrency = 8,
    signal,
    onStored,
  }: IngestOptions = {},
): Promise<{ itemsFetched: number; error?: unknown }> {
  let itemsFetched = 0;
  let buffer: Array<{ item: FetchedItem; observedAt: Date }> = [];
  let bufferedSince = 0;

  const flush = async () => {
    const groups = new Map<string, typeof buffer>();
    for (const entry of buffer) {
      const group = groups.get(entry.item.externalId) ?? [];
      group.push(entry);
      groups.set(entry.item.externalId, group);
    }
    buffer = [];
    const queue = [...groups.values()];
    let failure: { error: unknown } | undefined;
    const worker = async () => {
      for (let group = queue.shift(); group && !failure; group = queue.shift()) {
        for (const { item, observedAt } of group) {
          if (failure) return;
          try {
            await storeItem(db, meta, item, observedAt);
            itemsFetched++;
            onStored?.(item);
          } catch (error) {
            failure = { error };
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    if (failure) throw failure.error;
  };

  try {
    for await (const item of items) {
      if (buffer.length === 0) bufferedSince = Date.now();
      buffer.push({ item, observedAt: now() });
      if (buffer.length >= batchSize || Date.now() - bufferedSince >= maxBufferMs) {
        await flush();
      }
    }
    // Adapters stop quietly on abort; a cut-short fetch must not look complete.
    signal?.throwIfAborted();
    await flush();
  } catch (error) {
    try {
      await flush();
    } catch {
      // The first error is the one worth reporting.
    }
    if (signal?.aborted) throw new IngestionAbortedError(error, itemsFetched);
    return { itemsFetched, error };
  }
  return { itemsFetched };
}

/**
 * Pulls items from an adapter and stores them (see `ingestItems`). Every run is recorded in
 * ingestion_runs, including failures, so source health is visible. Items stored before a
 * failure are kept.
 */
export async function runIngestion(
  db: AnyDatabase,
  adapter: SourceAdapter,
  ctx: FetchContext,
  now: () => Date = () => new Date(),
  opts: {
    pipelineRunId?: number;
    /** An ingestion_runs row opened earlier (e.g. by a pipeline unit that may be retried). */
    runId?: number;
    onStored?: (item: FetchedItem) => void;
  } = {},
): Promise<IngestionResult> {
  const runId = opts.runId ?? (await startIngestionRun(db, adapter, now(), opts.pipelineRunId));
  let ingested: Awaited<ReturnType<typeof ingestItems>>;
  try {
    ingested = await ingestItems(db, adapter, adapter.fetch(ctx), {
      now,
      signal: ctx.signal,
      onStored: opts.onStored,
    });
  } catch (err) {
    // Aborted by the caller: close the row, then let the caller see the abort.
    const aborted = err instanceof IngestionAbortedError;
    await finishIngestionRun(db, runId, {
      status: "failed",
      ...(aborted ? { itemsFetched: err.itemsFetched } : {}),
      error: INTERRUPTED_RUN_ERROR,
      finishedAt: now(),
    });
    throw aborted ? err.reason : err;
  }
  const { itemsFetched, error } = ingested;
  if (error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestionRun(db, runId, {
      status: "failed",
      itemsFetched,
      error: message,
      finishedAt: now(),
    });
    return { runId, status: "failed", itemsFetched, error: message };
  }
  await finishIngestionRun(db, runId, { status: "succeeded", itemsFetched, finishedAt: now() });
  return { runId, status: "succeeded", itemsFetched };
}

/**
 * Closes ingestion runs left "running" by a process that died: runs of a pipeline run that is
 * no longer running, and standalone runs older than `orphanAfterMs`. Uses the database clock.
 * Returns how many rows were closed.
 */
export async function reapStaleIngestionRuns(
  db: AnyDatabase,
  { orphanAfterMs = 2 * 3_600_000 }: { orphanAfterMs?: number } = {},
): Promise<number> {
  const finishedPipelines = db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(ne(pipelineRuns.status, "running"));
  const closed = await db
    .update(ingestionRuns)
    .set({ status: "failed", finishedAt: sql`now()`, error: INTERRUPTED_RUN_ERROR })
    .where(
      and(
        eq(ingestionRuns.status, "running"),
        or(
          inArray(ingestionRuns.pipelineRunId, finishedPipelines),
          and(
            isNull(ingestionRuns.pipelineRunId),
            lt(
              ingestionRuns.startedAt,
              sql`now() - ${orphanAfterMs}::double precision * interval '1 millisecond'`,
            ),
          ),
        ),
      ),
    )
    .returning({ id: ingestionRuns.id });
  return closed.length;
}
