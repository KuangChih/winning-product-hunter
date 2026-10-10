import { describe, expect, it } from "vitest";
import { marketRetailPrice } from "./retail-price";

const rates = { date: "2026-10-09", perEur: { EUR: 1, USD: 1.1206, GBP: 0.84763 } };
const gbp = (p: number) => ({ priceCents: p, currency: "GBP" });
const usd = (p: number) => ({ priceCents: p, currency: "USD" });

describe("marketRetailPrice", () => {
  it("uses the market's local currency and converts other offers with ECB rates", () => {
    // 4499 USD ≈ 3403 GBP; median of [1600, 3000, 3403] is 3000.
    expect(marketRetailPrice([gbp(1600), gbp(3000), usd(4499)], "GB", rates)).toEqual({
      medianCents: 3000,
      currency: "GBP",
      offers: 3,
      converted: 1,
    });
  });

  it("ignores other currencies when no rates are available", () => {
    expect(marketRetailPrice([gbp(1600), gbp(3000), usd(4499)], "GB", null)).toEqual({
      medianCents: 2300,
      currency: "GBP",
      offers: 2,
      converted: 0,
    });
  });

  it("falls back to the most common currency for non-target countries", () => {
    expect(marketRetailPrice([usd(1000), usd(2000), gbp(9999)], "JP", null)).toMatchObject({
      medianCents: 1500,
      currency: "USD",
    });
  });

  it("returns null when nothing can be priced", () => {
    expect(marketRetailPrice([usd(1000)], "GB", null)).toBeNull();
    expect(marketRetailPrice([], "US", rates)).toBeNull();
  });
});
