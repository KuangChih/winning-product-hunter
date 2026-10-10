// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { parseCollectArgs, pickProducts } from "./collect";

describe("parseCollectArgs", () => {
  it("defaults to the five priority markets", () => {
    expect(parseCollectArgs(["shopify_catalog"])).toEqual({
      source: "shopify_catalog",
      products: 20,
      countries: ["US", "CA", "GB", "AU", "NZ"],
      dryRun: false,
    });
  });

  it("parses options and rejects unknown sources", () => {
    expect(
      parseCollectArgs(["shopify_catalog", "--products=3", "--countries=us,de", "--dry-run"]),
    ).toMatchObject({ products: 3, countries: ["US", "DE"], dryRun: true });
    expect(parseCollectArgs(["meta_ad_library"]).source).toBe("meta_ad_library");
    expect(() => parseCollectArgs(["meta_ads"])).toThrow(/shopify_catalog, meta_ad_library/);
  });
});

describe("pickProducts", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("returns the highest-scoring products first, using titles as queries", async () => {
    const now = new Date("2026-10-09T00:00:00Z");
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => now);
    }
    await runMatching(t.db);
    await runScoring(t.db, now);

    const picked = await pickProducts(t.db, 2);
    expect(picked.map((p) => p.query)).toEqual([
      "Silicone Dog Paw Cleaner Cup",
      "Adjustable Posture Corrector Brace",
    ]);
  });
});
