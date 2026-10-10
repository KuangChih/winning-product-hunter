import { describe, expect, it } from "vitest";
import { applyRankingFilters, type RankedProduct } from "./products";
import { parseRankingParams } from "./ranking-params";

const product = (
  title: string,
  score: number,
  markets: string[],
  ageDays: number,
  penalty: number,
  retailUsdCents: number | null = null,
  sources: string[] = ["meta_ads"],
) =>
  ({
    id: title,
    slug: title,
    title,
    category: null,
    imageUrl: null,
    score,
    confidence: 0.5,
    computedAt: new Date(),
    sources,
    markets,
    retailUsdCents,
    isSample: false,
    breakdown: { saturation: { ageDays, penalty, activeAdvertisers: 1, value: 0 } },
  }) as unknown as RankedProduct;

const items = [
  product("Neck Massager Pro", 70, ["US", "GB"], 90, 0.3, 4999, ["meta_ads", "shopify"]),
  product("Dog Paw Cleaner", 65, ["AU"], 10, 0.1, 1999),
  product("Posture Corrector", 50, ["US"], 40, 0.05),
];

describe("applyRankingFilters", () => {
  it("searches titles word by word, case-insensitively", () => {
    expect(applyRankingFilters(items, { q: "neck PRO" }).map((p) => p.title)).toEqual([
      "Neck Massager Pro",
    ]);
    expect(applyRankingFilters(items, { q: "neck dog" })).toEqual([]);
  });

  it("filters by market and minimum score", () => {
    expect(applyRankingFilters(items, { market: "US" }).map((p) => p.title)).toEqual([
      "Neck Massager Pro",
      "Posture Corrector",
    ]);
    expect(applyRankingFilters(items, { minScore: 60 })).toHaveLength(2);
  });

  it("filters by US price range, hiding products without a known price", () => {
    const titles = (f: { minPrice?: number; maxPrice?: number }) =>
      applyRankingFilters(items, f).map((p) => p.title);
    expect(titles({ minPrice: 20 })).toEqual(["Neck Massager Pro"]);
    expect(titles({ maxPrice: 20 })).toEqual(["Dog Paw Cleaner"]);
    expect(titles({ minPrice: 10, maxPrice: 60 })).toEqual([
      "Neck Massager Pro",
      "Dog Paw Cleaner",
    ]);
    // No range: products without a price stay.
    expect(titles({})).toHaveLength(3);
  });

  it("filters by evidence source", () => {
    expect(applyRankingFilters(items, { source: "shopify" }).map((p) => p.title)).toEqual([
      "Neck Massager Pro",
    ]);
  });

  it("sorts by score, newest or least crowded", () => {
    const titles = (sort: "score" | "newest" | "least_crowded") =>
      applyRankingFilters([...items], { sort }).map((p) => p.title);
    expect(titles("score")).toEqual(["Neck Massager Pro", "Dog Paw Cleaner", "Posture Corrector"]);
    expect(titles("newest")).toEqual(["Dog Paw Cleaner", "Posture Corrector", "Neck Massager Pro"]);
    expect(titles("least_crowded")).toEqual([
      "Posture Corrector",
      "Dog Paw Cleaner",
      "Neck Massager Pro",
    ]);
  });
});

describe("parseRankingParams", () => {
  it("reads valid values and ignores invalid ones", () => {
    expect(
      parseRankingParams({
        q: " neck ",
        market: "us",
        minScore: "60",
        sort: "newest",
        sample: "1",
      }),
    ).toEqual({ q: "neck", market: "US", minScore: 60, sort: "newest", includeSample: true });
    expect(
      parseRankingParams({ market: "XX", minScore: "abc", sort: "random", q: ["a", "b"] }),
    ).toEqual({
      q: "a",
      market: undefined,
      minScore: undefined,
      sort: "score",
      includeSample: false,
    });
  });

  it("reads price range and evidence source, ignoring invalid values", () => {
    expect(
      parseRankingParams({ minPrice: "15", maxPrice: "60.4", source: "shopify" }),
    ).toMatchObject({ minPrice: 15, maxPrice: 60, source: "shopify" });
    expect(
      parseRankingParams({ minPrice: "-5", maxPrice: "abc", source: "myspace" }),
    ).toMatchObject({ minPrice: undefined, maxPrice: undefined, source: undefined });
    expect(parseRankingParams({ minPrice: "", maxPrice: " " }).minPrice).toBeUndefined();
  });
});
