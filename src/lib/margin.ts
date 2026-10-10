import { convertCents, type FxRates } from "./fx";
import { marketRetailPrice } from "./retail-price";

export interface MarginInput {
  kind: string;
  source: string;
  priceCents: number | null;
  currency: string | null;
}

export interface MarginEstimate {
  /** Median US retail price across stores selling it, in USD cents. */
  retailUsdCents: number | null;
  /** Store offers behind the retail median. */
  retailOffers: number;
  /** Cheapest supplier listing, in USD cents. */
  supplierUsdCents: number | null;
  supplierListings: number;
  /** Retail minus supplier cost, before shipping, ads and fees. */
  grossProfitUsdCents: number | null;
  /** Gross margin as a fraction of retail (e.g. 0.62). */
  grossMargin: number | null;
  /** What is missing for a full estimate, in plain words. */
  missing: string[];
}

/**
 * Gross margin before shipping, same inputs as the scoring margin signal: the US median store
 * price (other currencies converted with ECB rates) against the cheapest supplier listing.
 * Supplier prices without a currency are CJ's, which quotes in USD.
 */
export function estimateMargin(items: MarginInput[], rates: FxRates | null): MarginEstimate {
  const offers = items
    .filter((i) => i.kind === "store_product" && i.priceCents !== null)
    .map((i) => ({ priceCents: i.priceCents!, currency: i.currency }));
  const retail = marketRetailPrice(offers, "US", rates);

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
  const missing: string[] = [];
  if (retailUsdCents === null) {
    missing.push("a retail price from stores selling it (Shopify Global Catalog)");
  }
  if (supplier === null) {
    missing.push("a supplier cost (CJ Dropshipping listing)");
  }

  const complete = retailUsdCents !== null && supplier !== null && retailUsdCents > 0;
  const profit = complete ? retailUsdCents - supplier : null;
  return {
    retailUsdCents,
    retailOffers: retail?.offers ?? 0,
    supplierUsdCents: supplier,
    supplierListings: supplierPrices.length,
    grossProfitUsdCents: profit,
    grossMargin: complete ? profit! / retailUsdCents : null,
    missing,
  };
}
