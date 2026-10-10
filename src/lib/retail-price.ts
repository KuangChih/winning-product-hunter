import { convertCents, type FxRates } from "./fx";

/**
 * Store listings come from two places (data-quality fix B):
 * - the advertiser's own product page, looked up from the ad's landing URL: this product;
 * - a catalog search by the product's title: *similar* products from other stores, useful as
 *   a market reference and for competition, but not this product's price.
 */
export const OWN_LISTING_PROVIDER = "shopify_catalog_lookup";
import { marketCurrency } from "./markets";

export interface Offer {
  priceCents: number;
  currency: string | null;
}

export interface MarketPrice {
  medianCents: number;
  currency: string;
  /** Offers included in the median. */
  offers: number;
  /** Offers that had to be converted from another currency. */
  converted: number;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Median retail price of offers shipping to a country, in that market's local currency.
 * Offers in other currencies are converted with ECB rates when available; without rates only
 * offers already in the target currency count, so currencies are never mixed.
 */
export function marketRetailPrice(
  offers: Offer[],
  country: string,
  rates: FxRates | null,
): MarketPrice | null {
  const priced = offers.filter((o) => o.currency);
  const currency = marketCurrency(country) ?? mostCommon(priced.map((o) => o.currency!));
  if (!currency) return null;

  const values: number[] = [];
  let converted = 0;
  for (const o of priced) {
    if (o.currency === currency) {
      values.push(o.priceCents);
    } else if (rates) {
      const v = convertCents(o.priceCents, o.currency!, currency, rates);
      if (v !== null) {
        values.push(v);
        converted++;
      }
    }
  }
  if (values.length === 0) return null;
  return { medianCents: median(values), currency, offers: values.length, converted };
}
