// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestionRuns, signalSnapshots, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { createFixtureAdapter } from "./fixture-adapter";
import { runIngestion } from "./run";
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
});
