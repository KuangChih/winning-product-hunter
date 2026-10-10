import { convertCents, type FxRates } from "./fx";
import { marketRetailPrice, OWN_LISTING_PROVIDER } from "./retail-price";

export interface MarginInput {
  kind: string;
  source: string;
  provider?: string;
  priceCents: number | null;
  currency: string | null;
}

export type MissingMarginInput = "retail" | "supplier";

export interface MarginEstimate {
  /** The advertiser's own store price (median if several stores), in USD cents. */
  retailUsdCents: number | null;
  /** Advertiser store listings behind that price. */
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
 * Gross margin before shipping, same inputs as the scoring margin signal: the US median store
 * price (other currencies converted with ECB rates) against the cheapest supplier listing.
 * Supplier prices without a currency are CJ's, which quotes in USD.
 */
export function estimateMargin(items: MarginInput[], rates: FxRates | null): MarginEstimate {
  const offers = items
    // Similar products from a catalog search are not this product's price.
    .filter(
      (i) =>
        i.kind === "store_product" && i.provider === OWN_LISTING_PROVIDER && i.priceCents !== null,
    )
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
  const missing: MissingMarginInput[] = [];
  if (retailUsdCents === null) missing.push("retail");
  if (supplier === null) missing.push("supplier");

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
