import { describe, expect, it } from "vitest";
import { marketRetailPrice, productRetailPrice, type RetailItem } from "./retail-price";

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

describe("productRetailPrice (ADR-016)", () => {
  const own = (p: number): RetailItem => ({
    kind: "store_product",
    provider: "shopify_catalog_lookup",
    ...usd(p),
  });
  const found = (
    p: number,
    seller: string,
    samePhoto: boolean | null,
    country = "US",
    currency = "USD",
  ): RetailItem => ({
    kind: "store_product",
    provider: "shopify_catalog",
    priceCents: p,
    currency,
    advertiserId: seller,
    countries: [country],
    samePhoto,
  });

  it("uses the advertiser's own listing when there is one", () => {
    const r = productRetailPrice([own(2500), found(1000, "a.com", true)], rates);
    expect(r).toMatchObject({ medianCents: 2500, basis: "own_listing", offers: 1 });
  });

  it("falls back to stores selling the same photo, one listing per store, never similar products", () => {
    const r = productRetailPrice(
      [
        // The same store in two countries: its US listing counts, once.
        found(1500, "a.com", true, "GB", "GBP"),
        found(2000, "a.com", true, "US"),
        found(3000, "b.com", true, "US"),
        found(2400, "c.com", true, "US"),
        // Similar products and photos not compared yet are not this product's price.
        found(99900, "d.com", false),
        found(99900, "e.com", null),
      ],
      rates,
    );
    expect(r).toMatchObject({ medianCents: 2400, basis: "same_photo", offers: 3, stores: 3 });
  });

  it("is null without either", () => {
    expect(productRetailPrice([found(1000, "a.com", false)], rates)).toBeNull();
  });
});
