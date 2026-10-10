// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { getProductDetail, type ProductDetail } from "./product-detail";

const NOW = new Date("2026-10-09T00:00:00Z");

describe("getProductDetail", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    await runScoring(t.db, new Date("2026-10-08T00:00:00Z"));
    await runScoring(t.db, NOW);
  });

  afterEach(async () => {
    await t.close();
  });

  it("returns null for an unknown slug", async () => {
    expect(await getProductDetail(t.db, "nope")).toBeNull();
  });

  it("returns the latest score, score history and evidence grouped by item", async () => {
    const d = (await getProductDetail(t.db, "silicone-dog-paw-cleaner-cup")) as ProductDetail;

    expect(d).not.toBeNull();
    expect(d!.isSample).toBe(true);
    expect(d!.score?.computedAt.toISOString()).toBe(NOW.toISOString());
    expect(d!.scoreHistory.map((s) => s.computedAt.toISOString())).toEqual([
      "2026-10-08T00:00:00.000Z",
      NOW.toISOString(),
    ]);

    const kinds = d!.evidence.map((e) => e.kind).sort();
    expect(kinds.filter((k) => k === "ad")).toHaveLength(5);
    expect(kinds).toContain("trend");
    expect(kinds).toContain("listing");

    const trend = d!.evidence.find((e) => e.kind === "trend")!;
    expect(trend.series.search_interest).toHaveLength(11);
    // Series are in chronological order.
    const times = trend.series.search_interest.map((p) => p.observedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const listing = d!.evidence.find((e) => e.kind === "listing")!;
    expect(listing.source).toBe("cj");
    expect(listing.metrics.units_sold_90d).toBe(1300);
    expect(listing.series.units_sold_90d).toBeUndefined();
  });

  it("points a merged duplicate at the surviving product", async () => {
    const [survivor, loser] = await t.db.select().from(products).limit(2);
    await t.db.update(products).set({ mergedInto: survivor.id }).where(eq(products.id, loser.id));

    expect(await getProductDetail(t.db, loser.slug)).toEqual({ redirectTo: survivor.slug });
    expect(await getProductDetail(t.db, survivor.slug)).toHaveProperty("evidence");
  });
});
