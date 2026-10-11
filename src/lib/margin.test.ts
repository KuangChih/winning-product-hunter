import { describe, expect, it } from "vitest";
import { estimateMargin, type LandedCostRow } from "./margin";

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

const landed = (variantPriceCents: number, freightCents: number | null): LandedCostRow => ({
  country: "US",
  variantKey: "Blue-40cm",
  variantPriceCents,
  variantBasis: "store_options",
  matchedVariants: 2,
  totalVariants: 22,
  carrier: freightCents === null ? null : "YunExpress Ordinary",
  freightCents,
  minDays: freightCents === null ? null : 4,
  maxDays: freightCents === null ? null : 7,
  maxDaysAllowed: 15,
  quotedAt: new Date("2026-10-11T00:00:00Z"),
});

describe("estimateMargin", () => {
  it("is the landed margin: US store price − CJ variant − shipping (ADR-017)", () => {
    const m = estimateMargin(
      [store(2000), store(3000), store(2500), listing(800), listing(600)],
      RATES,
      landed(486, 714),
    );
    expect(m.retailUsdCents).toBe(2500);
    expect(m.retailOffers).toBe(3);
    // The quoted variant's price replaces the listing's (most expensive variant) price.
    expect(m.supplierUsdCents).toBe(486);
    expect(m.shippingUsdCents).toBe(714);
    expect(m.grossProfitUsdCents).toBe(1300);
    expect(m.grossMargin).toBeCloseTo(0.52);
    expect(m.missing).toEqual([]);
  });

  it("gives no margin without a shipping quote, nor when no option arrives in time", () => {
    const noQuote = estimateMargin([store(2500), listing(600)], RATES);
    expect(noQuote.supplierUsdCents).toBe(600);
    expect(noQuote.grossMargin).toBeNull();
    expect(noQuote.missing).toEqual(["shipping"]);
    const tooSlow = estimateMargin([store(2500), listing(600)], RATES, landed(486, null));
    expect(tooSlow.grossMargin).toBeNull();
    expect(tooSlow.missing).toEqual(["shipping"]);
  });

  it("can be negative: shipping costs more than the price leaves", () => {
    const m = estimateMargin([store(2000), listing(500)], RATES, landed(995, 2993));
    expect(m.grossMargin).toBeCloseTo(-0.994);
  });

  it("ignores similar products found by a catalog search", () => {
    const similar = { ...store(99900), provider: "shopify_catalog" };
    const m = estimateMargin([similar, listing(500)], RATES);
    expect(m.retailUsdCents).toBeNull();
    expect(m.missing).toEqual(["retail", "shipping"]);
  });

  it("uses stores selling the same photo when the advertiser's own price is missing", () => {
    const same = (priceCents: number, seller: string) => ({
      ...store(priceCents),
      provider: "shopify_catalog",
      advertiserId: seller,
      countries: ["US"],
      samePhoto: true,
    });
    const m = estimateMargin(
      [same(2000, "a.com"), same(3000, "b.com"), listing(500)],
      RATES,
      landed(500, 500),
    );
    expect(m.retailUsdCents).toBe(2500);
    expect(m.retailBasis).toBe("same_photo");
    expect(m.retailOffers).toBe(2);
    expect(m.grossMargin).toBeCloseTo(0.6);
  });

  it("converts store prices in other currencies with ECB rates", () => {
    // 1700 GBP cents = 20 EUR = 22 USD.
    const m = estimateMargin([store(1700, "GBP"), listing(1100)], RATES, landed(1100, 0));
    expect(m.retailUsdCents).toBe(2200);
    expect(m.grossMargin).toBeCloseTo(0.5);
  });

  it("explains what is missing instead of guessing", () => {
    const noSupplier = estimateMargin([store(2000)], RATES);
    expect(noSupplier.grossMargin).toBeNull();
    expect(noSupplier.missing).toEqual(["supplier", "shipping"]);

    const nothing = estimateMargin(
      [{ kind: "ad", source: "meta_ads", priceCents: null, currency: null }],
      null,
    );
    expect(nothing.retailUsdCents).toBeNull();
    expect(nothing.missing).toEqual(["retail", "supplier", "shipping"]);
  });

  it("does not mix currencies when no rates are available", () => {
    const m = estimateMargin([store(1700, "GBP"), listing(500)], null);
    expect(m.retailUsdCents).toBeNull();
    expect(m.grossMargin).toBeNull();
  });
});
