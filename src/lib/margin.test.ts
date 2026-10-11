import { describe, expect, it } from "vitest";
import { estimateMargin } from "./margin";

const RATES = { date: "2026-10-09", perEur: { EUR: 1, USD: 1.1, GBP: 0.85 } };
const store = (priceCents: number, currency: string | null = "USD") => ({
  kind: "store_product",
  source: "shopify",
  provider: "shopify_catalog_lookup",
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

  it("ignores similar products found by a catalog search", () => {
    const similar = { ...store(99900), provider: "shopify_catalog" };
    const m = estimateMargin([similar, listing(500)], RATES);
    expect(m.retailUsdCents).toBeNull();
    expect(m.missing).toEqual(["retail"]);
  });

  it("uses stores selling the same photo when the advertiser's own price is missing", () => {
    const same = (priceCents: number, seller: string) => ({
      ...store(priceCents),
      provider: "shopify_catalog",
      advertiserId: seller,
      countries: ["US"],
      samePhoto: true,
    });
    const m = estimateMargin([same(2000, "a.com"), same(3000, "b.com"), listing(500)], RATES);
    expect(m.retailUsdCents).toBe(2500);
    expect(m.retailBasis).toBe("same_photo");
    expect(m.retailOffers).toBe(2);
    expect(m.grossMargin).toBeCloseTo(0.8);
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
    expect(noSupplier.missing).toEqual(["supplier"]);

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
