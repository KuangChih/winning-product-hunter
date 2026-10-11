import { describe, expect, it } from "vitest";
import { CjApiError, parseCjFreight, parseCjPriceCents, parseCjProducts } from "./cj";
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
      // Its own namespace: never overwrites the website's record of the same ad (ADR-015).
      externalId: "api|123",
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

describe("CJ Dropshipping parsers", () => {
  const list = (products: Array<Record<string, unknown>>) => ({
    code: 200,
    result: true,
    message: "Success",
    data: {
      pageSize: 20,
      pageNumber: 1,
      totalRecords: products.length,
      totalPages: 1,
      content: [{ productList: products as never }],
    },
  });

  it("merges list items with 90-day sales from product details", () => {
    const items = parseCjProducts(
      list([
        { id: "P1", nameEn: "Paw Cleaner", sellPrice: "3.80", listedNum: 80 },
        { id: "P2", nameEn: "No Detail", sellPrice: "2.47 -- 3.10" },
      ]),
      [
        {
          code: 200,
          result: true,
          message: "Success",
          data: { id: "P1", soldOut: 1300, orderCount: 1040 },
        },
      ],
    );

    expect(items[0]).toMatchObject({
      externalId: "P1",
      kind: "listing",
      priceCents: 380,
      currency: "USD",
      metrics: [
        { metric: "stores_listed", value: 80 },
        { metric: "units_sold_90d", value: 1300 },
        { metric: "orders_total", value: 1040 },
      ],
    });
    // Variant price ranges use the lowest price; missing details mean no sales metrics.
    expect(items[1]).toMatchObject({ priceCents: 247, metrics: [] });
  });

  it("parses prices and throws on API errors", () => {
    expect(parseCjPriceCents("12")).toBe(1200);
    expect(parseCjPriceCents(undefined)).toBeUndefined();
    expect(() =>
      parseCjProducts({ code: 1600001, result: false, message: "Invalid token", data: null }),
    ).toThrow(CjApiError);
  });

  it("parses shipping options cheapest first", () => {
    const options = parseCjFreight({
      code: 200,
      result: true,
      message: "Success",
      data: [
        { logisticName: "DHL", logisticAging: "3-5", logisticPrice: 18.2 },
        { logisticName: "USPS+", logisticAging: "2-5", logisticPrice: 4.71 },
        { logisticName: "YunExpress", logisticAging: "7", logisticPrice: 3.1 },
      ],
    });

    expect(options).toEqual([
      { carrier: "YunExpress", costCents: 310, minDays: 7, maxDays: 7 },
      { carrier: "USPS+", costCents: 471, minDays: 2, maxDays: 5 },
      { carrier: "DHL", costCents: 1820, minDays: 3, maxDays: 5 },
    ]);
  });
});
