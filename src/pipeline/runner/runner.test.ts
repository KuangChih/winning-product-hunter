// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestFxRates } from "@/data/fx";
import {
  collectionAttempts,
  ingestionRuns,
  landingRedirects,
  pipelineRuns,
  pipelineStage,
  productScores,
  products,
  signalSnapshots,
  sourceBackoff,
  sourceItems,
} from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { DISCOVERY_KEYWORDS, keywordsForDay } from "@/discovery/keywords";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import {
  createShopifyCatalogAdapter,
  createStoreLookupAdapter,
} from "@/ingestion/sources/shopify-catalog";
import { parseEcbDaily } from "@/lib/fx";
import { toProgress } from "../progress";
import type { RunnerDeps } from "./deps";
import { driveRun } from "./drive";
import { backoffMs, recordBlock } from "./guards";
import { parseRunOptions } from "./options";
import { createRun, getRun } from "./store";
import { runTick } from "./tick";
import { HASH_PER_RUN } from "./units";
import { expireRun } from "./watchdog";
import type { RunOptions } from "./types";

const rec = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../ingestion/sources/__recordings__", name), "utf8");
const adHtml = rec("meta-ad-library-search.html");
const catalogJson = JSON.parse(rec("shopify-catalog-search.json"));
const lookupJson = JSON.parse(rec("shopify-catalog-lookup.json"));
const ecbXml = rec("ecb-eurofxref-daily.xml");
const NOW = new Date("2026-10-10T00:00:00Z");
const LOGIN_PAGE = "<html><title>Log in</title></html>";

/** Rejects when the request's signal aborts, never resolves otherwise (a hung socket). */
const hang = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });

describe("pipeline runner (recorded responses)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let adFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let catalogFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let lookupFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    t = await createTestDb();
    adFetch = vi.fn<typeof fetch>(async () => new Response(adHtml));
    catalogFetch = vi.fn<typeof fetch>(async () => Response.json(catalogJson));
    lookupFetch = vi.fn<typeof fetch>(async () => Response.json(lookupJson));
  });
  afterEach(async () => {
    await t.close();
  });

  const deps = (extra: Partial<RunnerDeps> = {}): RunnerDeps => ({
    egress: "local",
    clock: { now: () => Date.now(), sleep: async () => {} },
    now: NOW,
    fetchFxRates: async () => parseEcbDaily(ecbXml),
    adLibrary: ({ mode, countries }) =>
      // As in live-deps: one request per unit, never retried.
      createAdLibraryWebAdapter({
        mode,
        countries,
        maxRequests: 1,
        retry: { fetchImpl: adFetch, retries: 0 },
      }),
    shopifyCatalog: ({ countries, wait }) =>
      createShopifyCatalogAdapter({ countries, wait, retry: { fetchImpl: catalogFetch } }),
    storeLookup: ({ country, wait }) =>
      createStoreLookupAdapter({ country, wait, retry: { fetchImpl: lookupFetch } }),
    // Product photos are not downloaded in tests; a failed download is counted, not fatal.
    imageRetry: { fetchImpl: async () => new Response("", { status: 404 }) },
    ...extra,
  });
  const options = (o: Partial<RunOptions> = {}) =>
    parseRunOptions({
      keywords: ["posture corrector"],
      countries: ["US"],
      advertisers: 0,
      collect: 5,
      ...o,
    });
  const newRun = async (o: Partial<RunOptions> = {}) =>
    (await createRun(t.db, { trigger: "cli", options: options(o), env: "local", now: NOW })).run;
  const statuses = (run: { state: { steps: Record<string, { status: string }> } }) =>
    Object.fromEntries(Object.entries(run.state.steps).map(([k, v]) => [k, v.status]));
  const counts = async () => ({
    products: (await t.db.select().from(products)).length,
    items: (await t.db.select().from(sourceItems)).length,
    snapshots: (await t.db.select().from(signalSnapshots)).length,
    scores: (await t.db.select().from(productScores)).length,
  });

  it("discovers a real product, adds Shopify evidence to it and scores it", async () => {
    const run = await driveRun(t.db, deps(), (await newRun()).id);

    expect(run.status).toBe("succeeded");
    expect(statuses(run)).toEqual({
      fx: "done",
      discover: "done",
      advertisers: "skipped",
      meta_api: "skipped",
      cj: "skipped",
      collect: "done",
      stores: "done",
      dedupe: "done",
      match: "done",
      score: "done",
    });
    expect((await getLatestFxRates(t.db))?.date).toBe("2026-10-09");
    const [product] = await t.db.select().from(products);
    expect(product.title).toBe("Instant Posture Corrector");
    const sources = new Set(
      (await t.db.select().from(sourceItems))
        .filter((i) => i.productId === product.id)
        .map((i) => i.source),
    );
    expect([...sources].sort()).toEqual(["meta_ads", "shopify"]);
    expect(await t.db.select().from(productScores)).toHaveLength(1);

    // The advertisers' own landing pages were looked up in one batch.
    expect(lookupFetch).toHaveBeenCalledTimes(1);
    const ids = JSON.parse(String(lookupFetch.mock.calls[0][1]?.body)).params.arguments.catalog.ids;
    expect(ids.sort()).toEqual([
      "https://axzenia.com/products/instant-posture-corrector",
      "https://corecareshop.com/products/instant-posture-corrector",
      // The same pages with "www.", in the same request (the catalog matches exact hosts).
      "https://www.axzenia.com/products/instant-posture-corrector",
      "https://www.corecareshop.com/products/instant-posture-corrector",
    ]);
    const advertised = (await t.db.select().from(sourceItems)).filter(
      (i) => i.provider === "shopify_catalog_lookup",
    );
    expect(advertised).toHaveLength(2);
    expect(advertised.every((i) => i.productId === product.id)).toBe(true);

    // Every request was counted; nothing is left running or staged.
    expect(adFetch).toHaveBeenCalledTimes(1);
    expect(run.adLibraryRequests).toBe(1);
    expect(run.state.results).toMatchObject({ newProducts: 1, productsScored: 1 });
    expect(run.state.results.newAds).toBeGreaterThan(0);
    expect(await t.db.select().from(pipelineStage)).toHaveLength(0);
    const ingestion = await t.db.select().from(ingestionRuns);
    expect(ingestion.filter((r) => r.status === "running")).toHaveLength(0);
    expect(ingestion.every((r) => r.pipelineRunId === run.id)).toBe(true);
    // One ingestion row per source step.
    expect(ingestion.map((r) => r.provider).sort()).toEqual([
      "ad_library_web",
      "shopify_catalog",
      "shopify_catalog_lookup",
    ]);
  });

  it("follows a landing page the catalog did not know to where the store moved it (ADR-018)", async () => {
    const empty = { ...lookupJson, result: { structuredContent: { products: [] } } };
    lookupFetch.mockImplementationOnce(async () => Response.json(empty));
    const pageCalls: string[] = [];
    const other = (host: string) => (host.includes("axzenia") ? "corecareshop.com" : "axzenia.com");
    const storePageFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      pageCalls.push(`${init?.method} ${url.host}${url.pathname}`);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /cart");
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, "url", {
        value: `https://${other(url.host)}${url.pathname}?variant=1`,
      });
      return r;
    });
    const run = await driveRun(t.db, deps({ storePageFetch }), (await newRun()).id);

    // robots.txt, then HEAD of the landing page; only the final URL is kept.
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls[0]).toMatch(/^GET .*\/robots\.txt$/);
    expect(pageCalls[1]).toMatch(/^HEAD /);
    const [cached] = await t.db.select().from(landingRedirects);
    expect(cached).toMatchObject({ outcome: "redirected", status: 200 });
    expect(cached.finalUrl).not.toContain("?");
    // The catalog is asked again with the final page and finds it.
    expect(lookupFetch).toHaveBeenCalledTimes(2);
    expect(run.state.steps.stores.redirects).toMatchObject({
      checked: 1,
      requests: 2,
      changed: 1,
      found: 1,
      blocked: 0,
    });
    const own = (await t.db.select().from(sourceItems)).filter(
      (i) => i.provider === "shopify_catalog_lookup",
    );
    expect(own).toHaveLength(1);
  });

  it("skips a store that refuses us; several refusing stores stop the checks and back off", async () => {
    const empty = { ...lookupJson, result: { structuredContent: { products: [] } } };
    lookupFetch.mockImplementation(async () => Response.json(empty));
    const storePageFetch = vi.fn<typeof fetch>(async (input) => {
      const r = new Response(String(input).endsWith("/robots.txt") ? "" : null, {
        status: String(input).endsWith("/robots.txt") ? 200 : 429,
      });
      Object.defineProperty(r, "url", { value: String(input) });
      return r;
    });
    const first = await driveRun(t.db, deps({ storePageFetch }), (await newRun()).id);
    // One refusing store: its page is cached as blocked, no back-off.
    expect(first.state.steps.stores.redirects).toMatchObject({ checked: 1, blocked: 1 });
    expect((await t.db.select().from(landingRedirects))[0]).toMatchObject({
      outcome: "blocked",
      status: 429,
    });
    expect(await t.db.select().from(sourceBackoff)).toHaveLength(0);

    // Three more products whose stores all refuse: the run stops checking and backs off.
    for (const n of [1, 2, 3]) {
      const [p] = await t.db
        .insert(products)
        .values({
          slug: `extra-${n}`,
          title: `Extra ${n}`,
          landingKey: `handle:extra-${n}`,
          firstSeenAt: NOW,
        })
        .returning();
      await t.db.insert(sourceItems).values({
        source: "meta_ads",
        provider: "ad_library_web",
        externalId: `extra-ad-${n}`,
        kind: "ad",
        productId: p.id,
        raw: { landing_url: `https://store${n}.example/products/extra-${n}` },
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      });
      await t.db.insert(collectionAttempts).values({
        provider: "shopify_catalog_lookup",
        productId: p.id,
        attemptedAt: NOW,
        outcome: "empty",
      });
    }
    const second = await driveRun(t.db, deps({ storePageFetch }), (await newRun()).id);
    expect(second.state.steps.stores.redirects).toMatchObject({ checked: 3, blocked: 3 });
    const backoffs = await t.db.select().from(sourceBackoff);
    expect(backoffs.map((b) => b.provider)).toContain("store_pages");
  });

  it("keeps going when discovery is blocked, reports it and backs off", async () => {
    adFetch.mockImplementation(async () => new Response(LOGIN_PAGE));
    const run = await driveRun(t.db, deps(), (await newRun({ advertisers: 5 })).id);
    expect(run.status).toBe("partial");
    expect(run.state.steps.discover.status).toBe("failed");
    expect(run.state.steps.discover.error).toMatch(/\[login_wall\]/);
    expect(run.state.steps.advertisers).toMatchObject({ status: "skipped", skipReason: "blocked" });
    expect(run.state.steps.score.status).toBe("done");
    expect(run.state.adLibrary.blocked?.reason).toMatch(/\[login_wall\] Meta asks to log in/);
    // The diagnostic is kept with the back-off and the ingestion run.
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter(
      (r) => r.provider === "ad_library_web",
    );
    expect(ingestion.error).toMatch(/status=200; .*title="Log in"; markers=login_title/);

    const [backoff] = await t.db.select().from(sourceBackoff);
    expect(backoff).toMatchObject({ provider: "ad_library_web", egress: "local", strikes: 1 });
    const wait = backoff.until.getTime() - Date.now();
    expect(wait).toBeGreaterThan(backoffMs(1) - 60_000);
    expect(wait).toBeLessThanOrEqual(backoffMs(1));

    // The next run does not touch Meta during the back-off; the other steps still run.
    adFetch.mockClear();
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(adFetch).not.toHaveBeenCalled();
    expect(second.state.steps.discover).toMatchObject({ status: "skipped", skipReason: "backoff" });
    expect(second.state.steps.score.status).toBe("done");
    expect(second.status).toBe("partial");
    // Another egress (the user's machine) is not blocked by it.
    const third = await driveRun(t.db, deps({ egress: "vercel" }), (await newRun()).id);
    expect(third.state.steps.discover.status).not.toBe("skipped");
  });

  it("a page without embedded results stops Meta for the run but is not a block (no back-off)", async () => {
    const shell =
      '<html><head><title>Ad Library</title></head><script type="application/json">' +
      '{"ad_library_main":{"country_details":{}}}</script></html>';
    adFetch.mockImplementation(async () => new Response(shell));
    const run = await driveRun(
      t.db,
      deps(),
      (await newRun({ keywords: ["a", "b"], advertisers: 5 })).id,
    );
    // One request, then Meta is left alone for the rest of the run.
    expect(adFetch).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("partial");
    expect(run.state.steps.discover.status).toBe("failed");
    expect(run.state.steps.discover.error).toMatch(
      /\[results_not_embedded\].*markers=ad_library_app/,
    );
    expect(run.state.adLibrary.blocked).toBeNull();
    expect(run.state.adLibrary.stopped?.reason).toMatch(/results_not_embedded/);
    expect(run.state.steps.advertisers).toMatchObject({
      status: "skipped",
      skipReason: "meta_unusable",
    });
    expect(run.state.steps.score.status).toBe("done");
    // No egress back-off: the next run may ask Meta again (within the daily cap).
    expect(await t.db.select().from(sourceBackoff)).toHaveLength(0);
    const [ingestion] = (await t.db.select().from(ingestionRuns)).filter(
      (r) => r.provider === "ad_library_web",
    );
    expect(ingestion).toMatchObject({ status: "failed" });
    expect(ingestion.error).toMatch(/\[results_not_embedded\]/);

    adFetch.mockImplementation(async () => new Response(adHtml));
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(second.state.steps.discover.status).toBe("done");
  });

  it("does not re-collect a product that already has fresh evidence", async () => {
    await driveRun(t.db, deps(), (await newRun()).id);
    const second = await driveRun(t.db, deps(), (await newRun()).id);
    expect(second.state.steps.collect.detail).toBe("nothing to collect");
  });

  it("gives the same result one unit per tick (each saved state is enough to resume)", async () => {
    const ticks: string[] = [];
    const run = await driveRun(t.db, deps(), (await newRun()).id, {
      budgetMs: 0,
      onTick: (r) => ticks.push(r.kind === "continue" ? `${r.kind}:${r.units}` : r.kind),
    });
    expect(run.status).toBe("succeeded");
    expect(ticks.slice(0, -1).every((k) => k === "continue:1")).toBe(true);
    expect(ticks.at(-1)).toBe("finished");
    expect(run.ticks).toBe(ticks.length);
    expect(run.ticks).toBeGreaterThan(10);
    const sliced = await counts();

    const other = await createTestDb();
    try {
      const whole = await createRun(other.db, {
        trigger: "cli",
        options: options(),
        env: "local",
        now: NOW,
      });
      await driveRun(other.db, deps(), whole.run.id);
      const all = async (db: typeof other.db) => ({
        products: (await db.select().from(products)).length,
        items: (await db.select().from(sourceItems)).length,
        snapshots: (await db.select().from(signalSnapshots)).length,
        scores: (await db.select().from(productScores)).length,
      });
      expect(sliced).toEqual(await all(other.db));
    } finally {
      await other.close();
    }
  });

  it("resumes after a process died mid-request without duplicates, counting the request", async () => {
    const { id } = await newRun();
    // Tick 1: start; tick 2: plan the sweep.
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    // A process reserved request 0 and died before sending it (its lease then expired).
    const before = (await getRun(t.db, id))!;
    expect(before.state.cursor).toBe("discover");
    const dead = {
      ...before.state,
      adLibrary: { ...before.state.adLibrary, requests: 1 },
      unit: {
        name: "discover" as const,
        key: "0",
        observedAt: new Date().toISOString(),
        attempts: 1,
      },
    };
    await t.db
      .update(pipelineRuns)
      .set({
        state: dead,
        adLibraryRequests: 1,
        lockToken: "00000000-0000-4000-8000-000000000000",
        lockedUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(pipelineRuns.id, id));

    const run = await driveRun(t.db, deps(), id);
    expect(run.status).toBe("succeeded");
    expect(adFetch).toHaveBeenCalledTimes(1);
    // The dead process's reservation counts: caps are never undercounted.
    expect(run.adLibraryRequests).toBe(2);
    expect(await t.db.select().from(products)).toHaveLength(1);
    const snaps = await t.db.select().from(signalSnapshots);
    const keys = snaps.map((s) => `${s.sourceItemId}|${s.metric}|${s.observedAt.toISOString()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("retries a unit cut off by the deadline, then skips it after 3 interruptions", async () => {
    adFetch.mockImplementation(hang);
    const { id } = await newRun();
    const tick = () => runTick(t.db, deps(), { runId: id, budgetMs: 0, hardAbortMs: 30 });
    await tick(); // start
    await tick(); // plan
    for (let i = 1; i <= 3; i++) {
      expect(await tick()).toEqual({ kind: "continue", units: 0 });
      const run = (await getRun(t.db, id))!;
      expect(run.state.unit).toMatchObject({ name: "discover", attempts: i });
      expect(run.state.steps.discover.status).toBe("running");
    }
    expect(adFetch).toHaveBeenCalledTimes(3);

    const run = await driveRun(t.db, deps(), id);
    expect(adFetch).toHaveBeenCalledTimes(3);
    expect(run.adLibraryRequests).toBe(3);
    expect(run.state.steps.discover.status).toBe("failed");
    expect(run.state.steps.discover.error).toMatch(/interrupted 3 times/);
    expect(run.state.steps.score.status).toBe("done");
    expect(run.status).toBe("partial");
  });

  it("does not record a product cut off by the deadline as failed", async () => {
    catalogFetch.mockImplementation(hang);
    const { id } = await newRun();
    let result;
    for (let i = 0; i < 20; i++) {
      result = await runTick(t.db, deps(), { runId: id, budgetMs: 0, hardAbortMs: 200 });
      const run = (await getRun(t.db, id))!;
      if (
        run.state.cursor === "collect" &&
        run.state.plan.collect &&
        result.kind === "continue" &&
        result.units === 0
      )
        break;
    }
    const run = (await getRun(t.db, id))!;
    expect(run.state.unit?.name).toBe("collect");
    expect(run.state.steps.collect).toMatchObject({ failedProducts: 0, errors: [] });
    const attempts = await t.db
      .select()
      .from(collectionAttempts)
      .where(eq(collectionAttempts.provider, "shopify_catalog"));
    expect(attempts).toHaveLength(0);
  });

  it("lets only one of two concurrent ticks hold the run", async () => {
    const { id } = await newRun();
    const results = await Promise.all([
      runTick(t.db, deps(), { runId: id }),
      runTick(t.db, deps(), { runId: id }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["busy", "finished"]);
  });

  it("stops at once when another process took the run over (fencing)", async () => {
    const { id } = await newRun();
    const stealing = deps({
      async fetchFxRates() {
        // Meanwhile the lease expired and another process took the run.
        await t.db
          .update(pipelineRuns)
          .set({ lockToken: "11111111-1111-4111-8111-111111111111" })
          .where(eq(pipelineRuns.id, id));
        return parseEcbDaily(ecbXml);
      },
    });
    const r = await runTick(t.db, stealing, { runId: id });
    expect(r.kind).toBe("lost_lease");
    const run = (await getRun(t.db, id))!;
    // Nothing after the take-over was written by the fenced-out tick.
    expect(run.state.cursor).toBe("start");
    expect(run.state.unit).toMatchObject({ name: "start", attempts: 1 });
    expect(adFetch).not.toHaveBeenCalled();
  });

  it("allows 3 Meta sweeps per UTC day, rotating the keywords", async () => {
    // Sweeps are counted by the database's day (created_at defaults to now()), so this test
    // does not depend on the wall-clock date.
    const seed = (n: number) =>
      t.db.insert(pipelineRuns).values(
        Array.from({ length: n }, () => ({
          trigger: "cron" as const,
          status: "succeeded" as const,
          env: "local",
          options: options(),
          state: {} as never,
          adLibraryRequests: 50,
        })),
      );
    await seed(1);
    const rotated = await driveRun(
      t.db,
      deps(),
      (await newRun({ keywords: null, keywordCount: 2 })).id,
    );
    expect(rotated.state.plan.keywords).toEqual(
      keywordsForDay(NOW, 2, DISCOVERY_KEYWORDS, { slot: 1, slotsPerDay: 3 }),
    );
    expect(rotated.state.plan.adLibrary).toMatchObject({ allowed: true, sweep: 2 });

    await seed(1);
    adFetch.mockClear();
    const capped = await driveRun(t.db, deps(), (await newRun()).id);
    expect(adFetch).not.toHaveBeenCalled();
    expect(capped.state.steps.discover).toMatchObject({
      status: "skipped",
      skipReason: "daily_cap",
    });
    expect(capped.state.steps.score.status).toBe("done");
    expect(capped.adLibraryRequests).toBe(0);
  });

  it("caps a run's keyword sweep at 50 requests", async () => {
    const { id } = await newRun({
      keywords: null,
      keywordCount: 24,
      countries: ["US", "CA", "GB", "AU", "NZ"],
    });
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    const run = (await getRun(t.db, id))!;
    expect(run.state.plan.keywordRequests).toHaveLength(50);
    expect(run.state.steps.discover).toMatchObject({ status: "running", done: 0, total: 50 });
    // Only the 10 keywords that fit are reported as this run's keywords.
    expect(run.state.plan.keywords).toHaveLength(10);
  });

  it("spaces Meta requests across ticks with the saved next request time", async () => {
    let now = Date.now();
    const sleeps: number[] = [];
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    };
    const { id } = await newRun({ keywords: ["a", "b"] });
    for (let i = 0; i < 4; i++) {
      await runTick(t.db, deps({ clock }), { runId: id, budgetMs: 0 });
      now += 1000;
    }
    const run = (await getRun(t.db, id))!;
    expect(run.state.progress.keyword).toBe(2);
    // Request 1 went right away; request 2 waited out the rest of the 5 s from tick to tick.
    expect(sleeps).toEqual([4000]);
  });

  it("wraps up a run that made no progress for 2 hours", async () => {
    const { id } = await newRun();
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    await t.db
      .update(pipelineRuns)
      .set({
        state: sql`jsonb_set(${pipelineRuns.state}, '{progressAt}', to_jsonb((now() - interval '3 hours')::text))`,
      })
      .where(eq(pipelineRuns.id, id));
    const run = await driveRun(t.db, deps(), id);
    expect(adFetch).not.toHaveBeenCalled();
    expect(run.status).toBe("partial");
    expect(run.state.steps.discover).toMatchObject({ status: "skipped", skipReason: "stalled" });
    expect(run.state.steps.collect).toMatchObject({ status: "skipped", skipReason: "stalled" });
    expect(run.state.steps.fx.status).toBe("done");
    expect(run.state.steps.score.status).toBe("done");
  });

  it("wraps up near the tick limit and fails runs past their hard limits", async () => {
    const { id } = await newRun();
    await t.db.update(pipelineRuns).set({ ticks: 37 }).where(eq(pipelineRuns.id, id));
    const wrapped = await driveRun(t.db, deps(), id);
    expect(wrapped.status).toBe("partial");
    expect(wrapped.state.steps.fx).toMatchObject({ status: "skipped", skipReason: "tick_limit" });
    expect(wrapped.state.steps.score.status).toBe("done");

    const old = await newRun();
    await t.db
      .update(pipelineRuns)
      .set({ createdAt: sql`now() - interval '21 hours'` })
      .where(eq(pipelineRuns.id, old.id));
    expect(await runTick(t.db, deps(), { runId: old.id })).toMatchObject({
      kind: "finished",
      status: "failed",
    });
    expect((await getRun(t.db, old.id))?.error).toMatch(/20 hours/);
  });

  it("wraps up a run whose saved state is from an incompatible version", async () => {
    const { id } = await newRun();
    await t.db
      .update(pipelineRuns)
      .set({ state: { v: 99 } as never })
      .where(eq(pipelineRuns.id, id));
    const run = await driveRun(t.db, deps(), id);
    expect(run.status).toBe("partial");
    expect(run.state.steps.discover.skipReason).toBe("incompatible_state");
    expect(run.state.steps.score.status).toBe("done");
  });

  it("shares one active run between callers", async () => {
    const a = await createRun(t.db, { trigger: "web", options: options(), env: "local" });
    const b = await createRun(t.db, { trigger: "cron", options: options(), env: "local" });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, run: { id: a.run.id, trigger: "web" } });
  });

  it("reports progress from the saved state", async () => {
    const { id } = await newRun();
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    const running = (await getRun(t.db, id))!;
    const p = toProgress({
      latest: running,
      lastFinished: null,
      backoff: null,
      sweepsToday: 1,
      now: Date.now(),
    });
    expect(p.run).toMatchObject({ id, status: "running", currentStep: "discover", stalled: false });
    expect(p.run?.steps.find((s) => s.name === "discover")).toMatchObject({
      status: "running",
      done: 0,
      total: 1,
    });
    expect(p.adLibrary).toMatchObject({ sweepsToday: 1, dailySweepCap: 3, reason: null });
    // Quiet for a minute with nobody holding it: stalled.
    expect(
      toProgress({
        latest: running,
        lastFinished: null,
        backoff: null,
        sweepsToday: 0,
        now: Date.now() + 60_000,
      }).run?.stalled,
    ).toBe(true);

    const done = await driveRun(t.db, deps(), id);
    const final = toProgress({
      latest: done,
      lastFinished: done,
      backoff: { until: new Date(Date.now() + 3_600_000), strikes: 2 },
      sweepsToday: 3,
      now: Date.now(),
    });
    expect(final.lastRun?.summary).toMatchObject({ newProducts: 1, adLibraryRequests: 1 });
    expect(final.lastRun?.currentStep).toBeNull();
    expect(final.adLibrary).toMatchObject({ reason: "backoff", strikes: 2 });
  });
});

describe("pipeline runner: Meta safety and limits", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let adFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    t = await createTestDb();
    adFetch = vi.fn<typeof fetch>(async () => new Response(adHtml));
  });
  afterEach(async () => {
    await t.close();
  });

  const deps = (extra: Partial<RunnerDeps> = {}): RunnerDeps => ({
    egress: "local",
    clock: { now: () => Date.now(), sleep: async () => {} },
    now: NOW,
    fetchFxRates: async () => parseEcbDaily(ecbXml),
    adLibrary: ({ mode, countries }) =>
      createAdLibraryWebAdapter({
        mode,
        countries,
        maxRequests: 1,
        retry: { fetchImpl: adFetch, retries: 0 },
      }),
    imageRetry: { fetchImpl: async () => new Response("", { status: 404 }) },
    ...extra,
  });
  const newRun = async (o: Partial<RunOptions> = {}) =>
    (
      await createRun(t.db, {
        trigger: "cli",
        options: parseRunOptions({
          keywords: ["posture corrector"],
          countries: ["US"],
          advertisers: 0,
          collect: 0,
          ...o,
        }),
        env: "local",
        now: NOW,
      })
    ).run;
  const expireLease = (id: number, state?: unknown) =>
    t.db
      .update(pipelineRuns)
      .set({
        ...(state ? { state: state as never } : {}),
        lockToken: "00000000-0000-4000-8000-000000000000",
        lockedUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(pipelineRuns.id, id));

  it("follows advertisers found by an earlier sweep, within the run's request budget", async () => {
    await driveRun(t.db, deps(), (await newRun()).id);
    adFetch.mockClear();

    const run = await driveRun(t.db, deps(), (await newRun({ advertisers: 2 })).id);
    const urls = adFetch.mock.calls.map((c) => String(c[0]));
    const followed = urls.filter((u) => u.includes("view_all_page_id"));
    expect(followed.length).toBeGreaterThan(0);
    expect(followed.length).toBeLessThanOrEqual(2);
    expect(run.state.steps.advertisers).toMatchObject({ status: "done", total: followed.length });
    expect(run.state.plan.advertiserRequests).toHaveLength(followed.length);
    // Every Meta request of the run was counted: 1 keyword request + the advertisers.
    expect(run.adLibraryRequests).toBe(1 + followed.length);
    expect(adFetch).toHaveBeenCalledTimes(1 + followed.length);
    // Advertiser following writes its own ingestion row.
    const rows = (await t.db.select().from(ingestionRuns)).filter(
      (r) => r.pipelineRunId === run.id && r.provider === "ad_library_web",
    );
    expect(rows).toHaveLength(2);
  });

  it("clamps advertiser following to what is left of the 70 requests", async () => {
    await driveRun(t.db, deps(), (await newRun()).id);
    const { id } = await newRun({ advertisers: 5 });
    // Run until the keyword sweep is stored, then pretend it used 69 requests.
    for (let i = 0; i < 10; i++) {
      await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
      if ((await getRun(t.db, id))!.state.cursor === "advertisers") break;
    }
    const run = (await getRun(t.db, id))!;
    expect(run.state.plan.advertiserRequests).toBeNull();
    await t.db
      .update(pipelineRuns)
      .set({
        state: { ...run.state, adLibrary: { ...run.state.adLibrary, requests: 69 } },
        adLibraryRequests: 69,
      })
      .where(eq(pipelineRuns.id, id));
    const done = await driveRun(t.db, deps(), id);
    expect(done.state.plan.advertiserRequests).toHaveLength(1);
    expect(done.adLibraryRequests).toBe(70);
  });

  it("sends a refused request once and backs off (ADR-006: stop on 429)", async () => {
    adFetch.mockImplementation(async () => new Response("", { status: 429 }));
    const run = await driveRun(t.db, deps(), (await newRun({ keywords: ["a", "b"] })).id);
    expect(adFetch).toHaveBeenCalledTimes(1);
    expect(run.adLibraryRequests).toBe(1);
    expect(run.state.steps.discover.status).toBe("failed");
    expect(await t.db.select().from(sourceBackoff)).toHaveLength(1);
  });

  it("does not ask Meta again for a request whose answer was staged before a crash", async () => {
    const { id } = await newRun();
    for (let i = 0; i < 3; i++) await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    const after = (await getRun(t.db, id))!;
    expect(after.state.progress.keyword).toBe(1);
    expect(adFetch).toHaveBeenCalledTimes(1);
    // The process died after staging, before saving its progress.
    await expireLease(id, {
      ...after.state,
      cursor: "discover",
      progress: { ...after.state.progress, keyword: 0 },
      unit: { name: "discover", key: "0", observedAt: new Date().toISOString(), attempts: 1 },
    });
    const run = await driveRun(t.db, deps(), id);
    expect(adFetch).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("succeeded");
    expect(await t.db.select().from(products)).toHaveLength(1);
  });

  it("never sends while this machine backs off, even in a run planned elsewhere", async () => {
    const { id } = await newRun({ keywords: ["a", "b"] });
    // Planned by the server (another egress)…
    await runTick(t.db, deps({ egress: "vercel" }), { runId: id, budgetMs: 0 });
    await runTick(t.db, deps({ egress: "vercel" }), { runId: id, budgetMs: 0 });
    expect((await getRun(t.db, id))!.state.plan.keywordRequests).toHaveLength(2);
    // …then driven by this machine, which Meta blocked earlier.
    await recordBlock(t.db, "ad_library_web", "local", "CAPTCHA", new Date());
    const run = await driveRun(t.db, deps(), id);
    expect(adFetch).not.toHaveBeenCalled();
    expect(run.adLibraryRequests).toBe(0);
    expect(run.state.steps.discover).toMatchObject({ status: "skipped", skipReason: "backoff" });
    expect(run.status).toBe("partial");
  });

  it("stores the ads a sweep already fetched when the run is wrapped up early", async () => {
    const { id } = await newRun({ keywords: ["a", "b"] });
    for (let i = 0; i < 3; i++) await runTick(t.db, deps(), { runId: id, budgetMs: 0 });
    expect((await getRun(t.db, id))!.state.progress.keyword).toBe(1);
    await t.db
      .update(pipelineRuns)
      .set({
        state: sql`jsonb_set(${pipelineRuns.state}, '{progressAt}', to_jsonb((now() - interval '3 hours')::text))`,
      })
      .where(eq(pipelineRuns.id, id));
    const run = await driveRun(t.db, deps(), id);
    expect(adFetch).toHaveBeenCalledTimes(1);
    expect(await t.db.select().from(products)).toHaveLength(1);
    expect(run.state.steps.discover.status).toBe("done");
    expect(run.state.steps.advertisers).toMatchObject({ status: "skipped", skipReason: "stalled" });
    expect(run.state.steps.score.status).toBe("done");
    expect(run.status).toBe("partial");
  });

  it(`hashes at most ${HASH_PER_RUN} product photos per run`, async () => {
    await t.db.insert(products).values(
      Array.from({ length: 130 }, (_, i) => ({
        slug: `p-${i}`,
        title: `Product ${i}`,
        firstSeenAt: NOW,
      })),
    );
    const run = await driveRun(t.db, deps({ adLibrary: undefined }), (await newRun()).id);
    expect(run.state.progress.hashAttempted).toBe(HASH_PER_RUN);
  });

  it("keeps the lease of a long unit alive without a time budget (CLI)", async () => {
    const { id } = await newRun();
    let renewed = false;
    const slow = deps({
      async fetchFxRates() {
        // The lease is about to run out while the unit is still busy…
        await t.db
          .update(pipelineRuns)
          .set({ lockedUntil: sql`now() + interval '2 seconds'` })
          .where(eq(pipelineRuns.id, id));
        await new Promise((r) => setTimeout(r, 150));
        // …and the heartbeat extended it.
        const run = (await getRun(t.db, id))!;
        renewed = run.lockedUntil!.getTime() > Date.now() + 60_000;
        return parseEcbDaily(ecbXml);
      },
    });
    const r = await runTick(t.db, slow, { runId: id, heartbeatMs: 20 });
    expect(renewed).toBe(true);
    expect(r).toMatchObject({ kind: "finished" });
  });

  it("fails a run past the tick limit, and the watchdog abandons one nobody can tick", async () => {
    const { id } = await newRun();
    await t.db.update(pipelineRuns).set({ ticks: 40 }).where(eq(pipelineRuns.id, id));
    expect(await runTick(t.db, deps(), { runId: id })).toMatchObject({
      kind: "finished",
      status: "failed",
    });
    expect((await getRun(t.db, id))?.error).toMatch(/40 ticks/);

    const stuck = await newRun();
    await t.db.update(pipelineRuns).set({ ticks: 40 }).where(eq(pipelineRuns.id, stuck.id));
    await expireLease(stuck.id);
    expect(await expireRun(t.db, (await getRun(t.db, stuck.id))!, Date.now())).toBe(true);
    expect(await getRun(t.db, stuck.id)).toMatchObject({ status: "failed" });

    const young = await newRun();
    expect(await expireRun(t.db, young, Date.now())).toBe(false);
  });
});

describe("backoffMs", () => {
  it("doubles from 6 hours up to 7 days", () => {
    const h = (n: number) => backoffMs(n) / 3_600_000;
    expect([1, 2, 3, 4, 5, 6].map(h)).toEqual([6, 12, 24, 48, 96, 168]);
  });
});
