import { fetchWithRetry, HttpError, type RetryOptions } from "../http";
import type { CachedToken, TokenStore } from "../token-store";
import type { FetchedItem } from "../types";
import { cjErrorKind, type CjErrorKind } from "./cj-failure";

export { cjErrorKind, type CjErrorKind } from "./cj-failure";

/**
 * CJ Dropshipping API v2 (official, ADR-005 / ADR-014). Supplier cost, how many CJ users list
 * a product and CJ's own sales counts. Field names and limits were measured with real requests
 * on 2026-10-11 (docs/research/cj-api.md): the docs and the live API differ in places.
 */
export const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1/";
/** `source_items.provider` and the `api_tokens` / `source_backoff` key for the official API. */
export const CJ_PROVIDER = "cj_api";

/** Points left / used, returned with every answer (`pointsInfo`). */
export interface CjPointsInfo {
  total: number;
  usedToday: number;
  remaining: number;
}

interface CjResponse<T> {
  code: number;
  result: boolean;
  message: string;
  data: T | null;
  requestId?: string;
  pointsInfo?: CjPointsInfo;
}

/** Item of `data.content[].productList` from `GET product/listV2` (fields we use). */
export interface CjListProduct {
  id: string;
  nameEn: string;
  sku?: string;
  bigImage?: string;
  /** USD; may be a range such as "2.47 -- 3.10" for products with variants. */
  sellPrice?: string;
  /** Discounted price, e.g. "3.89" or "0.52-3.89"; null when there is no discount. */
  nowPrice?: string | null;
  /** Number of CJ users that listed the product in their stores. */
  listedNum?: number;
  /** "3" = on sale. */
  saleStatus?: string;
  categoryId?: string;
  threeCategoryName?: string;
  /** Epoch ms when the product was added to CJ. */
  createAt?: number;
  warehouseInventoryNum?: number;
}

export type CjListV2Response = CjResponse<{
  pageSize: number;
  pageNumber: number;
  /** Capped at 6000 by CJ. */
  totalRecords: number;
  totalPages: number;
  content: Array<{ productList: CjListProduct[] }>;
}>;

/**
 * `POST product/productDetail/query` (only the fields we use; note the lowercase names). Costs
 * no points. `soldOut` is documented as 90-day sales but was null for every product we tried;
 * `orderCount` / `totalQuantity` are filled but CJ does not document their period.
 */
export interface CjProductDetail {
  id: string;
  nameen?: string;
  sellprice?: string;
  listed?: number | null;
  /** Units sold in the last 90 days (documented); often null. */
  soldOut?: number | null;
  /** Orders under this SPU (period not documented). */
  orderCount?: number | null;
  /** Units in those orders (period not documented; the dispute rate's denominator). */
  totalQuantity?: number | null;
  totalRefundQuantity?: number | null;
  /** Epoch ms of the latest paid order. */
  latestPaymentDate?: number | null;
  /** When the product was added to CJ, epoch ms as a string ("1588790768000"). */
  createdate?: string | null;
  saleStatus?: string;
  /** The variants (measured: `id` is the variant id `vid`, `variantkey` e.g. "Blue-40cm"). */
  stanProducts?: Array<{
    id?: string;
    variantkey?: string | null;
    sellprice?: string | number | null;
    nowPrice?: string | number | null;
    /** Grams. */
    weight?: number | string | null;
  }> | null;
}

/** One CJ variant: what a store actually buys and ships (ADR-017). */
export interface CjVariant {
  vid: string;
  /** CJ's variant name, e.g. "Blue-40cm". */
  key: string;
  priceCents: number;
  /** Grams (drives the shipping cost). */
  weightG: number | null;
}

/** The variants of a detail answer that have an id and a price. */
export function parseCjVariants(d: CjProductDetail): CjVariant[] {
  return (d.stanProducts ?? []).flatMap((v) => {
    const priceCents = parseCjPriceCents(v.nowPrice ?? v.sellprice ?? undefined);
    if (!v.id || priceCents === undefined) return [];
    const w = Number(v.weight);
    return [
      {
        vid: String(v.id),
        key: (v.variantkey ?? "").trim(),
        priceCents,
        weightG: Number.isFinite(w) && w > 0 ? w : null,
      },
    ];
  });
}

export type CjProductDetailResponse = CjResponse<CjProductDetail>;

/** `POST logistic/freightCalculate` (10 points; USD). */
export type CjFreightResponse = CjResponse<
  Array<{
    logisticName: string;
    logisticAging: string;
    logisticPrice: number;
    /** Postage + taxes + clearance (measured: higher than the price for NZ). */
    totalPostageFee?: number | null;
  }>
>;

export class CjApiError extends Error {
  readonly kind: CjErrorKind;
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(`CJ API error ${code}: ${message}`);
    this.name = "CjApiError";
    this.kind = cjErrorKind(code, message, httpStatus);
  }
}

/** The source refused us (key, points, rate): stop asking CJ in this run (ADR-006). */
export function isCjStop(err: unknown): boolean {
  return err instanceof CjApiError && err.kind !== "other";
}

function unwrap<T>(res: CjResponse<T>): T {
  if (res.code !== 200 || !res.result || res.data === null) {
    throw new CjApiError(res.code, res.message);
  }
  return res.data;
}

/**
 * USD price in cents from values like "3.80", "2.47 -- 3.10" or "0.52-3.89": the highest price
 * of a variant range (ADR-016). The lowest is often an accessory or a part (e.g. a plush toy's
 * empty "shell" at 1.00), which made gross margins look like 96 %; the highest never overstates
 * a margin. Which variant the stores sell is unknown (no variant matching yet).
 */
export function parseCjPriceCents(price: string | number | null | undefined): number | undefined {
  if (price === null || price === undefined || price === "") return undefined;
  if (typeof price === "number") return Math.round(price * 100);
  const numbers = price.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.length ? Math.round(Math.max(...numbers) * 100) : undefined;
}

/** CJ's public product page (the site asks browsers to pass a check; we never fetch it). */
export function cjProductUrl(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `https://cjdropshipping.com/product/${slug}-p-${encodeURIComponent(id)}.html`;
}

/** Metrics of one CJ product; only numbers CJ actually returned (nothing filled in). */
export function cjMetrics(p: CjListProduct, d?: CjProductDetail | null): FetchedItem["metrics"] {
  const metrics: FetchedItem["metrics"] = [];
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const listed = num(d?.listed) ? d.listed : p.listedNum;
  if (num(listed)) metrics.push({ metric: "stores_listed", value: listed });
  if (num(d?.soldOut)) metrics.push({ metric: "units_sold_90d", value: d.soldOut });
  if (num(d?.orderCount)) metrics.push({ metric: "orders_total", value: d.orderCount });
  if (num(d?.totalQuantity)) metrics.push({ metric: "units_total", value: d.totalQuantity });
  return metrics;
}

/** One CJ product as a listing item (supplier cost in USD cents, CJ counts as metrics). */
export function cjListingItem(p: CjListProduct, d?: CjProductDetail | null): FetchedItem {
  return {
    externalId: p.id,
    kind: "listing",
    title: p.nameEn,
    url: cjProductUrl(p.id, p.nameEn),
    imageUrl: p.bigImage,
    priceCents: parseCjPriceCents(p.nowPrice ?? p.sellPrice),
    currency: "USD",
    metrics: cjMetrics(p, d),
    raw: { list: p, detail: d ?? null },
  };
}

/**
 * Turns a listV2 page into listing items, enriched with product details where available
 * (fixtures and tests; the pipeline runner calls the client itself).
 */
export function parseCjProducts(
  list: CjListV2Response,
  details: CjProductDetailResponse[] = [],
): FetchedItem[] {
  const detailById = new Map(details.map((d) => unwrap(d)).map((d) => [d.id, d]));
  return unwrap(list).content.flatMap((c) =>
    c.productList.map((p) => cjListingItem(p, detailById.get(p.id))),
  );
}

export interface ShippingOption {
  carrier: string;
  costCents: number;
  minDays: number | null;
  maxDays: number | null;
}

/**
 * Shipping options for one destination, cheapest first. "2-5" → 2..5 days. The cost is the
 * total postage fee (taxes and clearance included) when CJ gives one.
 */
export function parseCjFreight(res: CjFreightResponse): ShippingOption[] {
  return unwrap(res)
    .map((o) => {
      const [min, max] = (o.logisticAging.match(/\d+/g) ?? []).map(Number);
      return {
        carrier: o.logisticName,
        costCents: Math.round((o.totalPostageFee ?? o.logisticPrice) * 100),
        minDays: min ?? null,
        maxDays: max ?? min ?? null,
      };
    })
    .sort((a, b) => a.costCents - b.costCents);
}

// --- Live client ------------------------------------------------------------------------------

/** A stored token is replaced this long before CJ says it expires (CJ's offsets look off). */
export const CJ_TOKEN_RENEW_BEFORE_MS = 7 * 86_400_000;

export interface CjListQuery {
  keyword?: string;
  page?: number;
  size?: number;
}

export interface CjListResult {
  products: CjListProduct[];
  totalRecords: number;
  points: CjPointsInfo | null;
}

export interface CjClient {
  listProducts(q: CjListQuery, signal?: AbortSignal): Promise<CjListResult>;
  /** Shipping options for one variant from China (10 points per call). */
  freight(
    q: { vid: string; to: string; from?: string },
    signal?: AbortSignal,
  ): Promise<{ options: ShippingOption[]; points: CjPointsInfo | null }>;
  productDetail(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ detail: CjProductDetail; points: CjPointsInfo | null }>;
}

export interface CjClientOptions {
  apiKey: string;
  tokens: TokenStore;
  /** Defaults to one attempt: a CJ refusal must stop the run, never start a retry storm. */
  retry?: RetryOptions;
  now?: () => number;
  /**
   * Awaited before every HTTP request, the access-token request included: CJ counts every call
   * toward its 1 request/second limit (docs/research/cj-api.md, ADR-014), so the caller paces
   * them all.
   */
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
}

/** "2027-04-09T09:09:07+08:00" → Date; unreadable → null. */
function parseExpiry(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * CJ client: the access token comes from `tokens` and is only requested from CJ (a rate-limited
 * endpoint) when there is none or it is about to expire. A refused token is cleared so the next
 * run asks for a new one. The API key never appears in errors or logs.
 */
export function createCjClient({
  apiKey,
  tokens,
  retry = {},
  now = Date.now,
  beforeRequest,
}: CjClientOptions): CjClient {
  const opts: RetryOptions = { retries: 0, timeoutMs: 20_000, ...retry };
  const secrets = [apiKey];
  // CJ's error messages are stored and shown: never let a key or token echoed back leak.
  const redact = (text: string) =>
    secrets.reduce(
      // Real keys and tokens are long; a short string would mangle ordinary words.
      (t, secret) => (secret.length >= 8 ? t.split(secret).join("[redacted]") : t),
      text,
    );

  async function call<T>(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<CjResponse<T>> {
    await beforeRequest?.(signal);
    let res: Response;
    try {
      res = await fetchWithRetry(
        CJ_API_BASE + path,
        { ...init, signal },
        {
          ...opts,
          // CJ answers errors as JSON (sometimes with HTTP 429): read the body to classify them.
          acceptStatus: (s) => s === 429 || s === 401 || s === 403,
        },
      );
    } catch (err) {
      if (err instanceof HttpError) {
        throw new CjApiError(
          err.status,
          `HTTP ${err.status} from ${path.split("?")[0]}`,
          err.status,
        );
      }
      throw err;
    }
    const text = await res.text();
    let body: CjResponse<T>;
    try {
      body = JSON.parse(text) as CjResponse<T>;
    } catch {
      throw new CjApiError(res.status, `Unreadable answer (HTTP ${res.status})`, res.status);
    }
    if (!res.ok || body.code !== 200 || !body.result) {
      throw new CjApiError(body.code ?? res.status, redact(String(body.message ?? "")), res.status);
    }
    return body;
  }

  async function freshToken(signal?: AbortSignal): Promise<string> {
    const body = await call<{ accessToken?: string; accessTokenExpiryDate?: string }>(
      "authentication/getAccessToken",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      },
      signal,
    );
    const token = body.data?.accessToken;
    if (token) secrets.push(token);
    const expiresAt = parseExpiry(body.data?.accessTokenExpiryDate);
    if (!token || !expiresAt) throw new CjApiError(body.code, "Token answer without a token");
    const cached: CachedToken = { token, expiresAt };
    await tokens.set(cached);
    return token;
  }

  async function token(signal?: AbortSignal): Promise<string> {
    const cached = await tokens.get();
    if (cached) secrets.push(cached.token);
    if (cached && cached.expiresAt.getTime() - CJ_TOKEN_RENEW_BEFORE_MS > now()) {
      return cached.token;
    }
    return freshToken(signal);
  }

  async function authed<T>(path: string, init: RequestInit, signal?: AbortSignal) {
    const t = await token(signal);
    try {
      return await call<T>(
        path,
        { ...init, headers: { ...(init.headers ?? {}), "CJ-Access-Token": t } },
        signal,
      );
    } catch (err) {
      // A refused token is never reused; the next run asks CJ for a new one.
      if (err instanceof CjApiError && err.kind === "auth") await tokens.clear();
      throw err;
    }
  }

  return {
    async listProducts(q, signal) {
      const params = new URLSearchParams({
        page: String(q.page ?? 1),
        size: String(q.size ?? 20),
        // CJ's best match (relevance). Never the listing count: it is not sales (ADR-014).
        orderBy: "0",
        sort: "desc",
      });
      if (q.keyword) params.set("keyWord", q.keyword);
      const body = await authed<NonNullable<CjListV2Response["data"]>>(
        `product/listV2?${params}`,
        { method: "GET" },
        signal,
      );
      const data = body.data!;
      return {
        products: data.content.flatMap((c) => c.productList ?? []),
        totalRecords: data.totalRecords,
        points: body.pointsInfo ?? null,
      };
    },
    async freight({ vid, to, from = "CN" }, signal) {
      const body = await authed<NonNullable<CjFreightResponse["data"]>>(
        "logistic/freightCalculate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startCountryCode: from,
            endCountryCode: to,
            products: [{ quantity: 1, vid }],
          }),
        },
        signal,
      );
      return {
        options: parseCjFreight(body as CjFreightResponse),
        points: body.pointsInfo ?? null,
      };
    },
    async productDetail(id, signal) {
      const body = await authed<CjProductDetail>(
        "product/productDetail/query",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        },
        signal,
      );
      return { detail: body.data!, points: body.pointsInfo ?? null };
    },
  };
}
