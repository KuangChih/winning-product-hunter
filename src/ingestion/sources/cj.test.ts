import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryTokenStore } from "../token-store";
import {
  CjApiError,
  cjListingItem,
  createCjClient,
  CJ_TOKEN_RENEW_BEFORE_MS,
  isCjStop,
  type CjListV2Response,
  type CjProductDetailResponse,
} from "./cj";
import { cjFailureKind } from "./cj-failure";

// Real answers recorded on 2026-10-11 (trimmed to the fields we use; no account data).
const rec = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "__recordings__", name), "utf8"));
const listJson = rec("cj-list-v2.json") as CjListV2Response;
const detailJson = rec("cj-product-detail.json") as CjProductDetailResponse;

const API_KEY = "CJ0000000@api@test-key-not-real";
const NOW = Date.parse("2026-10-11T00:00:00Z");
const tokenAnswer = (token = "token-1", expiry = "2027-04-09T09:09:07+08:00") =>
  Response.json({
    code: 200,
    result: true,
    message: "Success",
    data: {
      openId: 0,
      accessToken: token,
      accessTokenExpiryDate: expiry,
      refreshToken: "refresh",
      refreshTokenExpiryDate: expiry,
      createDate: "2026-10-11T09:09:07+08:00",
    },
  });

function client(
  answer: (url: string, init?: RequestInit) => Response,
  store = createMemoryTokenStore(),
) {
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => answer(String(url), init));
  const c = createCjClient({
    apiKey: API_KEY,
    tokens: store,
    retry: { fetchImpl },
    now: () => NOW,
  });
  return { c, fetchImpl, store };
}

describe("CJ client (recorded answers)", () => {
  it("gets a token once, sends it as CJ-Access-Token and reuses it", async () => {
    const { c, fetchImpl, store } = client((url) =>
      url.includes("getAccessToken")
        ? tokenAnswer()
        : url.includes("listV2")
          ? Response.json(listJson)
          : Response.json(detailJson),
    );
    const list = await c.listProducts({ keyword: "posture corrector", size: 50 });
    const detail = await c.productDetail("5F9B011D-3393-4B82-A414-491ADE80C872");

    expect(list.products).toHaveLength(6);
    expect(list.points).toEqual({ total: 50000, usedToday: 150, remaining: 50000 });
    expect(detail.detail).toMatchObject({ soldOut: null, orderCount: 137, listed: 23657 });
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.includes("getAccessToken"))).toHaveLength(1);
    const listUrl = new URL(urls.find((u) => u.includes("listV2"))!);
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      page: "1",
      size: "50",
      orderBy: "1",
      sort: "desc",
      keyWord: "posture corrector",
    });
    const headers = fetchImpl.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["CJ-Access-Token"]).toBe("token-1");
    // The API key is only ever sent in the token request body.
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain(API_KEY);
    expect(urls.join(" ")).not.toContain(API_KEY);
    expect(await store.get()).toEqual({
      token: "token-1",
      expiresAt: new Date("2027-04-09T01:09:07Z"),
    });
  });

  it("uses a stored token and renews it only shortly before it expires", async () => {
    const fresh = createMemoryTokenStore({
      token: "stored",
      expiresAt: new Date(NOW + CJ_TOKEN_RENEW_BEFORE_MS + 60_000),
    });
    const a = client(() => Response.json(detailJson), fresh);
    await a.c.productDetail("x");
    expect(a.fetchImpl).toHaveBeenCalledTimes(1);

    const expiring = createMemoryTokenStore({
      token: "old",
      expiresAt: new Date(NOW + CJ_TOKEN_RENEW_BEFORE_MS - 60_000),
    });
    const b = client(
      (url) => (url.includes("getAccessToken") ? tokenAnswer("new") : Response.json(detailJson)),
      expiring,
    );
    await b.c.productDetail("x");
    expect(b.fetchImpl).toHaveBeenCalledTimes(2);
    expect((await expiring.get())?.token).toBe("new");
  });

  it("classifies refusals, clears a refused token and never echoes the key", async () => {
    const store = createMemoryTokenStore({
      token: "bad",
      expiresAt: new Date(NOW + 300 * 86_400_000),
    });
    const { c } = client(
      () => Response.json({ code: 1600001, result: false, message: "Invalid token", data: null }),
      store,
    );
    const err = await c.productDetail("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CjApiError);
    expect((err as CjApiError).kind).toBe("auth");
    expect(isCjStop(err)).toBe(true);
    expect(await store.get()).toBeNull();

    const points = client(
      () =>
        Response.json(
          {
            code: 429,
            result: false,
            message: "Insufficient API points. Used today: 50000, Remaining: 0, Required: 50",
            data: null,
          },
          { status: 429 },
        ),
      createMemoryTokenStore({ token: "t", expiresAt: new Date(NOW + 300 * 86_400_000) }),
    );
    const pErr = (await points.c.listProducts({}).catch((e: unknown) => e)) as CjApiError;
    expect(pErr.kind).toBe("points");
    // One attempt: a refusal is never retried.
    expect(points.fetchImpl).toHaveBeenCalledTimes(1);

    const echo = client(() =>
      Response.json({
        code: 1601000,
        result: false,
        message: `User not find: ${API_KEY}`,
        data: null,
      }),
    );
    const eErr = (await echo.c.listProducts({}).catch((e: unknown) => e)) as CjApiError;
    expect(eErr.kind).toBe("auth");
    expect(eErr.message).not.toContain(API_KEY);

    const rate = client(
      () =>
        Response.json({ code: 1600200, result: false, message: "Call exceeded limit", data: null }),
      createMemoryTokenStore({ token: "t", expiresAt: new Date(NOW + 300 * 86_400_000) }),
    );
    const rErr = (await rate.c.listProducts({}).catch((e: unknown) => e)) as CjApiError;
    expect(rErr.kind).toBe("rate_limited");
    expect(cjFailureKind(rErr.message)).toBe("rate_limited");
    expect(cjFailureKind("CJ API error 1600000: System busy")).toBe("service");
    expect(cjFailureKind("HTTP 403 from https://example.com")).toBeNull();
  });

  it("turns a CJ product into a listing with only the counts CJ returned", () => {
    const p = listJson.data!.content[0].productList[0];
    const item = cjListingItem(p, detailJson.data);
    expect(item).toMatchObject({
      externalId: "5F9B011D-3393-4B82-A414-491ADE80C872",
      kind: "listing",
      currency: "USD",
      // Discounted "0.52-3.89" → lowest price.
      priceCents: 389, // "0.52-3.89": the highest variant price (ADR-016)
      metrics: [
        { metric: "stores_listed", value: 23657 },
        { metric: "orders_total", value: 137 },
        { metric: "units_total", value: 166 },
      ],
    });
    expect(item.metrics.find((m) => m.metric === "units_sold_90d")).toBeUndefined();
    expect(item.url).toBe(
      "https://cjdropshipping.com/product/magic-shadow-usb-air-humidifier-for-home-with-projection-night-lights-ultrasonic-p-5F9B011D-3393-4B82-A414-491ADE80C872.html",
    );
  });
});
