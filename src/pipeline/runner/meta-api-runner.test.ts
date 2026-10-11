// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ingestionRuns,
  pipelineRuns,
  productScores,
  products,
  signalSnapshots,
  sourceBackoff,
  sourceItems,
} from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { metaApiProductKey } from "@/discovery/meta-api";
import {
  createMetaApiClient,
  META_API_PROVIDER,
  type MetaArchivedAd,
} from "@/ingestion/sources/meta-ads";
import { parseEcbDaily } from "@/lib/fx";
import type { RunnerDeps } from "./deps";
import { driveRun } from "./drive";
import { recordBlock } from "./guards";
import { parseRunOptions } from "./options";
import { initialState, upgradeState } from "./state";
import { createRun } from "./store";
import type { RunState } from "./types";

const ecbXml = fs.readFileSync(
  path.resolve(__dirname, "../../ingestion/sources/__recordings__/ecb-eurofxref-daily.xml"),
  "utf8",
);
const NOW = new Date("2026-10-10T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const TOKEN = "EAAB-runner-test-token-not-real";

/**
 * Answers in the documented ArchivedAd format (docs/research/meta-ad-library-api.md). Not a
 * recording: no real token exists yet.
 */
const ad = (id: string, extra: Partial<MetaArchivedAd> = {}): MetaArchivedAd => ({
  id,
  page_id: "500",
  page_name: "Glow Store",
  ad_creation_time: daysAgo(30).toISOString(),
  ad_delivery_start_time: daysAgo(30).toISOString().replace(".000Z", "+0000"),
  ad_creative_bodies: ["Clearer skin in 10 minutes a day."],
  ad_creative_link_titles: ["LED Face Mask"],
  ad_creative_link_captions: ["GLOWSTORE.CO.UK"],
  publisher_platforms: ["FACEBOOK", "INSTAGRAM"],
  languages: ["en"],
  eu_total_reach: 5000,
  total_reach_by_location: [
    { key: "UK", value: 1200 },
    { key: "EU", value: 5000 },
  ],
  ...extra,
});

const ANSWERS: Record<string, MetaArchivedAd[]> = {
  "led face mask": [
    // The website already stored ad 1001 for the website product: same ad, same product.
    ad("1001"),
    ad("1002", { ad_delivery_start_time: daysAgo(5).toISOString() }),
    // A store the website never saw: a new product (2 ads).
    ad("2001", {
      page_id: "600",
      page_name: "Rücken Shop",
      ad_creative_link_titles: ["Posture Corrector Pro"],
      ad_creative_link_captions: ["rueckenshop.de"],
      total_reach_by_location: [{ key: "EU", value: 800 }],
      eu_total_reach: 800,
    }),
    ad("2002", {
      page_id: "600",
      ad_creative_link_titles: ["Posture Corrector Pro"],
      ad_creative_link_captions: ["rueckenshop.de"],
      total_reach_by_location: undefined,
      eu_total_reach: undefined,
    }),
    // One 3-day-old ad: not promising, not stored.
    ad("3001", {
      ad_delivery_start_time: daysAgo(3).toISOString(),
      ad_creative_link_titles: ["Neck Fan Cooler"],
      ad_creative_link_captions: ["lonely-shop.com"],
    }),
    // No store domain in the caption: cannot be grouped.
    ad("4001", { ad_creative_link_captions: ["Free shipping today"] }),
  ],
  // The second keyword finds an ad again: counted once.
  "posture corrector": [
    ad("2001", {
      page_id: "600",
      ad_creative_link_titles: ["Posture Corrector Pro"],
      ad_creative_link_captions: ["rueckenshop.de"],
    }),
  ],
};

describe("pipeline runner: official Meta Ad Library API (ADR-015)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let apiFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let webProductId: string;
  beforeEach(async () => {
    t = await createTestDb();
    apiFetch = vi.fn<typeof fetch>(async (url) => {
      const q = new URL(String(url)).searchParams.get("search_terms") ?? "";
      return Response.json({ data: ANSWERS[q] ?? [], paging: {} });
    });
    // The Ad Library website blocks this egress: the official API must work without it.
    await recordBlock(t.db, "ad_library_web", "local", "HTTP 403 from Ad Library", new Date());
    // A product found earlier on the Ad Library website, with one of its ads.
    const [p] = await t.db
      .insert(products)
      .values({
        slug: "led-face-mask",
        title: "Led Face Mask",
        landingKey: "handle:led-face-mask",
        canonicalUrl: "https://glowstore.co.uk/products/led-face-mask",
        firstSeenAt: daysAgo(30),
      })
      .returning();
    webProductId = p.id;
    await t.db.insert(sourceItems).values({
      source: "meta_ads",
      provider: "ad_library_web",
      externalId: "1001",
      kind: "ad",
      productId: p.id,
      title: "LED Face Mask",
      url: "https://www.facebook.com/ads/library/?id=1001",
      countries: ["US"],
      advertiserId: "500",
      advertiserName: "Glow Store",
      format: "video",
      startedAt: daysAgo(30),
      endedAt: null,
      firstSeenAt: daysAgo(2),
      lastSeenAt: daysAgo(2),
      raw: { landing_url: "https://www.glowstore.co.uk/products/led-face-mask?v=1" },
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
      throw new Error("The website must not be asked while it blocks this egress");
    },
    metaApi: () =>
      createMetaApiClient({ token: TOKEN, retry: { fetchImpl: apiFetch, retries: 0 } }),
    imageRetry: { fetchImpl: async () => new Response("", { status: 404 }) },
    ...extra,
  });
  const newRun = async () =>
    (
      await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions({
          keywords: ["led face mask", "posture corrector"],
          countries: ["US"],
          advertisers: 0,
          collect: 0,
        }),
        env: "local",
        now: NOW,
      })
    ).run;

  it("finds UK/EU products while the website is blocked, without touching website records", async () => {
    const run = await driveRun(t.db, deps(), (await newRun()).id);

    expect(run.state.steps.discover).toMatchObject({ status: "skipped", skipReason: "backoff" });
    const step = run.state.steps.meta_api;
    expect(step).toMatchObject({ status: "done", requests: 2, ads: 7, failures: 0 });
    // One request per keyword, for the UK and the EU target markets at once.
    expect(apiFetch).toHaveBeenCalledTimes(2);
    const asked = new URL(String(apiFetch.mock.calls[0][0])).searchParams;
    expect(asked.get("ad_reached_countries")).toBe('["GB","DE","FR","SE","BE","ES"]');
    expect(asked.get("ad_active_status")).toBe("ACTIVE");

    const all = await t.db.select().from(products);
    expect(all.map((p) => p.landingKey).sort()).toEqual([
      "handle:led-face-mask",
      metaApiProductKey("rueckenshop.de", "posture corrector pro"),
    ]);
    const created = all.find((p) => p.landingKey?.startsWith("meta-api:"))!;
    expect(created).toMatchObject({ title: "Posture Corrector Pro", canonicalUrl: null });
    expect(run.state.results.metaApiProducts).toBe(1);

    const items = await t.db.select().from(sourceItems);
    // The website's record of ad 1001 is untouched; the API's is a separate record.
    const web = items.find((i) => i.externalId === "1001")!;
    expect(web).toMatchObject({
      provider: "ad_library_web",
      countries: ["US"],
      productId: webProductId,
    });
    const api = items.filter((i) => i.provider === META_API_PROVIDER);
    expect(api.map((i) => [i.externalId, i.productId]).sort()).toEqual(
      [
        ["api|1001", webProductId],
        ["api|1002", webProductId],
        ["api|2001", created.id],
        ["api|2002", created.id],
      ].sort(),
    );
    expect(api.find((i) => i.externalId === "api|1001")!.countries).toEqual(["GB"]);
    expect(api.find((i) => i.externalId === "api|2001")!.countries).toEqual([]);
    const reach = await t.db.select().from(signalSnapshots);
    expect(reach.map((s) => s.metric)).toEqual(
      expect.arrayContaining(["eu_total_reach", "uk_total_reach"]),
    );

    // Scored; the token is nowhere in the database.
    expect(await t.db.select().from(productScores)).toHaveLength(2);
    const dump = JSON.stringify([
      items,
      await t.db.select().from(ingestionRuns),
      await t.db.select().from(pipelineRuns),
    ]);
    expect(dump).not.toContain(TOKEN);
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter(
      (r) => r.provider === META_API_PROVIDER,
    );
    expect(ingestion).toMatchObject({ status: "succeeded", itemsFetched: 4 });

    // The next run finds the same groups under the same products.
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(second.state.results.metaApiProducts).toBe(0);
    expect(await t.db.select().from(products)).toHaveLength(2);
  });

  it("leaves a group out when the website put its ads under different products", async () => {
    const [other] = await t.db
      .insert(products)
      .values({ slug: "other", title: "Other", landingKey: "handle:other", firstSeenAt: NOW })
      .returning();
    await t.db.insert(sourceItems).values({
      source: "meta_ads",
      provider: "ad_library_web",
      externalId: "1002",
      kind: "ad",
      productId: other.id,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(run.state.steps.meta_api.detail).toMatch(
      /1 left out \(matching several website products\)/,
    );
    const api = (await t.db.select().from(sourceItems)).filter(
      (i) => i.provider === META_API_PROVIDER,
    );
    expect(api.map((i) => i.externalId).sort()).toEqual(["api|2001", "api|2002"]);
  });

  it("is skipped as not configured without a token", async () => {
    const run = await driveRun(t.db, deps({ metaApi: undefined }), (await newRun()).id);
    expect(run.state.steps.meta_api).toMatchObject({
      status: "skipped",
      skipReason: "not_configured",
    });
    expect(run.state.steps.score.status).toBe("done");
  });

  it("stops at a rate limit (613), backs off only the API and is skipped during the back-off", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(
        { error: { code: 613, message: "Calls to this api have exceeded the rate limit." } },
        { status: 400 },
      ),
    );
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(apiFetch).toHaveBeenCalledTimes(1); // never retried, second keyword never sent
    expect(run.status).toBe("partial");
    expect(run.state.steps.meta_api.status).toBe("failed");
    expect(run.state.steps.meta_api.error).toMatch(/code 613/);
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.map((b) => b.provider).sort()).toEqual([META_API_PROVIDER, "ad_library_web"]);
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter(
      (r) => r.provider === META_API_PROVIDER,
    );
    expect(ingestion.status).toBe("failed");

    apiFetch.mockClear();
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(second.state.steps.meta_api).toMatchObject({
      status: "skipped",
      skipReason: "backoff",
    });
  });

  it("an invalid token (190) stops the API without a back-off and never shows the token", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(
        { error: { code: 190, message: `Error validating access token: ${TOKEN} has expired` } },
        { status: 400 },
      ),
    );
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(run.state.steps.meta_api.error).toMatch(/^Meta refused the access token/);
    expect(run.state.steps.meta_api.error).not.toContain(TOKEN);
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.filter((b) => b.provider === META_API_PROVIDER)).toHaveLength(0);
    const [stored] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, run.id));
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
  });

  it("a failed request (Meta server error) is noted and the other keywords still run", async () => {
    apiFetch.mockImplementationOnce(async () => new Response("oops", { status: 500 }));
    const run = await driveRun(t.db, deps(), (await newRun()).id);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(run.state.steps.meta_api).toMatchObject({ status: "done", failures: 1, requests: 2 });
  });

  it("resumes states saved before the official-API step existed", () => {
    const fresh = initialState(NOW);
    const steps: Partial<RunState["steps"]> = { ...fresh.steps };
    delete steps.meta_api;
    const old = { ...fresh, steps, cursor: "collect" } as unknown as RunState;
    const upgraded = upgradeState(old);
    expect(upgraded.steps.meta_api).toMatchObject({
      status: "skipped",
      skipReason: "incompatible_state",
    });
    expect(upgraded.plan.metaApi).toEqual([]);
    const early = upgradeState({ ...old, cursor: "discover" } as RunState);
    expect(early.steps.meta_api.status).toBe("pending");
    expect(early.plan.metaApi).toBeNull();
  });
});
