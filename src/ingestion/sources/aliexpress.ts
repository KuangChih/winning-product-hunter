import type { FetchedItem } from "../types";

/**
 * Product from AliExpress Affiliate `aliexpress.affiliate.product.query` /
 * `hotproduct.query` (subset). Field names follow third-party wrappers and must be checked
 * against a live response; the API is known to spell the volume field `lastest_volume`.
 */
export interface AliExpressProduct {
  product_id: number | string;
  product_title: string;
  product_main_image_url?: string;
  product_detail_url?: string;
  target_sale_price?: string;
  target_sale_price_currency?: string;
  target_original_price?: string;
  lastest_volume?: number;
  latest_volume?: number;
  evaluate_rate?: string;
  first_level_category_name?: string;
  second_level_category_name?: string;
}

export interface AliExpressProductQueryResponse {
  resp_result: {
    resp_code: number;
    resp_msg?: string;
    result?: {
      current_page_no?: number;
      total_record_count?: number;
      products?: { product: AliExpressProduct[] };
    };
  };
}

export class AliExpressApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`AliExpress API error ${code}: ${message}`);
    this.name = "AliExpressApiError";
  }
}

function toCents(price: string | undefined): number | undefined {
  if (!price) return undefined;
  const n = Number.parseFloat(price);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** "96.5%" -> 96.5 */
function toPercent(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const n = Number.parseFloat(rate);
  return Number.isFinite(n) ? n : undefined;
}

export function parseAliExpressProduct(p: AliExpressProduct): FetchedItem {
  const metrics: FetchedItem["metrics"] = [];
  const volume = p.lastest_volume ?? p.latest_volume;
  if (typeof volume === "number") metrics.push({ metric: "orders_recent", value: volume });
  const rating = toPercent(p.evaluate_rate);
  if (rating !== undefined) metrics.push({ metric: "positive_feedback_pct", value: rating });

  return {
    externalId: String(p.product_id),
    kind: "listing",
    title: p.product_title,
    url: p.product_detail_url ?? `https://www.aliexpress.com/item/${p.product_id}.html`,
    imageUrl: p.product_main_image_url,
    priceCents: toCents(p.target_sale_price),
    currency: p.target_sale_price_currency,
    metrics,
    raw: p,
  };
}

export function parseAliExpressResponse(res: AliExpressProductQueryResponse): FetchedItem[] {
  const { resp_code, resp_msg, result } = res.resp_result;
  if (resp_code !== 200) throw new AliExpressApiError(resp_code, resp_msg ?? "unknown error");
  return (result?.products?.product ?? []).map(parseAliExpressProduct);
}
