import { convertCents, type FxRates } from "./fx";

import { marketCurrency } from "./markets";

/**
 * Store listings come from two places (data-quality fix B):
 * - the advertiser's own product page, looked up from the ad's landing URL: this product;
 * - a catalog search by the product's title: *similar* products from other stores, useful as
 *   a market reference and for competition, but not this product's price — except results
 *   whose photo is the product's own photo (ADR-016): the same product sold by another store.
 */
export const OWN_LISTING_PROVIDER = "shopify_catalog_lookup";

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

/** Where a product's retail price comes from (ADR-016). */
export type RetailBasis = "own_listing" | "same_photo";

export interface RetailItem {
  kind: string;
  provider?: string;
  priceCents: number | null;
  currency: string | null;
  /** Seller (store domain), to count each store once. */
  advertiserId?: string | null;
  countries?: string[];
  /** True when this search result shows the product's own photo (see `isSamePhoto`). */
  samePhoto?: boolean | null;
}

export interface ProductRetail extends MarketPrice {
  basis: RetailBasis;
  /** Stores behind a same-photo price. */
  stores: number;
}

/**
 * This product's US retail price: the advertiser's own listing when there is one; otherwise the
 * median of other stores selling the same product (same photo), one listing per store (its US
 * listing when it has one). Similar products never count.
 */
export function productRetailPrice(
  items: RetailItem[],
  rates: FxRates | null,
): ProductRetail | null {
  const offer = (i: RetailItem): Offer => ({ priceCents: i.priceCents!, currency: i.currency });
  const own = items.filter(
    (i) =>
      i.kind === "store_product" && i.provider === OWN_LISTING_PROVIDER && i.priceCents !== null,
  );
  const ownPrice = marketRetailPrice(own.map(offer), "US", rates);
  if (ownPrice) return { ...ownPrice, basis: "own_listing", stores: 0 };

  const bySeller = new Map<string, RetailItem>();
  for (const i of items) {
    if (i.kind !== "store_product" || !i.samePhoto || i.priceCents === null || !i.advertiserId) {
      continue;
    }
    const prev = bySeller.get(i.advertiserId);
    if (!prev || (!prev.countries?.includes("US") && i.countries?.includes("US"))) {
      bySeller.set(i.advertiserId, i);
    }
  }
  const same = marketRetailPrice([...bySeller.values()].map(offer), "US", rates);
  return same ? { ...same, basis: "same_photo", stores: same.offers } : null;
}
