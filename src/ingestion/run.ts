import { eq } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { ingestionRuns, signalSnapshots, sourceItems } from "@/db/schema";
import { sortByMarketPriority, toCountries } from "@/lib/markets";
import type { FetchContext, SourceAdapter } from "./types";

export interface IngestionResult {
  runId: number;
  status: "succeeded" | "failed";
  itemsFetched: number;
  error?: string;
}

/**
 * Pulls items from an adapter, upserts them as source items and appends one snapshot per
 * metric. Every run is recorded in ingestion_runs, including failures, so source health is
 * visible. Items stored before a failure are kept.
 */
export async function runIngestion(
  db: AnyDatabase,
  adapter: SourceAdapter,
  ctx: FetchContext,
  now: () => Date = () => new Date(),
): Promise<IngestionResult> {
  const [run] = await db
    .insert(ingestionRuns)
    .values({ source: adapter.source, provider: adapter.provider, startedAt: now() })
    .returning({ id: ingestionRuns.id });

  let itemsFetched = 0;
  try {
    for await (const item of adapter.fetch(ctx)) {
      const observedAt = now();
      const values = {
        source: adapter.source,
        provider: adapter.provider,
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
      };
      const [stored] = await db
        .insert(sourceItems)
        .values({ ...values, firstSeenAt: observedAt, lastSeenAt: observedAt })
        .onConflictDoUpdate({
          target: [sourceItems.source, sourceItems.externalId],
          // first_seen_at is deliberately left untouched.
          set: { ...values, lastSeenAt: observedAt },
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
      itemsFetched++;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(ingestionRuns)
      .set({ status: "failed", finishedAt: now(), itemsFetched, error: message.slice(0, 2000) })
      .where(eq(ingestionRuns.id, run.id));
    return { runId: run.id, status: "failed", itemsFetched, error: message };
  }

  await db
    .update(ingestionRuns)
    .set({ status: "succeeded", finishedAt: now(), itemsFetched })
    .where(eq(ingestionRuns.id, run.id));
  return { runId: run.id, status: "succeeded", itemsFetched };
}
