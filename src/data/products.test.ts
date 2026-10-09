// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { getRankedProducts } from "./products";

const NOW = new Date("2026-10-09T00:00:00Z");

describe("getRankedProducts", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it("returns an empty list before anything is scored", async () => {
    expect(await getRankedProducts(t.db)).toEqual([]);
  });

  it("ranks by the latest score and flags fixture-only evidence as sample data", async () => {
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    await runScoring(t.db, new Date("2026-10-01T00:00:00Z"));
    await runScoring(t.db, NOW);

    const ranked = await getRankedProducts(t.db, 3);

    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.score)).toEqual(
      [...ranked.map((r) => r.score)].sort((a, b) => b - a),
    );
    expect(ranked.every((r) => r.computedAt.getTime() === NOW.getTime())).toBe(true);
    expect(ranked[0]).toMatchObject({
      title: "Silicone Dog Paw Cleaner Cup",
      isSample: true,
      sources: ["aliexpress", "google_trends", "meta_ads"],
    });
    expect(ranked[0].breakdown.subScores.longevity.weight).toBe(0.2);
  });
});
