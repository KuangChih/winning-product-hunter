import { describe, expect, it } from "vitest";
import { applyRankingFilters, type RankedProduct } from "./products";
import { parseRankingParams } from "./ranking-params";

const product = (
  title: string,
  score: number,
  markets: string[],
  ageDays: number,
  penalty: number,
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
    sources: ["meta_ads"],
    markets,
    isSample: false,
    breakdown: { saturation: { ageDays, penalty, activeAdvertisers: 1, value: 0 } },
  }) as unknown as RankedProduct;

const items = [
  product("Neck Massager Pro", 70, ["US", "GB"], 90, 0.3),
  product("Dog Paw Cleaner", 65, ["AU"], 10, 0.1),
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
});
