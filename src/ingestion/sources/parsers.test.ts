import { describe, expect, it } from "vitest";
import { AliExpressApiError, parseAliExpressResponse } from "./aliexpress";
import { parseSerpApiTrends } from "./google-trends";
import { parseMetaAd } from "./meta-ads";

describe("parseMetaAd", () => {
  it("maps an archived ad to a source item with reach as a metric", () => {
    const item = parseMetaAd({
      id: "123",
      page_id: "9",
      page_name: "Acme",
      ad_delivery_start_time: "2026-08-01T00:00:00+0000",
      ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=123",
      ad_creative_link_titles: ["Posture Corrector"],
      eu_total_reach: 5000,
    });

    expect(item).toMatchObject({
      externalId: "123",
      kind: "ad",
      title: "Posture Corrector",
      region: "EU",
      advertiserId: "9",
      advertiserName: "Acme",
      endedAt: null,
      metrics: [{ metric: "eu_total_reach", value: 5000 }],
    });
    expect(item.startedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("tolerates omitted fields and falls back to the creative body for the title", () => {
    const item = parseMetaAd({
      id: "1",
      ad_creative_bodies: ["Body text"],
      ad_delivery_stop_time: "2026-09-01T00:00:00+0000",
    });
    expect(item.title).toBe("Body text");
    expect(item.metrics).toEqual([]);
    expect(item.endedAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("parseSerpApiTrends", () => {
  const point = (ts: number, a: number, b: number, partial = false) => ({
    date: "x",
    timestamp: String(ts),
    ...(partial ? { partial_data: true } : {}),
    values: [
      { query: "Face Mask", value: String(a), extracted_value: a },
      { query: "cleaner cup", value: String(b), extracted_value: b },
    ],
  });

  it("produces one trend item per query with dated snapshots, skipping partial periods", () => {
    const items = parseSerpApiTrends({
      search_parameters: { q: "Face Mask,cleaner cup", geo: "US" },
      interest_over_time: {
        timeline_data: [point(1000, 50, 10), point(2000, 60, 20), point(3000, 5, 1, true)],
      },
    });

    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe("face mask|US");
    expect(items[0].region).toBe("US");
    expect(items[0].metrics).toEqual([
      { metric: "search_interest", value: 50, observedAt: new Date(1_000_000) },
      { metric: "search_interest", value: 60, observedAt: new Date(2_000_000) },
    ]);
  });

  it("returns nothing when the series is missing", () => {
    expect(parseSerpApiTrends({ search_parameters: { q: "x" } })).toEqual([]);
  });
});

describe("parseAliExpressResponse", () => {
  it("parses price, orders and rating", () => {
    const [item] = parseAliExpressResponse({
      resp_result: {
        resp_code: 200,
        result: {
          products: {
            product: [
              {
                product_id: 1005,
                product_title: "Paw Cleaner",
                target_sale_price: "3.80",
                target_sale_price_currency: "USD",
                lastest_volume: 1300,
                evaluate_rate: "94.0%",
              },
            ],
          },
        },
      },
    });

    expect(item).toMatchObject({
      externalId: "1005",
      kind: "listing",
      priceCents: 380,
      currency: "USD",
      url: "https://www.aliexpress.com/item/1005.html",
      metrics: [
        { metric: "orders_recent", value: 1300 },
        { metric: "positive_feedback_pct", value: 94 },
      ],
    });
  });

  it("throws on API error codes", () => {
    expect(() =>
      parseAliExpressResponse({ resp_result: { resp_code: 402, resp_msg: "Invalid signature" } }),
    ).toThrow(AliExpressApiError);
  });
});
