import type { FetchedItem } from "../types";

/**
 * CJ Dropshipping API v2 (https://developers.cjdropshipping.com/en/api/api2/api/product.html).
 * Supplier cost, how many stores list a product, and 90-day units sold (ADR-005).
 */

interface CjResponse<T> {
  code: number;
  result: boolean;
  message: string;
  data: T | null;
  requestId?: string;
}

/** Item of `data.content[].productList` from `GET product/listV2`. */
export interface CjListProduct {
  id: string;
  nameEn: string;
  sku?: string;
  bigImage?: string;
  /** USD; may be a range such as "2.47 -- 3.10" for products with variants. */
  sellPrice?: string;
  nowPrice?: string;
  /** Number of CJ users that listed the product in their stores. */
  listedNum?: number;
  categoryId?: string;
  createAt?: number;
  warehouseInventoryNum?: number;
}

export type CjListV2Response = CjResponse<{
  pageSize: number;
  pageNumber: number;
  totalRecords: number;
  totalPages: number;
  content: Array<{ productList: CjListProduct[] }>;
}>;

/** `POST product/productDetail/query` (only the fields we use; note the lowercase names). */
export type CjProductDetailResponse = CjResponse<{
  id: string;
  nameen?: string;
  sellprice?: string;
  listed?: number;
  /** Units sold in the last 90 days. */
  soldOut?: number;
  orderCount?: number;
  totalRefundQuantity?: number;
}>;

/** `POST logistic/freightCalculate`. */
export type CjFreightResponse = CjResponse<
  Array<{ logisticName: string; logisticAging: string; logisticPrice: number }>
>;

export class CjApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`CJ API error ${code}: ${message}`);
    this.name = "CjApiError";
  }
}

function unwrap<T>(res: CjResponse<T>): T {
  if (res.code !== 200 || !res.result || res.data === null) {
    throw new CjApiError(res.code, res.message);
  }
  return res.data;
}

/** Lowest USD price in cents from values like "3.80" or "2.47 -- 3.10". */
export function parseCjPriceCents(price: string | undefined): number | undefined {
  if (!price) return undefined;
  const numbers = price.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.length ? Math.round(Math.min(...numbers) * 100) : undefined;
}

/**
 * Turns a listV2 page into listing items, enriched with 90-day sales from product details
 * where available (details are a separate, costlier call, so they may be partial).
 */
export function parseCjProducts(
  list: CjListV2Response,
  details: CjProductDetailResponse[] = [],
): FetchedItem[] {
  const detailById = new Map(details.map((d) => unwrap(d)).map((d) => [d.id, d]));
  return unwrap(list).content.flatMap((c) =>
    c.productList.map((p) => {
      const d = detailById.get(p.id);
      const metrics: FetchedItem["metrics"] = [];
      const listed = p.listedNum ?? d?.listed;
      if (typeof listed === "number") metrics.push({ metric: "stores_listed", value: listed });
      if (typeof d?.soldOut === "number")
        metrics.push({ metric: "units_sold_90d", value: d.soldOut });
      if (typeof d?.orderCount === "number")
        metrics.push({ metric: "orders_total", value: d.orderCount });
      return {
        externalId: p.id,
        kind: "listing" as const,
        title: p.nameEn,
        imageUrl: p.bigImage,
        priceCents: parseCjPriceCents(p.nowPrice ?? p.sellPrice),
        currency: "USD",
        metrics,
        raw: { list: p, detail: d ?? null },
      };
    }),
  );
}

export interface ShippingOption {
  carrier: string;
  costCents: number;
  minDays: number | null;
  maxDays: number | null;
}

/** Shipping options for one destination, cheapest first. "2-5" → 2..5 days. */
export function parseCjFreight(res: CjFreightResponse): ShippingOption[] {
  return unwrap(res)
    .map((o) => {
      const [min, max] = (o.logisticAging.match(/\d+/g) ?? []).map(Number);
      return {
        carrier: o.logisticName,
        costCents: Math.round(o.logisticPrice * 100),
        minDays: min ?? null,
        maxDays: max ?? min ?? null,
      };
    })
    .sort((a, b) => a.costCents - b.costCents);
}
