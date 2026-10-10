import { and, desc, gte, ne } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { ingestionRuns } from "@/db/schema";

const DAY = 86_400_000;

export type HealthStatus = "healthy" | "degraded" | "failing" | "stale";

export interface SourceHealth {
  source: string;
  provider: string;
  status: HealthStatus;
  lastRun: {
    status: "running" | "succeeded" | "failed";
    startedAt: Date;
    finishedAt: Date | null;
    itemsFetched: number;
    error: string | null;
  };
  lastSuccessAt: Date | null;
  /** Runs and failures within the window. */
  runs: number;
  failures: number;
}

/** A source not run successfully for this long is stale (the pipeline runs daily). */
export const STALE_AFTER_DAYS = 2;

export function classify(
  lastStatus: SourceHealth["lastRun"]["status"],
  lastSuccessAt: Date | null,
  failures: number,
  now: Date,
): HealthStatus {
  if (lastStatus === "failed") return "failing";
  if (!lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_DAYS * DAY) {
    return "stale";
  }
  return failures > 0 ? "degraded" : "healthy";
}

/**
 * Health of every real source/provider pair that ran in the last `days` days, worst first.
 * Sample-data (fixture) runs are excluded unless asked for.
 */
export async function getSourceHealth(
  db: AnyDatabase,
  {
    days = 7,
    now = new Date(),
    includeSample = false,
  }: { days?: number; now?: Date; includeSample?: boolean } = {},
): Promise<SourceHealth[]> {
  const since = gte(ingestionRuns.startedAt, new Date(now.getTime() - days * DAY));
  const runs = await db
    .select()
    .from(ingestionRuns)
    .where(includeSample ? since : and(since, ne(ingestionRuns.provider, "fixture")))
    .orderBy(desc(ingestionRuns.startedAt));

  const byKey = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = `${r.source}|${r.provider}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }

  const order: Record<HealthStatus, number> = { failing: 0, stale: 1, degraded: 2, healthy: 3 };
  return [...byKey.values()]
    .map((list) => {
      const last = list[0];
      const lastSuccess = list.find((r) => r.status === "succeeded");
      const failures = list.filter((r) => r.status === "failed").length;
      const lastSuccessAt = lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null;
      return {
        source: last.source,
        provider: last.provider,
        status: classify(last.status, lastSuccessAt, failures, now),
        lastRun: {
          status: last.status,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          itemsFetched: last.itemsFetched,
          error: last.error,
        },
        lastSuccessAt,
        runs: list.length,
        failures,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.source.localeCompare(b.source));
}
