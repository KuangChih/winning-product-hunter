import { describe, expect, it } from "vitest";
import { estimateMargin } from "./margin";

const RATES = { date: "2026-10-09", perEur: { EUR: 1, USD: 1.1, GBP: 0.85 } };
const store = (priceCents: number, currency: string | null = "USD") => ({
  kind: "store_product",
  source: "shopify",
  priceCents,
  currency,
});
const listing = (priceCents: number, currency: string | null = null) => ({
  kind: "listing",
  source: "cj",
  priceCents,
  currency,
});

describe("estimateMargin", () => {
  it("compares the US median store price with the cheapest supplier listing", () => {
    const m = estimateMargin(
      [store(2000), store(3000), store(2500), listing(800), listing(600)],
      RATES,
    );
    expect(m.retailUsdCents).toBe(2500);
    expect(m.retailOffers).toBe(3);
    expect(m.supplierUsdCents).toBe(600);
    expect(m.supplierListings).toBe(2);
    expect(m.grossProfitUsdCents).toBe(1900);
    expect(m.grossMargin).toBeCloseTo(0.76);
    expect(m.missing).toEqual([]);
  });

  it("converts store prices in other currencies with ECB rates", () => {
    // 1700 GBP cents = 20 EUR = 22 USD.
    const m = estimateMargin([store(1700, "GBP"), listing(1100)], RATES);
    expect(m.retailUsdCents).toBe(2200);
    expect(m.grossMargin).toBeCloseTo(0.5);
  });

  it("explains what is missing instead of guessing", () => {
    const noSupplier = estimateMargin([store(2000)], RATES);
    expect(noSupplier.grossMargin).toBeNull();
    expect(noSupplier.missing).toEqual(["a supplier cost (CJ Dropshipping listing)"]);

    const nothing = estimateMargin(
      [{ kind: "ad", source: "meta_ads", priceCents: null, currency: null }],
      null,
    );
    expect(nothing.retailUsdCents).toBeNull();
    expect(nothing.missing).toHaveLength(2);
  });

  it("does not mix currencies when no rates are available", () => {
    const m = estimateMargin([store(1700, "GBP"), listing(500)], null);
    expect(m.retailUsdCents).toBeNull();
    expect(m.grossMargin).toBeNull();
  });
});
