// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ingestionRuns, pipelineRuns, signalSnapshots, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { createFixtureAdapter } from "./fixture-adapter";
import { INTERRUPTED_RUN_ERROR, reapStaleIngestionRuns, runIngestion } from "./run";
import type { FetchedItem, SourceAdapter } from "./types";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const ad = (id: string, title: string, reach: number): FetchedItem => ({
  externalId: id,
  kind: "ad",
  title,
  region: "EU",
  format: "video",
  startedAt: new Date("2026-09-01T00:00:00Z"),
  metrics: [{ metric: "eu_total_reach", value: reach }],
  raw: { id },
});

function clock(...isoTimes: string[]) {
  let i = 0;
  return () => new Date(isoTimes[Math.min(i++, isoTimes.length - 1)]);
}

describe("runIngestion", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it("stores items, appends snapshots and records a successful run", async () => {
    const adapter = createFixtureAdapter("meta_ads", [
      ad("1", "Posture corrector", 1000),
      ad("2", "LED face mask", 500),
    ]);

    const result = await runIngestion(t.db, adapter, { queries: [], limit: 10 });

    expect(result).toMatchObject({ status: "succeeded", itemsFetched: 2 });
    expect(await t.db.select().from(sourceItems)).toHaveLength(2);
    expect(await t.db.select().from(signalSnapshots)).toHaveLength(2);
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run).toMatchObject({ status: "succeeded", itemsFetched: 2, provider: "fixture" });
    // Region "EU" expands to our EU target markets.
    const [first] = await t.db.select().from(sourceItems);
    expect(first.countries).toEqual(["DE", "FR", "SE", "BE", "ES"]);
    expect(run.finishedAt).not.toBeNull();
  });

  it("re-ingesting updates last_seen_at, keeps first_seen_at and grows the time series", async () => {
    await runIngestion(
      t.db,
      createFixtureAdapter("meta_ads", [ad("1", "Posture corrector", 1000)]),
      { queries: [], limit: 10 },
      () => new Date("2026-10-01T00:00:00Z"),
    );
    await runIngestion(
      t.db,
      createFixtureAdapter("meta_ads", [ad("1", "Posture corrector", 4000)]),
      { queries: [], limit: 10 },
      () => new Date("2026-10-08T00:00:00Z"),
    );

    const [item] = await t.db.select().from(sourceItems);
    expect(item.firstSeenAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(item.lastSeenAt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    const values = (await t.db.select().from(signalSnapshots)).map((s) => s.value).sort();
    expect(values).toEqual([1000, 4000]);
  });

  it("prefers explicit countries over the region and normalizes them", async () => {
    const adapter = createFixtureAdapter("meta_ads", [
      { ...ad("1", "Posture corrector", 1), region: "US", countries: ["nz", "UK", "us"] },
    ]);
    await runIngestion(t.db, adapter, { queries: [], limit: 10 });

    const [item] = await t.db.select().from(sourceItems);
    expect(item.countries).toEqual(["US", "GB", "NZ"]);
  });

  it("applies query filter and limit", async () => {
    const adapter = createFixtureAdapter("meta_ads", [
      ad("1", "Posture corrector", 1),
      ad("2", "Posture pillow", 1),
      ad("3", "LED face mask", 1),
    ]);

    const result = await runIngestion(t.db, adapter, { queries: ["posture"], limit: 1 });

    expect(result.itemsFetched).toBe(1);
  });

  it("records a failed run and keeps items stored before the error", async () => {
    const failing: SourceAdapter = {
      source: "tiktok_ads",
      provider: "test",
      async *fetch() {
        yield ad("ok", "First", 1);
        throw new Error("upstream exploded");
      },
    };

    const result = await runIngestion(
      t.db,
      failing,
      { queries: [], limit: 10 },
      clock("2026-10-09T00:00:00Z"),
    );

    expect(result).toMatchObject({ status: "failed", itemsFetched: 1, error: "upstream exploded" });
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run).toMatchObject({ status: "failed", error: "upstream exploded", itemsFetched: 1 });
    expect(await t.db.select().from(sourceItems)).toHaveLength(1);
  });

  it("writes many items in batches, later duplicates of an id winning as if one by one", async () => {
    const items = Array.from({ length: 250 }, (_, i) => ad(`a${i % 120}`, `Title ${i}`, i));
    // The same ad seen again without a title keeps the stored one.
    items.push({ ...ad("a5", "", 999), title: undefined });
    const result = await runIngestion(
      t.db,
      createFixtureAdapter("meta_ads", items),
      { queries: [], limit: 1000 },
      () => new Date("2026-10-10T00:00:00Z"),
    );

    expect(result).toMatchObject({ status: "succeeded", itemsFetched: 251 });
    const stored = await t.db.select().from(sourceItems);
    expect(stored).toHaveLength(120);
    const byId = new Map(stored.map((i) => [i.externalId, i]));
    // a0 appeared at i = 0, 120, 240: the last one wins.
    expect(byId.get("a0")?.title).toBe("Title 240");
    expect(byId.get("a5")?.title).toBe("Title 245");
    // One timestamp for all, so each ad keeps one snapshot: the first one written.
    const snapshots = await t.db.select().from(signalSnapshots);
    expect(snapshots).toHaveLength(120);
    const reachOf = new Map(snapshots.map((s) => [s.sourceItemId, s.value]));
    expect(reachOf.get(byId.get("a0")!.id)).toBe(0);
  });

  it("links the ingestion run to its pipeline run", async () => {
    const [p] = await t.db
      .insert(pipelineRuns)
      .values({ trigger: "cli", env: "local", options: {}, state: {} })
      .returning();
    const r = await runIngestion(
      t.db,
      createFixtureAdapter("meta_ads", [ad("1", "x", 1)]),
      { queries: [], limit: 10 },
      undefined,
      { pipelineRunId: p.id },
    );
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run).toMatchObject({ id: r.runId, pipelineRunId: p.id });
  });

  it("rethrows a caller abort and closes the run as interrupted", async () => {
    const controller = new AbortController();
    const aborting: SourceAdapter = {
      source: "meta_ads",
      provider: "test",
      async *fetch() {
        yield ad("1", "First", 1);
        controller.abort(new Error("time budget"));
        throw controller.signal.reason;
      },
    };
    await expect(
      runIngestion(t.db, aborting, { queries: [], limit: 10, signal: controller.signal }),
    ).rejects.toThrow("time budget");
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run).toMatchObject({ status: "failed", error: INTERRUPTED_RUN_ERROR });
    expect(await t.db.select().from(sourceItems)).toHaveLength(1);
  });

  it("treats an adapter that stops quietly on abort as interrupted, keeping the count", async () => {
    const controller = new AbortController();
    const quiet: SourceAdapter = {
      source: "meta_ads",
      provider: "test",
      async *fetch(ctx) {
        yield ad("1", "First", 1);
        yield ad("2", "Second", 2);
        controller.abort(new Error("time budget"));
        if (ctx.signal?.aborted) return;
        yield ad("3", "Third", 3);
      },
    };
    await expect(
      runIngestion(t.db, quiet, { queries: [], limit: 10, signal: controller.signal }),
    ).rejects.toThrow("time budget");
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run).toMatchObject({ status: "failed", error: INTERRUPTED_RUN_ERROR, itemsFetched: 2 });
    expect(await t.db.select().from(sourceItems)).toHaveLength(2);
  });

  it("reaps runs of finished pipeline runs and old orphans, not live ones", async () => {
    const [done, live] = await t.db
      .insert(pipelineRuns)
      .values([
        { trigger: "cli", env: "local", options: {}, state: {}, status: "succeeded" },
        { trigger: "web", env: "local", options: {}, state: {} },
      ])
      .returning();
    const hoursAgo = (h: number) => sql`now() - ${h}::double precision * interval '1 hour'`;
    await t.db.insert(ingestionRuns).values([
      { source: "meta_ads", provider: "of-done", pipelineRunId: done.id },
      { source: "meta_ads", provider: "of-live", pipelineRunId: live.id, startedAt: hoursAgo(5) },
      { source: "meta_ads", provider: "old-orphan", startedAt: hoursAgo(3) },
      { source: "meta_ads", provider: "new-orphan", startedAt: hoursAgo(1) },
      { source: "meta_ads", provider: "finished", status: "succeeded", startedAt: hoursAgo(9) },
    ]);

    expect(await reapStaleIngestionRuns(t.db)).toBe(2);
    const rows = await t.db.select().from(ingestionRuns);
    const status = Object.fromEntries(rows.map((r) => [r.provider, r.status]));
    expect(status).toEqual({
      "of-done": "failed",
      "of-live": "running",
      "old-orphan": "failed",
      "new-orphan": "running",
      finished: "succeeded",
    });
  });
});
