// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiTokens,
  cjLandedCosts,
  ingestionRuns,
  productScores,
  products,
  signalSnapshots,
  sourceBackoff,
  sourceItems,
} from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { createCjClient, CJ_PROVIDER } from "@/ingestion/sources/cj";
import { createShopifyCatalogAdapter } from "@/ingestion/sources/shopify-catalog";
import { createDbTokenStore } from "@/ingestion/token-store";
import { parseEcbDaily } from "@/lib/fx";
import { CJ_INTERVAL_MS, CJ_QPS_ATTEMPTS } from "./cj-units";
import type { RunnerDeps } from "./deps";
import { driveRun } from "./drive";
import { recordBlock } from "./guards";
import { parseRunOptions } from "./options";
import { initialState, upgradeState } from "./state";
import { createRun } from "./store";
import type { RunState } from "./types";

const rec = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../ingestion/sources/__recordings__", name), "utf8");
const listJson = JSON.parse(rec("cj-list-v2.json"));
const detailJson = JSON.parse(rec("cj-product-detail.json"));
const catalogJson = JSON.parse(rec("shopify-catalog-search.json"));
const ecbXml = rec("ecb-eurofxref-daily.xml");
const NOW = new Date("2026-10-10T00:00:00Z");
const DAY = 86_400_000;
const API_KEY = "CJ0000000@api@runner-test-key";

/** CJ orders per product id in the recorded list (others: none). */
const ORDERS: Record<string, number> = {
  "5F9B011D-3393-4B82-A414-491ADE80C872": 137,
  "1392009095543918592": 29,
  "85C80F84-A4D8-4178-8227-4F797E312692": 682,
};

describe("pipeline runner: CJ discovery (ADR-014)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let cjFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    t = await createTestDb();
    cjFetch = vi.fn<typeof fetch>(async (url, init) => {
      const u = String(url);
      if (u.includes("getAccessToken")) {
        return Response.json({
          code: 200,
          result: true,
          message: "Success",
          data: {
            accessToken: "runner-test-access-token",
            accessTokenExpiryDate: "2027-04-09T09:09:07+08:00",
          },
        });
      }
      if (u.includes("listV2")) return Response.json(listJson);
      const id = JSON.parse(String(init?.body)).id as string;
      return Response.json({
        ...detailJson,
        data: {
          ...detailJson.data,
          id,
          orderCount: ORDERS[id] ?? 0,
          latestPaymentDate: ORDERS[id] ? NOW.getTime() - 2 * DAY : null,
        },
      });
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const deps = (extra: Partial<RunnerDeps> = {}): RunnerDeps => ({
    egress: "local",
    clock: { now: () => Date.now(), sleep: async () => {} },
    now: NOW,
    fetchFxRates: async () => parseEcbDaily(ecbXml),
    adLibrary: () => {
      throw new Error("Meta must not be asked while it blocks this egress");
    },
    cj: (db, o) =>
      createCjClient({
        ...o,
        apiKey: API_KEY,
        tokens: createDbTokenStore(db, CJ_PROVIDER, API_KEY),
        retry: { fetchImpl: cjFetch },
      }),
    shopifyCatalog: ({ countries, wait }) =>
      createShopifyCatalogAdapter({
        countries,
        wait,
        retry: { fetchImpl: async () => Response.json(catalogJson) },
      }),
    imageRetry: { fetchImpl: async () => new Response("", { status: 404 }) },
    ...extra,
  });
  const newRun = async () =>
    (
      await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions({
          keywords: ["posture corrector"],
          countries: ["US"],
          advertisers: 0,
          collect: 3,
        }),
        env: "local",
        now: NOW,
      })
    ).run;
  // Meta blocks this egress in every test: CJ must work without it.
  beforeEach(() =>
    recordBlock(t.db, "ad_library_web", "local", "HTTP 403 from Ad Library", new Date()),
  );

  it("finds products from CJ sales while Meta is blocked, and scores them", async () => {
    const run = await driveRun(t.db, deps(), (await newRun()).id);

    // (deps.adLibrary throws if Meta were asked during its back-off.)
    expect(run.state.steps.discover).toMatchObject({ status: "skipped", skipReason: "backoff" });
    const cj = run.state.steps.cj;
    expect(cj.status).toBe("done");
    // Token once, CJ trending + 1 keyword list, then one detail per listed product.
    const calls = cjFetch.mock.calls.map(([u]) => String(u));
    expect(calls.filter((u) => u.includes("getAccessToken"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("listV2"))).toHaveLength(2);
    expect(calls.filter((u) => u.includes("productDetail"))).toHaveLength(6);
    // Every HTTP request is counted and paced, the access token included.
    expect(cj.requests).toBe(9);
    expect(cj.pointsUsedToday).toBe(150);
    const trending = new URL(calls.find((u) => u.includes("productFlag=0"))!);
    expect(trending.searchParams.get("timeStart")).toBeNull();
    expect(trending.searchParams.get("orderBy")).toBe("1"); // most listed
    const keyword = new URL(calls.find((u) => u.includes("keyWord="))!);
    expect(Object.fromEntries(keyword.searchParams)).toMatchObject({
      keyWord: "posture corrector",
      orderBy: "1", // most listed (its first 20 results)
      size: "20",
    });

    // Only products with ≥ 50 CJ orders and a recent order are tracked.
    const tracked = await t.db.select().from(products);
    expect(tracked.map((p) => p.landingKey).sort()).toEqual([
      "cj:5F9B011D-3393-4B82-A414-491ADE80C872",
      "cj:85C80F84-A4D8-4178-8227-4F797E312692",
    ]);
    // As old as its CJ listing (the detail's createdate).
    expect(tracked[0].firstSeenAt.toISOString()).toBe("2020-05-06T18:46:08.000Z");
    const listings = (await t.db.select().from(sourceItems)).filter((i) => i.source === "cj");
    expect(listings).toHaveLength(2);
    expect(listings.every((l) => l.provider === CJ_PROVIDER && l.kind === "listing")).toBe(true);
    const metrics = (await t.db.select().from(signalSnapshots)).map((s) => s.metric);
    expect(metrics).toEqual(expect.arrayContaining(["orders_total", "stores_listed"]));
    expect(metrics).not.toContain("units_sold_90d");
    expect(run.state.results.cjProducts).toBe(2);
    expect(run.state.results.newProducts).toBe(2);

    // Scored on CJ's order count; ad sub-scores stay empty, never zero-filled.
    const scores = await t.db.select().from(productScores);
    expect(scores).toHaveLength(2);
    const b = scores[0].breakdown as {
      subScores: Record<string, { value: number | null; explain?: { key: string } }>;
    };
    expect(b.subScores.marketplace.explain?.key).toBe("marketplaceCjOrders");
    expect(b.subScores.marketplace.value).not.toBeNull();
    expect(b.subScores.longevity.value).toBeNull();
    expect(b.subScores.scaling.value).toBeNull();

    // The access token is stored encrypted, never in plain text.
    const [token] = await t.db.select().from(apiTokens);
    expect(token.provider).toBe(CJ_PROVIDER);
    expect(token.token).not.toContain("runner-test-access-token");
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter((r) => r.source === "cj");
    expect(ingestion).toMatchObject({
      status: "succeeded",
      itemsFetched: 2,
      pipelineRunId: run.id,
    });

    // The next run reuses the stored token and updates the same products.
    cjFetch.mockClear();
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(cjFetch.mock.calls.some(([u]) => String(u).includes("getAccessToken"))).toBe(false);
    expect(second.state.results.cjProducts).toBe(0);
    expect(await t.db.select().from(products)).toHaveLength(2);
  });

  it("is skipped as not configured without a CJ key", async () => {
    const run = await driveRun(t.db, deps({ cj: undefined }), (await newRun()).id);
    expect(run.state.steps.cj).toMatchObject({ status: "skipped", skipReason: "not_configured" });
    expect(run.state.steps.score.status).toBe("done");
  });

  it("stops at CJ's first refusal, backs off and is skipped during the back-off", async () => {
    cjFetch.mockImplementation(async (url) =>
      String(url).includes("getAccessToken")
        ? Response.json({
            code: 200,
            result: true,
            message: "Success",
            data: {
              accessToken: "runner-test-access-token",
              accessTokenExpiryDate: "2027-04-09T09:09:07+08:00",
            },
          })
        : Response.json(
            {
              code: 429,
              result: false,
              message: "Insufficient API points. Used today: 50000, Remaining: 0, Required: 50",
              data: null,
            },
            { status: 429 },
          ),
    );
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(cjFetch).toHaveBeenCalledTimes(2); // token + one list, never retried
    expect(run.status).toBe("partial");
    expect(run.state.steps.cj.status).toBe("failed");
    expect(run.state.steps.cj.error).toMatch(/Insufficient API points/);
    expect(run.state.steps.score.status).toBe("done");
    const [backoff] = (await t.db.select().from(sourceBackoff)).filter(
      (b) => b.provider === CJ_PROVIDER,
    );
    expect(backoff).toMatchObject({ egress: "local", strikes: 1 });
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter((r) => r.source === "cj");
    expect(ingestion.status).toBe("failed");

    cjFetch.mockClear();
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(cjFetch).not.toHaveBeenCalled();
    expect(second.state.steps.cj).toMatchObject({ status: "skipped", skipReason: "backoff" });
  });

  const qpsRefusal = () =>
    Response.json(
      {
        code: 1600200,
        result: false,
        message: "Too Many Requests, QPS limit is 1 time/1second",
        data: null,
      },
      { status: 429 },
    );

  it("spaces every CJ request, the token included, by the interval (send to send)", async () => {
    let now = Date.parse("2026-10-11T00:00:00Z");
    const sentAt: number[] = [];
    const inner = cjFetch.getMockImplementation()!;
    cjFetch.mockImplementation(async (url, init) => {
      sentAt.push(now);
      now += 300; // CJ answers in 0.3 s
      return inner(url, init);
    });
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    await driveRun(t.db, deps({ clock }), (await newRun()).id);
    expect(sentAt).toHaveLength(9);
    const gaps = sentAt.slice(1).map((v, i) => v - sentAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CJ_INTERVAL_MS);
  });

  it("sends a request CJ refused for its per-second limit again after a short wait, without a back-off", async () => {
    const inner = cjFetch.getMockImplementation()!;
    let refused = 0;
    cjFetch.mockImplementation(async (url, init) => {
      if (String(url).includes("listV2") && refused < 1) {
        refused++;
        return qpsRefusal();
      }
      return inner(url, init);
    });
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(run.state.steps.cj).toMatchObject({ status: "done", qpsRetries: 1, stopped: null });
    expect(run.state.results.cjProducts).toBe(2);
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.filter((b) => b.provider === CJ_PROVIDER)).toHaveLength(0);
  });

  it("stops CJ for the run when the per-second refusal persists, still without a back-off", async () => {
    const inner = cjFetch.getMockImplementation()!;
    cjFetch.mockImplementation(async (url, init) =>
      String(url).includes("getAccessToken") ? inner(url, init) : qpsRefusal(),
    );
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    const listCalls = cjFetch.mock.calls.filter(([u]) => String(u).includes("listV2"));
    expect(listCalls).toHaveLength(CJ_QPS_ATTEMPTS);
    expect(run.state.steps.cj.status).toBe("failed");
    expect(run.state.steps.cj.stopped?.reason).toMatch(/1600200/);
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.filter((b) => b.provider === CJ_PROVIDER)).toHaveLength(0);
    // The next run asks CJ again.
    cjFetch.mockImplementation(inner);
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(second.state.steps.cj.status).toBe("done");
  });

  it("quotes shipping to the US for each tracked product's variant and reuses the quote (ADR-017)", async () => {
    const inner = cjFetch.getMockImplementation()!;
    const freightCalls: string[] = [];
    cjFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("freightCalculate")) {
        const body = JSON.parse(String(init?.body));
        freightCalls.push(body.products[0].vid);
        expect(body).toMatchObject({ startCountryCode: "CN", endCountryCode: "US" });
        return Response.json({
          code: 200,
          result: true,
          message: "Success",
          pointsInfo: { total: 50000, usedToday: 160, remaining: 49840 },
          data: [
            { logisticName: "CJPacket Eub", logisticAging: "12-50", logisticPrice: 3.1 },
            { logisticName: "YunExpress Ordinary", logisticAging: "4-7", logisticPrice: 7.5 },
            {
              logisticName: "CJPacket Ordinary",
              logisticAging: "4-9",
              logisticPrice: 6.9,
              totalPostageFee: 7.9,
            },
          ],
        });
      }
      const res = await inner(url, init);
      if (!u.includes("productDetail")) return res;
      const json = await res.json();
      return Response.json({
        ...json,
        data: {
          ...json.data,
          stanProducts: [
            {
              id: `${json.data.id}-small`,
              variantkey: "Blue-40cm",
              sellprice: "3.32",
              weight: 301,
            },
            { id: `${json.data.id}-big`, variantkey: "Blue-80cm", sellprice: "9.95", weight: 1300 },
          ],
        },
      });
    });
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    // Two tracked products: one quote each, for the most expensive (and heaviest) variant.
    expect(freightCalls.sort()).toEqual([
      "5F9B011D-3393-4B82-A414-491ADE80C872-big",
      "85C80F84-A4D8-4178-8227-4F797E312692-big",
    ]);
    expect(run.state.steps.cj).toMatchObject({ freightQuotes: 2, status: "done" });
    expect(run.state.steps.cj.requests).toBe(11);
    const rows = await t.db.select().from(cjLandedCosts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      country: "US",
      variantKey: "Blue-80cm",
      variantPriceCents: 995,
      weightG: 1300,
      variantBasis: "max_variant",
      matchedVariants: 2,
      totalVariants: 2,
      // The cheapest option within 15 days (Eub takes up to 50).
      carrier: "YunExpress Ordinary",
      freightCents: 750,
      maxDays: 7,
      shippingOptions: 3,
    });

    freightCalls.length = 0;
    await driveRun(t.db, deps(), (await newRun()).id);
    expect(freightCalls).toEqual([]);
  });

  it("a refused key stops CJ without a back-off and drops the stored token", async () => {
    cjFetch.mockImplementation(async () =>
      Response.json({ code: 1601000, result: false, message: "User not find", data: null }),
    );
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(cjFetch).toHaveBeenCalledTimes(1);
    expect(run.state.steps.cj.status).toBe("failed");
    expect(run.state.steps.cj.error).toMatch(/^CJ refused the API key/);
    expect(run.state.steps.cj.error).not.toContain(API_KEY);
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.filter((b) => b.provider === CJ_PROVIDER)).toHaveLength(0);
    expect(await t.db.select().from(apiTokens)).toHaveLength(0);
  });

  it("resumes states saved before the CJ step existed", () => {
    const fresh = initialState(NOW);
    const steps: Partial<RunState["steps"]> = { ...fresh.steps };
    delete steps.cj;
    const old = { ...fresh, steps, cursor: "collect" } as unknown as RunState;
    const upgraded = upgradeState(old);
    expect(upgraded.steps.cj).toMatchObject({
      status: "skipped",
      skipReason: "incompatible_state",
    });
    expect(upgraded.plan.cj).toEqual([]);
    const early = upgradeState({ ...old, cursor: "discover" } as RunState);
    expect(early.steps.cj.status).toBe("pending");
    expect(early.plan.cj).toBeNull();
  });
});
