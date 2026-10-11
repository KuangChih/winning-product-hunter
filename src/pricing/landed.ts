/**
 * Landed cost of a CJ product (ADR-017): which variant's price to use, which shipping option,
 * and the margin after both. Conservative throughout: when the variant a store sells is not
 * known, the most expensive variant is used (never overstates a margin), and a margin is only
 * given when retail, the variant's price and a shipping cost are all known.
 */
import type { CjVariant, ShippingOption } from "@/ingestion/sources/cj";

/** A shipping option counts only if it arrives within this many days (max of CJ's range). */
export const MAX_DELIVERY_DAYS = 15;
/** Destination of the landed cost: the retail price is the US price (`productRetailPrice`). */
export const LANDED_COUNTRY = "US";

/**
 * - `single_price`: every variant costs the same: no doubt about the price;
 * - `store_options`: only the variants whose name matches options the same-photo stores offer
 *   (e.g. store sizes "40 cm", "60 cm" ↔ CJ "Blue-40cm"), the most expensive of those;
 * - `max_variant`: the store's variant is unknown: the most expensive variant.
 */
export type VariantBasis = "single_price" | "store_options" | "max_variant";

export interface VariantChoice {
  /** The variant shipping is quoted for: the heaviest of the chosen set. */
  variant: CjVariant;
  /** The cost used: the highest price of the chosen set. */
  priceCents: number;
  basis: VariantBasis;
  matched: number;
  total: number;
}

/** "40 cm" → "40cm"; "Light Purple" → "lightpurple". */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** "Blue-40cm" → ["blue", "40cm"]. */
export function variantTokens(key: string): string[] {
  return key
    .split(/[-/|,]+/)
    .map(norm)
    .filter(Boolean);
}

function pick(set: CjVariant[], basis: VariantBasis, total: number): VariantChoice {
  const priceCents = Math.max(...set.map((v) => v.priceCents));
  const variant = [...set].sort(
    (a, b) => (b.weightG ?? 0) - (a.weightG ?? 0) || b.priceCents - a.priceCents,
  )[0];
  return { variant, priceCents, basis, matched: set.length, total };
}

/**
 * Chooses the variants a margin is based on. `storeLabels` holds, per same-photo store, the
 * labels of the options it sells (Shopify catalog `options[].values[].label`). A CJ variant is
 * offered by a store when every part of its name is one of that store's labels.
 */
export function chooseVariant(
  variants: CjVariant[],
  storeLabels: string[][] = [],
): VariantChoice | null {
  if (variants.length === 0) return null;
  if (new Set(variants.map((v) => v.priceCents)).size === 1) {
    return pick(variants, "single_price", variants.length);
  }
  const offered = variants.filter((v) => {
    const tokens = variantTokens(v.key);
    return (
      tokens.length > 0 &&
      storeLabels.some((labels) => {
        const have = new Set(labels.map(norm));
        return tokens.every((t) => have.has(t));
      })
    );
  });
  return offered.length > 0
    ? pick(offered, "store_options", variants.length)
    : pick(variants, "max_variant", variants.length);
}

/** The cheapest option that arrives within `maxDays` (by CJ's upper estimate); null if none. */
export function chooseShipping(
  options: ShippingOption[],
  maxDays = MAX_DELIVERY_DAYS,
): ShippingOption | null {
  return (
    options
      .filter((o) => o.maxDays !== null && o.maxDays <= maxDays)
      .sort((a, b) => a.costCents - b.costCents)[0] ?? null
  );
}

export interface LandedMargin {
  retailUsdCents: number;
  supplierUsdCents: number;
  freightUsdCents: number;
  profitUsdCents: number;
  /** (retail − supplier − shipping) / retail; can be negative. */
  margin: number;
}

/** Null unless all three are known (never estimated). */
export function landedMargin(
  retailUsdCents: number | null,
  supplierUsdCents: number | null,
  freightUsdCents: number | null,
): LandedMargin | null {
  if (retailUsdCents === null || retailUsdCents <= 0) return null;
  if (supplierUsdCents === null || freightUsdCents === null) return null;
  const profit = retailUsdCents - supplierUsdCents - freightUsdCents;
  return {
    retailUsdCents,
    supplierUsdCents,
    freightUsdCents,
    profitUsdCents: profit,
    margin: profit / retailUsdCents,
  };
}
