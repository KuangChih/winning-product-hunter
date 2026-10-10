import { describe, expect, it } from "vitest";
import {
  isTargetMarket,
  marketTier,
  marketWeight,
  sortByMarketPriority,
  toCountries,
} from "./markets";

describe("markets", () => {
  it("normalizes country and region codes to ISO countries", () => {
    expect(toCountries("us")).toEqual(["US"]);
    expect(toCountries("UK")).toEqual(["GB"]);
    expect(toCountries("EU")).toEqual(["DE", "FR", "SE", "BE", "ES"]);
    expect(toCountries("EEA")).toContain("NO");
    expect(toCountries("WORLDWIDE")).toEqual([]);
    expect(toCountries(undefined)).toEqual([]);
    expect(toCountries("jp")).toEqual(["JP"]);
  });

  it("ranks the five English-speaking markets first", () => {
    expect(["US", "CA", "GB", "AU", "NZ"].every((c) => marketTier(c) === 1)).toBe(true);
    expect(marketTier("DE")).toBe(2);
    expect(marketTier("JP")).toBeNull();
    expect(isTargetMarket("NO")).toBe(true);
    expect(isTargetMarket("UK")).toBe(false);
    expect(marketWeight("US")).toBeGreaterThan(marketWeight("DE"));
    expect(marketWeight("DE")).toBeGreaterThan(marketWeight("JP"));
  });

  it("sorts countries by market priority", () => {
    expect(sortByMarketPriority(["JP", "DE", "NZ", "US", "DE"])).toEqual(["US", "NZ", "DE", "JP"]);
  });
});
