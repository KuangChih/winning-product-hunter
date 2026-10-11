/**
 * Official Meta Ad Library API step (ADR-015): runs after the Ad Library website steps and
 * before CJ, whether or not the website is blocked (the API is a different service with its own
 * limits; the website's back-off does not apply to it). Units: `meta_api` (plan, then a few
 * keyword requests per unit) and `meta_api_finalize` (groups the ads into products and stores
 * them). Every request is counted and the next allowed time saved before it is sent, and each
 * answer is staged, so a retried unit never asks Meta again. A refusal (invalid token, rate
 * limit, request refused) ends the step's requests without retries; a rate limit backs this
 * egress off (ADR-006).
 */
import { inArray } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products } from "@/db/schema";
import { DISCOVERY_KEYWORDS, keywordsForDay } from "@/discovery/keywords";
import {
  groupApiAds,
  isApiGroupPromising,
  pickWebProduct,
  webProductsByDomain,
  webTwinProducts,
} from "@/discovery/meta-api";
import { runIngestion, startIngestionRun, type AdapterMeta } from "@/ingestion/run";
import {
  META_API_PROVIDER,
  META_API_TARGET_COUNTRIES,
  MetaApiError,
  metaLibraryId,
} from "@/ingestion/sources/meta-ads";
import { slugify } from "@/matching/normalize";
import { clearBackoff, getBackoff, recordBlock } from "./guards";
import { errorMessage, setStep, WRAP_UP_FROM } from "./state";
import { getStagedRequest, loadStage, upsertStage } from "./store";
import type { MetaApiRequest, MetaApiStepState, RunState } from "./types";
import type { UnitCtx, UnitDef } from "./units";

/**
 * Meta publishes no number for the Ad Library API, and Graph API's per-user limit for user
 * tokens is hidden (docs/research/meta-ad-library-api.md): a few spaced requests per run, at
 * most a few runs a day, and stop at the first rate-limit answer.
 */
export const META_API_INTERVAL_MS = 2_000;
/** Requests per run: one per keyword, at most this many. */
export const MAX_META_API_REQUESTS = 10;
/** Ads per request (Graph API `limit`). */
export const META_API_PAGE_SIZE = 100;
/** Requests per unit; a unit also stops starting requests after `META_API_UNIT_MS`. */
export const META_API_BATCH = 5;
export const META_API_UNIT_MS = 30_000;

export const META_API_META: AdapterMeta = { source: "meta_ads", provider: META_API_PROVIDER };

const runNow = (s: RunState) => new Date(s.now);
const apiStep = (s: RunState): MetaApiStepState => s.steps.meta_api;

/** The run's API requests: the run's keywords, each in the UK and the EU target markets. */
export function planMetaApiRequests(s: RunState, options: UnitCtx["options"]): MetaApiRequest[] {
  const keywords =
    s.plan.keywords ??
    options.keywords ??
    keywordsForDay(runNow(s), options.keywordCount, DISCOVERY_KEYWORDS);
  return [...new Set(keywords)]
    .slice(0, MAX_META_API_REQUESTS)
    .map((query) => ({ query, countries: [...META_API_TARGET_COUNTRIES] }));
}

/** Meta refused us: no more API requests this run; a rate limit backs this egress off. */
async function stopApi(ctx: UnitCtx, s: RunState, err: MetaApiError): Promise<RunState> {
  const reason = errorMessage(err);
  const at = new Date(ctx.clock.now());
  if (err.kind === "rate_limited") {
    await recordBlock(ctx.db, META_API_PROVIDER, ctx.deps.egress, reason, at);
  }
  const hint =
    err.kind === "token"
      ? "Meta refused the access token (renew META_ACCESS_TOKEN): "
      : err.kind === "request"
        ? "Meta refused the request (check the app's Ad Library API access): "
        : "";
  return {
    ...setStep(s, "meta_api", { stopped: { at: at.toISOString(), reason }, error: hint + reason }),
    cursor: "meta_api_finalize",
  };
}

const isStop = (err: unknown): err is MetaApiError =>
  err instanceof MetaApiError && err.kind !== "service";

const metaApi: UnitDef = {
  worstMs: 45_000,
  async run(ctx) {
    const { db, deps, clock, runId, options, signal } = ctx;
    let s = ctx.state;
    const requests = s.plan.metaApi;
    if (requests === null || requests === undefined) {
      const skip = (patch: Partial<MetaApiStepState>): RunState => ({
        ...setStep({ ...s, plan: { ...s.plan, metaApi: [] } }, "meta_api", patch),
        cursor: "cj",
      });
      if (!deps.metaApi) return skip({ status: "skipped", skipReason: "not_configured" });
      const backoff = await getBackoff(db, META_API_PROVIDER, deps.egress);
      if (backoff && backoff.until.getTime() > clock.now()) {
        return skip({
          status: "skipped",
          skipReason: "backoff",
          detail: `back-off until ${backoff.until.toISOString()}`,
        });
      }
      const planned = planMetaApiRequests(s, options);
      if (planned.length === 0) return skip({ status: "done", detail: "no keywords" });
      s = { ...s, plan: { ...s.plan, metaApi: planned } };
      return setStep(s, "meta_api", { status: "running", done: 0, total: planned.length });
    }

    // One request at a time on a retried unit.
    const batch = (s.unit?.attempts ?? 1) > 1 ? 1 : META_API_BATCH;
    const unitEnd = clock.now() + META_API_UNIT_MS;
    let idx = s.progress.metaApi ?? 0;
    for (let n = 0; idx < requests.length && n < batch; n++) {
      if (n > 0 && (clock.now() > ctx.softStop || clock.now() > unitEnd)) break;
      const req = requests[idx];

      // The process died after this request's answer was staged: do not ask Meta again.
      const staged = await getStagedRequest(db, runId, "meta_api", idx);
      if (staged) {
        idx++;
        s = setStep({ ...s, progress: { ...s.progress, metaApi: idx } }, "meta_api", {
          done: idx,
        });
        if (staged.failure !== null) {
          // It was a refusal (only refusals are staged with a failure): stop as before.
          return {
            ...setStep(s, "meta_api", {
              stopped: apiStep(s).stopped ?? {
                at: new Date(clock.now()).toISOString(),
                reason: staged.failure,
              },
            }),
            cursor: "meta_api_finalize",
          };
        }
        continue;
      }

      // Count first, with the next allowed time: a killed process never undercounts.
      const t = clock.now();
      const startAt = Math.max(t, Math.min(s.rate.metaApiNextAt ?? 0, t + META_API_INTERVAL_MS));
      s = setStep(
        { ...s, rate: { ...s.rate, metaApiNextAt: startAt + META_API_INTERVAL_MS } },
        "meta_api",
        { requests: apiStep(s).requests + 1 },
      );
      await ctx.save(s);
      if (startAt > t) await clock.sleep(startAt - t, signal);

      try {
        const page = await deps.metaApi!().search(
          { query: req.query, countries: req.countries, limit: META_API_PAGE_SIZE },
          signal,
        );
        await upsertStage(db, runId, "meta_api", idx, page.items, null);
        if (apiStep(s).requests === 1 || idx === 0) {
          await clearBackoff(db, META_API_PROVIDER, deps.egress);
        }
        idx++;
        s = setStep({ ...s, progress: { ...s.progress, metaApi: idx } }, "meta_api", {
          done: idx,
          ads: apiStep(s).ads + page.items.length,
        });
        s = {
          ...s,
          results: { ...s.results, adsFetched: s.results.adsFetched + page.items.length },
        };
      } catch (err) {
        if (signal.aborted) throw err;
        if (isStop(err)) {
          await upsertStage(db, runId, "meta_api", idx, [], errorMessage(err));
          idx++;
          s = setStep({ ...s, progress: { ...s.progress, metaApi: idx } }, "meta_api", {
            done: idx,
          });
          return stopApi(ctx, s, err);
        }
        // Meta or the network failed for this one request: note it and go on.
        await upsertStage(db, runId, "meta_api", idx, [], null);
        idx++;
        s = setStep({ ...s, progress: { ...s.progress, metaApi: idx } }, "meta_api", {
          done: idx,
          failures: apiStep(s).failures + 1,
          error: errorMessage(err),
        });
      }
    }
    return idx < requests.length ? s : { ...s, cursor: "meta_api_finalize" };
  },
  // A request that keeps killing the process is skipped (never hammer Meta).
  poison: ({ state: s }) => {
    if (s.plan.metaApi === null || s.plan.metaApi === undefined) {
      return {
        ...setStep({ ...s, plan: { ...s.plan, metaApi: [] } }, "meta_api", {
          status: "failed",
          error: "Interrupted 3 times",
        }),
        cursor: "cj",
      };
    }
    const idx = (s.progress.metaApi ?? 0) + 1;
    const next = setStep({ ...s, progress: { ...s.progress, metaApi: idx } }, "meta_api", {
      done: idx,
      failures: apiStep(s).failures + 1,
      error: `Request ${idx} was interrupted 3 times; skipped`,
    });
    return idx >= s.plan.metaApi.length ? { ...next, cursor: "meta_api_finalize" } : next;
  },
};

async function productIdsByKey(db: AnyDatabase, keys: string[]) {
  const rows = keys.length
    ? await db
        .select({ id: products.id, key: products.landingKey, mergedInto: products.mergedInto })
        .from(products)
        .where(inArray(products.landingKey, keys))
    : [];
  // A merged duplicate's key keeps pointing at the product it was merged into.
  return new Map(rows.map((p) => [p.key!, p.mergedInto ?? p.id]));
}

/**
 * Groups the staged ads by store domain + link title, then per group: the product already
 * tracked under its key, else the website-found product it clearly is (same store, same title),
 * else a new product when the group is promising. Ads of other groups are not stored (as for
 * the website's ads without a product).
 */
const metaApiFinalize: UnitDef = {
  worstMs: 30_000,
  async run(ctx) {
    const { db, runId } = ctx;
    let s = ctx.state;
    const next = s.steps.cj.status === "skipped" ? WRAP_UP_FROM : "cj";
    const st = apiStep(s);
    if (st.requests === 0) {
      if (st.status === "running") {
        s = setStep(s, "meta_api", { status: "done", detail: "no requests made" });
      }
      return { ...s, cursor: next };
    }
    const now = runNow(s);
    const stage = await loadStage(db, runId, "meta_api");
    const groups = groupApiAds(stage.items);
    const idByKey = await productIdsByKey(
      db,
      groups.map((g) => g.key),
    );
    const open = groups.filter((g) => !idByKey.has(g.key));
    const [web, twins] = await Promise.all([
      webProductsByDomain(db, [...new Set(open.map((g) => g.domain))]),
      webTwinProducts(
        db,
        open.flatMap((g) => g.ads.map((a) => metaLibraryId(a.externalId))),
      ),
    ]);
    const productOf = new Map<string, string>();
    let attachedToWeb = 0;
    let alreadyTracked = 0;
    let ambiguous = 0;
    const toCreate = [];
    for (const g of groups) {
      const known = idByKey.get(g.key);
      if (known) {
        productOf.set(g.key, known);
        alreadyTracked++;
        continue;
      }
      // The website already stored some of these very ads: their product is this product.
      const twinIds = new Set(g.ads.flatMap((a) => twins.get(metaLibraryId(a.externalId)) ?? []));
      if (twinIds.size > 1) {
        // The website put these ads under different products: do not guess, do not duplicate.
        ambiguous++;
        continue;
      }
      const webId = twinIds.size === 1 ? [...twinIds][0] : pickWebProduct(g, web);
      if (webId === "ambiguous") {
        // Several website products of this store look like it: never guess, never duplicate.
        ambiguous++;
      } else if (webId) {
        productOf.set(g.key, webId);
        attachedToWeb++;
      } else if (isApiGroupPromising(g, now)) {
        toCreate.push(g);
      }
    }

    let created = 0;
    if (toCreate.length > 0) {
      const usedSlugs = new Set(
        (await db.select({ slug: products.slug }).from(products)).map((p) => p.slug),
      );
      const inserted = await db
        .insert(products)
        .values(
          toCreate.map((g) => {
            let slug = slugify(g.displayTitle);
            for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(g.displayTitle)}-${n}`;
            usedSlugs.add(slug);
            const starts = g.ads.map((a) => a.startedAt?.getTime()).filter((t): t is number => !!t);
            return {
              slug,
              title: g.displayTitle,
              landingKey: g.key,
              // The API gives no product page URL: none rather than a guessed one.
              canonicalUrl: null,
              firstSeenAt: new Date(Math.min(now.getTime(), ...starts)),
            };
          }),
        )
        .onConflictDoNothing({ target: products.landingKey })
        .returning({ id: products.id, key: products.landingKey });
      created = inserted.length;
      for (const p of inserted) productOf.set(p.key!, p.id);
      const missing = toCreate.map((g) => g.key).filter((k) => !productOf.has(k));
      for (const [k, id] of await productIdsByKey(db, missing)) productOf.set(k, id);
    }

    const toStore = groups.flatMap((g) => {
      const productId = productOf.get(g.key);
      return productId ? g.ads.map((ad) => ({ ...ad, productId })) : [];
    });
    let ingestionRunId = s.unit?.ingestionRunId;
    if (ingestionRunId === undefined) {
      ingestionRunId = await startIngestionRun(db, META_API_META, now, runId);
      s = { ...s, unit: { ...s.unit!, ingestionRunId } };
      await ctx.save(s);
    }
    const failure = st.stopped ? new Error(st.stopped.reason) : undefined;
    const queries = (s.plan.metaApi ?? []).slice(0, s.progress.metaApi ?? 0).map((r) => r.query);
    const ingestion = await runIngestion(
      db,
      {
        ...META_API_META,
        async *fetch() {
          yield* toStore;
          if (failure) throw failure;
        },
      },
      { queries, limit: toStore.length + 1 },
      () => now,
      { pipelineRunId: runId, runId: ingestionRunId },
    );
    const distinctAds = new Set(stage.items.map((i) => i.externalId)).size;
    const grouped = groups.reduce((n, g) => n + g.ads.length, 0);
    const detail =
      `${st.requests} requests: ${distinctAds} ads (${grouped} with a store domain and product title) → ` +
      `${groups.length} groups: ${created} new products, ${attachedToWeb} attached to products ` +
      `found on the Ad Library website, ${alreadyTracked} already tracked` +
      (ambiguous ? `, ${ambiguous} left out (matching several website products)` : "") +
      `; ${toStore.length} ads stored`;
    const failed =
      !!st.stopped ||
      (st.failures > 0 && st.failures >= st.requests) ||
      ingestion.status === "failed";
    s = {
      ...setStep(s, "meta_api", {
        status: failed ? "failed" : "done",
        detail,
        ...(failed ? { error: st.error ?? ingestion.error } : {}),
      }),
      results: {
        ...s.results,
        newProducts: s.results.newProducts + created,
        metaApiProducts: (s.results.metaApiProducts ?? 0) + created,
      },
    };
    return { ...s, cursor: next };
  },
};

export const META_API_UNITS = { meta_api: metaApi, meta_api_finalize: metaApiFinalize };
