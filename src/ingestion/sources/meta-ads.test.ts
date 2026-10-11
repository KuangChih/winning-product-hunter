// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import metaAds from "../fixtures/meta-ads.json";
import { metaApiFailureKind } from "./meta-api-failure";
import {
  buildAdsArchiveUrl,
  createMetaAdsApiAdapter,
  createMetaApiClient,
  META_API_TARGET_COUNTRIES,
  META_GRAPH_URL,
  MetaApiError,
  metaLibraryId,
  parseMetaAd,
  type MetaAdsArchiveResponse,
  type MetaArchivedAd,
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
    const url = new URL(buildAdsArchiveUrl(TOKEN, { countries: ["GB"], query: "neck fan" }));
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
    expect(url.searchParams.get("fields")).toContain("ad_creative_link_captions");
    // The snapshot URL embeds the token: never asked for.
    expect(url.searchParams.get("fields")).not.toContain("ad_snapshot_url");
    const pages = new URL(buildAdsArchiveUrl(TOKEN, { countries: ["DE"], pageIds: ["1", "2"] }));
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
      externalId: `api|${fixture.data[0].id}`,
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

describe("Meta Ad Library API client (one request per call, ADR-015)", () => {
  // Shapes as documented for ArchivedAd (docs/research/meta-ad-library-api.md); not a recording.
  const ad = (id: string, extra: Partial<MetaArchivedAd> = {}): MetaArchivedAd => ({
    id,
    page_id: "77",
    page_name: "Glow Store",
    ad_delivery_start_time: "2026-09-01T00:00:00+0000",
    ad_creative_link_titles: ["LED Face Mask"],
    ad_creative_link_captions: ["glowstore.co.uk"],
    eu_total_reach: 1000,
    ...extra,
  });

  it("asks the UK and EU target markets in one request and keeps only the UK as a country", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          ad("1", {
            total_reach_by_location: [
              { key: "UK", value: 300 },
              { key: "EU", value: 1000 },
            ],
          }),
          ad("2", { total_reach_by_location: [{ key: "EU", value: 50 }] }),
          ad("3", { total_reach_by_location: [{ key: "UK", value: 0 }] }),
        ],
        paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/next" },
      }),
    );
    const client = createMetaApiClient({ token: TOKEN, retry: { fetchImpl } });
    const page = await client.search({
      query: "led face mask",
      countries: [...META_API_TARGET_COUNTRIES, "US", "NO"],
    });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("ad_reached_countries")).toBe('["GB","DE","FR","SE","BE","ES"]');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(page.after).toBe("c1");
    expect(page.items.map((i) => [i.externalId, i.countries])).toEqual([
      ["api|1", ["GB"]],
      ["api|2", []],
      ["api|3", []],
    ]);
    expect(page.items[0].metrics).toEqual([
      { metric: "eu_total_reach", value: 1000 },
      { metric: "uk_total_reach", value: 300 },
    ]);
    expect(page.items[0].raw).toMatchObject({ ad_creative_link_captions: ["glowstore.co.uk"] });
    expect(metaLibraryId(page.items[0].externalId)).toBe("1");
    expect(metaLibraryId("1")).toBe("1");
  });

  it("ignores reach entries that do not have the documented shape", () => {
    const item = parseMetaAd(
      ad("9", {
        eu_total_reach: undefined,
        total_reach_by_location: [
          { key: "GB", value: 5 },
          { key: "UK", value: "12" as unknown as number },
        ],
      }),
      ["GB", "DE"],
    );
    expect(item.metrics).toEqual([]);
    expect(item.countries).toEqual([]);
  });

  it("classifies refusals and never puts the token or the URL in the error", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { code: 190, message: `Error validating access token ${TOKEN}` } }, "token"],
      [
        400,
        { error: { code: 613, message: "Calls to this api have exceeded the rate limit." } },
        "rate_limited",
      ],
      [429, { error: { message: "slow down" } }, "rate_limited"],
      [400, { error: { code: 100, message: "Invalid parameter" } }, "request"],
      [500, "oops", "service"],
    ];
    for (const [status, body, kind] of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }),
      );
      const client = createMetaApiClient({ token: TOKEN, retry: { fetchImpl, retries: 0 } });
      const err = await client.search({ query: "x", countries: ["GB"] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MetaApiError);
      expect((err as MetaApiError).kind).toBe(kind);
      expect(metaApiFailureKind((err as MetaApiError).message)).toBe(kind);
      expect((err as MetaApiError).message).not.toContain(TOKEN);
      expect((err as MetaApiError).message).not.toContain("graph.facebook.com");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("sends nothing for countries without ads of every type in the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createMetaApiClient({ token: TOKEN, retry: { fetchImpl } });
    expect(await client.search({ query: "x", countries: ["US", "NO"] })).toEqual({
      items: [],
      after: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
