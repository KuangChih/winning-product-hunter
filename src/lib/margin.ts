import { convertCents, type FxRates } from "./fx";
import { productRetailPrice, type RetailBasis, type RetailItem } from "./retail-price";

export interface MarginInput extends RetailItem {
  source: string;
}

export type MissingMarginInput = "retail" | "supplier";

export interface MarginEstimate {
  /**
   * The product's US price in USD cents: the advertiser's own store (median if several), else
   * the median of stores selling the same photo (`retailBasis`, ADR-016).
   */
  retailUsdCents: number | null;
  retailBasis: RetailBasis | null;
  /** Listings behind that price (one per store for same-photo prices). */
  retailOffers: number;
  /** Cheapest supplier listing, in USD cents. */
  supplierUsdCents: number | null;
  supplierListings: number;
  /** Retail minus supplier cost, before shipping, ads and fees. */
  grossProfitUsdCents: number | null;
  /** Gross margin as a fraction of retail (e.g. 0.62). */
  grossMargin: number | null;
  /** Inputs missing for a full estimate (the UI words them). */
  missing: MissingMarginInput[];
}

/**
 * Gross margin before shipping, same inputs as the scoring margin signal: the product's US
 * price (`productRetailPrice`; other currencies converted with ECB rates) against the cheapest
 * supplier listing. Supplier prices without a currency are CJ's, which quotes in USD.
 */
export function estimateMargin(items: MarginInput[], rates: FxRates | null): MarginEstimate {
  // Similar products from a catalog search are not this product's price; same photos are.
  const retail = productRetailPrice(items, rates);

  const supplierPrices = items
    .filter((i) => i.kind === "listing" && i.priceCents !== null)
    .map((i) => {
      const currency = i.currency ?? "USD";
      if (currency === "USD") return i.priceCents!;
      return rates ? convertCents(i.priceCents!, currency, "USD", rates) : null;
    })
    .filter((v): v is number => v !== null);
  const supplier = supplierPrices.length ? Math.min(...supplierPrices) : null;

  const retailUsdCents = retail?.medianCents ?? null;
  const missing: MissingMarginInput[] = [];
  if (retailUsdCents === null) missing.push("retail");
  if (supplier === null) missing.push("supplier");

  const complete = retailUsdCents !== null && supplier !== null && retailUsdCents > 0;
  const profit = complete ? retailUsdCents - supplier : null;
  return {
    retailUsdCents,
    retailBasis: retail?.basis ?? null,
    retailOffers: retail?.offers ?? 0,
    supplierUsdCents: supplier,
    supplierListings: supplierPrices.length,
    grossProfitUsdCents: profit,
    grossMargin: complete ? profit! / retailUsdCents : null,
    missing,
  };
}
