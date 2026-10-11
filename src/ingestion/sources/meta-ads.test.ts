// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import metaAds from "../fixtures/meta-ads.json";
import {
  buildAdsArchiveUrl,
  createMetaAdsApiAdapter,
  META_GRAPH_URL,
  MetaApiError,
  parseMetaAd,
  type MetaAdsArchiveResponse,
} from "./meta-ads";

const TOKEN = "test-token-not-real";
const fixture = metaAds as MetaAdsArchiveResponse;

async function collect(adapter: ReturnType<typeof createMetaAdsApiAdapter>, queries: string[]) {
  const items = [];
  for await (const item of adapter.fetch({ queries, limit: 1000 })) items.push(item);
  return items;
}

describe("Meta Ad Library API (fixture responses)", () => {
  it("builds a documented /ads_archive request for one UK/EU country", () => {
    const url = new URL(buildAdsArchiveUrl(TOKEN, { country: "GB", query: "neck fan" }));
    expect(`${url.origin}${url.pathname}`).toBe(META_GRAPH_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      ad_reached_countries: '["GB"]',
      ad_type: "ALL",
      ad_active_status: "ACTIVE",
      search_terms: "neck fan",
      search_type: "KEYWORD_UNORDERED",
    });
    expect(url.searchParams.get("fields")).toContain("ad_delivery_start_time");
    expect(url.searchParams.get("fields")).toContain("eu_total_reach");
    const pages = new URL(buildAdsArchiveUrl(TOKEN, { country: "DE", pageIds: ["1", "2"] }));
    expect(pages.searchParams.get("search_page_ids")).toBe('["1","2"]');
    expect(pages.searchParams.has("search_terms")).toBe(false);
  });

  it("never keeps the access token: the snapshot URL is dropped, the public Library link is used", () => {
    const item = parseMetaAd(
      {
        id: "42",
        ad_snapshot_url: `https://www.facebook.com/ads/archive/render_ad/?id=42&access_token=${TOKEN}`,
        total_reach_by_location: [{ key: "UK", value: 1200 }],
      },
      "GB",
    );
    expect(item.url).toBe("https://www.facebook.com/ads/library/?id=42");
    expect(JSON.stringify(item)).not.toContain(TOKEN);
    expect(item.countries).toEqual(["GB"]);
    expect(item.metrics).toContainEqual({ metric: "uk_total_reach", value: 1200 });
  });

  it("queries only UK/EU countries, follows the cursor and caps requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const after = new URL(String(input)).searchParams.get("after");
      return Response.json(
        after
          ? { data: fixture.data.slice(2, 3) }
          : { data: fixture.data.slice(0, 2), paging: { cursors: { after: "c1" }, next: "x" } },
      );
    });
    const adapter = createMetaAdsApiAdapter({
      token: TOKEN,
      countries: ["US", "GB", "NO", "DE"],
      maxPages: 2,
      maxRequests: 3,
      retry: { fetchImpl },
    });
    const items = await collect(adapter, ["posture corrector"]);

    const asked = fetchImpl.mock.calls.map((c) =>
      new URL(String(c[0])).searchParams.get("ad_reached_countries"),
    );
    // US and Norway have no commercial ads in the API; the cap stops the third country page.
    expect(asked).toEqual(['["GB"]', '["GB"]', '["DE"]']);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      externalId: fixture.data[0].id,
      kind: "ad",
      countries: ["GB"],
      advertiserId: fixture.data[0].page_id,
    });
    expect(items[0].metrics).toContainEqual({
      metric: "eu_total_reach",
      value: fixture.data[0].eu_total_reach,
    });
    expect(adapter.provider).toBe("ad_library_api");
  });

  it("reports Graph errors without the token (expired token, rate limit)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } },
        { status: 400 },
      ),
    );
    const adapter = createMetaAdsApiAdapter({
      token: TOKEN,
      countries: ["GB"],
      retry: { fetchImpl },
    });
    const err = await collect(adapter, ["x"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).tokenInvalid).toBe(true);
    expect((err as MetaApiError).message).not.toContain(TOKEN);
    expect((err as MetaApiError).message).not.toContain("graph.facebook.com");

    fetchImpl.mockImplementation(async () =>
      Response.json({ error: { code: 613, message: "Calls limit reached" } }, { status: 400 }),
    );
    const limited = await collect(adapter, ["x"]).catch((e: unknown) => e);
    expect((limited as MetaApiError).rateLimited).toBe(true);
  });
});
