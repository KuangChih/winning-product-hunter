import { convertCents, type FxRates } from "./fx";
import { landedMargin } from "@/pricing/landed";
import { productRetailPrice, type RetailBasis, type RetailItem } from "./retail-price";

export interface MarginInput extends RetailItem {
  source: string;
}

export type MissingMarginInput = "retail" | "supplier" | "shipping";

/** The CJ landed cost behind a margin (`cj_landed_costs`, ADR-017). */
export interface LandedCostRow {
  country: string;
  variantKey: string;
  variantPriceCents: number;
  variantBasis: string;
  matchedVariants: number;
  totalVariants: number;
  carrier: string | null;
  freightCents: number | null;
  minDays: number | null;
  maxDays: number | null;
  maxDaysAllowed: number;
  quotedAt: Date;
}

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
  /** The CJ variant and shipping quote, when quoted (supplier cost is then the variant's price). */
  landed: LandedCostRow | null;
  /** Shipping to the US for that variant; null without a usable quote. */
  shippingUsdCents: number | null;
  /** Retail minus supplier cost and shipping, before ads and fees. */
  grossProfitUsdCents: number | null;
  /** Landed margin as a fraction of retail (e.g. 0.32; can be negative). */
  grossMargin: number | null;
  /** Inputs missing for a full estimate (the UI words them). */
  missing: MissingMarginInput[];
}

/**
 * Gross margin before shipping, same inputs as the scoring margin signal: the product's US
 * price (`productRetailPrice`; other currencies converted with ECB rates) against the cheapest
 * supplier listing. Supplier prices without a currency are CJ's, which quotes in USD.
 */
export function estimateMargin(
  items: MarginInput[],
  rates: FxRates | null,
  landed: LandedCostRow | null = null,
): MarginEstimate {
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
  const supplier = landed
    ? landed.variantPriceCents
    : supplierPrices.length
      ? Math.min(...supplierPrices)
      : null;
  const shipping = landed?.freightCents ?? null;

  const retailUsdCents = retail?.medianCents ?? null;
  const missing: MissingMarginInput[] = [];
  if (retailUsdCents === null) missing.push("retail");
  if (supplier === null) missing.push("supplier");
  if (shipping === null) missing.push("shipping");

  const m = landedMargin(retailUsdCents, supplier, shipping);
  return {
    retailUsdCents,
    retailBasis: retail?.basis ?? null,
    retailOffers: retail?.offers ?? 0,
    supplierUsdCents: supplier,
    supplierListings: supplierPrices.length,
    landed,
    shippingUsdCents: shipping,
    grossProfitUsdCents: m?.profitUsdCents ?? null,
    grossMargin: m?.margin ?? null,
    missing,
  };
}
