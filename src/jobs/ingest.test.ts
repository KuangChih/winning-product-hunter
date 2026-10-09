// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestionRuns, signalSnapshots, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { runIngestion } from "@/ingestion/run";
import { parseArgs, resolveAdapters } from "./ingest";

describe("parseArgs", () => {
  it("parses sources and flags", () => {
    expect(parseArgs(["meta_ads", "--fixture", "--limit=5", "--query=mask"])).toEqual({
      sources: ["meta_ads"],
      fixture: true,
      dryRun: false,
      limit: 5,
      queries: ["mask"],
    });
  });

  it("rejects unknown flags and missing sources", () => {
    expect(() => parseArgs(["--nope", "x"])).toThrow(/Unknown flag/);
    expect(() => parseArgs(["--fixture"])).toThrow(/Specify a source/);
  });
});

describe("resolveAdapters", () => {
  it("expands 'all' to every fixture source", () => {
    const adapters = resolveAdapters(parseArgs(["all", "--fixture"]));
    expect(adapters.map((a) => a.source).sort()).toEqual([
      "aliexpress",
      "google_trends",
      "meta_ads",
    ]);
    expect(adapters.every((a) => a.provider === "fixture")).toBe(true);
  });

  it("refuses live mode until live adapters exist", () => {
    expect(() => resolveAdapters(parseArgs(["meta_ads"]))).toThrow(/--fixture/);
  });
});

describe("fixture ingestion end to end", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("loads every fixture source into the database", async () => {
    for (const adapter of resolveAdapters(parseArgs(["all", "--fixture"]))) {
      const result = await runIngestion(t.db, adapter, { queries: [], limit: 500 });
      expect(result.status).toBe("succeeded");
    }

    const items = await t.db.select().from(sourceItems);
    const bySource = Object.groupBy(items, (i) => i.source);
    expect(bySource.meta_ads?.length).toBe(44);
    expect(bySource.google_trends?.length).toBe(5);
    expect(bySource.aliexpress?.length).toBe(5);
    expect(items.every((i) => i.provider === "fixture")).toBe(true);

    // 11 complete weeks per trend query (the partial week is skipped).
    const snapshots = await t.db.select().from(signalSnapshots);
    expect(snapshots.filter((s) => s.metric === "search_interest")).toHaveLength(55);
    expect(await t.db.select().from(ingestionRuns)).toHaveLength(3);
  });
});
