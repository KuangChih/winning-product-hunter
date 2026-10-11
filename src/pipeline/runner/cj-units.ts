/**
 * CJ Dropshipping discovery step (ADR-014): runs after the Meta sweep and before the Shopify
 * collect, whether or not Meta is blocked. Units: `cj` (plan, then a few list requests per
 * unit), `cj_details` (a few free detail requests per unit), `cj_finalize` (tracks promising
 * products and stores their CJ listings). Every request is counted and the next allowed request
 * time saved before it is sent (the access-token request too). CJ's per-second refusal (1600200)
 * is momentary (measured: the next request a second later goes through), so the request is sent
 * again after `CJ_QPS_WAIT_MS`, at most `CJ_QPS_ATTEMPTS` times; still refused → no more CJ
 * requests this run, without a back-off. Points used up → stop and back this egress off; a
 * refused key → stop (ADR-006, ADR-014).
 */
import { inArray } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products } from "@/db/schema";
import {
  addCandidates,
  candidateDetail,
  cjProductKey,
  CJ_TAKE,
  isCjPromising,
} from "@/discovery/cj";
import { DISCOVERY_KEYWORDS, keywordsForDay } from "@/discovery/keywords";
import { runIngestion, startIngestionRun, type AdapterMeta } from "@/ingestion/run";
import {
  CjApiError,
  cjListingItem,
  CJ_PROVIDER,
  isCjStop,
  type CjClient,
  type CjListProduct,
  type CjPointsInfo,
} from "@/ingestion/sources/cj";
import type { FetchedItem } from "@/ingestion/types";
import { slugify } from "@/matching/normalize";
import { clearBackoff, getBackoff, recordBlock } from "./guards";
import { errorMessage, setStep, WRAP_UP_FROM } from "./state";
import type { UnitCtx, UnitDef } from "./units";
import type { CjCandidate, CjListRequest, CjStepState, RunState } from "./types";

/**
 * CJ's free tier allows 1 request per second, counted on CJ's side (docs/research/cj-api.md).
 * Measured send-to-send: 1.0 s gaps were refused 1 in 6, 0.8 s 2 in 4, 1.25 s and 1.5 s never
 * (12 requests); 1.5 s leaves room for network jitter.
 */
export const CJ_INTERVAL_MS = 1_500;
/** After a per-second refusal: wait this long and send the same request again… */
export const CJ_QPS_WAIT_MS = 3_000;
/** …at most this many attempts in all. */
export const CJ_QPS_ATTEMPTS = 3;
/** List requests per run (50 points each): CJ trending + up to 10 keywords. */
export const MAX_CJ_LIST_REQUESTS = 11;
/** Products per list request. */
export const CJ_LIST_SIZE = 50;
/** Detail requests per run (free, but spaced like every request). */
export const MAX_CJ_DETAIL_REQUESTS = 40;
/** Requests per unit; a unit also stops starting requests after `CJ_UNIT_MS`. */
export const CJ_LIST_BATCH = 3;
export const CJ_DETAIL_BATCH = 10;
export const CJ_UNIT_MS = 35_000;

export const CJ_META: AdapterMeta = { source: "cj", provider: CJ_PROVIDER };

const runNow = (s: RunState) => new Date(s.now);
const cjStep = (s: RunState): CjStepState => s.steps.cj;

/** What a list request is called in the candidates' `foundBy`. */
export function cjRequestLabel(r: CjListRequest): string {
  return r.keyword ?? (r.trending ? "trending" : "all");
}

/** The run's CJ list requests: CJ's trending products, then the run's keywords (most listed). */
export function planCjRequests(s: RunState, options: UnitCtx["options"]): CjListRequest[] {
  const now = runNow(s);
  const keywords =
    s.plan.keywords ??
    options.keywords ??
    keywordsForDay(now, options.keywordCount, DISCOVERY_KEYWORDS);
  const trending: CjListRequest = {
    keyword: null,
    trending: true,
    orderBy: "listed",
    take: CJ_TAKE.trending,
  };
  const searches = keywords.map((keyword): CjListRequest => ({
    keyword,
    trending: false,
    orderBy: "listed",
    take: CJ_TAKE.keyword,
    window: CJ_TAKE.keywordWindow,
  }));
  return [trending, ...searches].slice(0, MAX_CJ_LIST_REQUESTS);
}

type Outcome = { ok: true; points: CjPointsInfo | null } | { ok: false; error: unknown };

const isQpsRefusal = (err: unknown) => err instanceof CjApiError && err.kind === "rate_limited";

/**
 * Sends one CJ call. Every HTTP request it makes (the access token included) is paced: the count
 * and the next allowed send time are saved before it goes out, so a killed process never
 * undercounts and the spacing holds across ticks. A per-second refusal is sent again after a
 * short wait (see `CJ_QPS_ATTEMPTS`).
 */
async function counted<T extends { points: CjPointsInfo | null }>(
  ctx: UnitCtx,
  s: RunState,
  send: (client: CjClient) => Promise<T>,
): Promise<{ s: RunState; result?: T; outcome: Outcome }> {
  const { clock, signal } = ctx;
  let next = s;
  const beforeRequest = async (sig?: AbortSignal) => {
    const t = clock.now();
    const startAt = Math.max(t, Math.min(next.rate.cjNextAt ?? 0, t + CJ_QPS_WAIT_MS));
    next = setStep({ ...next, rate: { ...next.rate, cjNextAt: startAt + CJ_INTERVAL_MS } }, "cj", {
      requests: cjStep(next).requests + 1,
    });
    await ctx.save(next);
    if (startAt > t) await clock.sleep(startAt - t, sig ?? signal);
  };
  const client = ctx.deps.cj!(ctx.db, { beforeRequest });
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await send(client);
      if (result.points) next = setStep(next, "cj", { pointsUsedToday: result.points.usedToday });
      return { s: next, result, outcome: { ok: true, points: result.points } };
    } catch (error) {
      if (signal.aborted) throw error;
      if (!isQpsRefusal(error) || attempt >= CJ_QPS_ATTEMPTS) {
        return { s: next, outcome: { ok: false, error } };
      }
      // Momentary: the next request goes out after the wait (saved, so it holds across ticks).
      next = setStep(
        {
          ...next,
          rate: {
            ...next.rate,
            cjNextAt: Math.max(next.rate.cjNextAt ?? 0, clock.now() + CJ_QPS_WAIT_MS),
          },
        },
        "cj",
        { qpsRetries: (cjStep(next).qpsRetries ?? 0) + 1 },
      );
      await ctx.save(next);
    }
  }
}

/**
 * CJ refused us: no more CJ requests this run. Only used-up points back this egress off: a
 * per-second refusal that outlasted the retries is a momentary limit, not a block.
 */
async function stopCj(ctx: UnitCtx, s: RunState, err: unknown): Promise<RunState> {
  const reason = errorMessage(err);
  const at = new Date(ctx.clock.now());
  if (err instanceof CjApiError && err.kind === "points") {
    await recordBlock(ctx.db, CJ_PROVIDER, ctx.deps.egress, reason, at);
  }
  const auth = err instanceof CjApiError && err.kind === "auth";
  return {
    ...setStep(s, "cj", {
      stopped: { at: at.toISOString(), reason },
      error: auth ? `CJ refused the API key or token (check CJ_API_KEY): ${reason}` : reason,
    }),
    cursor: "cj_finalize",
  };
}

const cj: UnitDef = {
  worstMs: 60_000,
  async run(ctx) {
    const { db, deps, clock, options } = ctx;
    let s = ctx.state;
    const requests = s.plan.cj;
    if (requests === null || requests === undefined) {
      const skip = (patch: Partial<CjStepState>): RunState => ({
        ...setStep({ ...s, plan: { ...s.plan, cj: [] } }, "cj", patch),
        cursor: "collect",
      });
      if (!deps.cj) return skip({ status: "skipped", skipReason: "not_configured" });
      const backoff = await getBackoff(db, CJ_PROVIDER, deps.egress);
      if (backoff && backoff.until.getTime() > clock.now()) {
        return skip({
          status: "skipped",
          skipReason: "backoff",
          detail: `back-off until ${backoff.until.toISOString()}`,
        });
      }
      const planned = planCjRequests(s, options);
      s = { ...s, plan: { ...s.plan, cj: planned }, cjCandidates: [] };
      return setStep(s, "cj", { status: "running", done: 0, total: planned.length });
    }

    // List requests, a few per unit (one at a time on a retried unit).
    const batch = (s.unit?.attempts ?? 1) > 1 ? 1 : CJ_LIST_BATCH;
    const unitEnd = clock.now() + CJ_UNIT_MS;
    let idx = s.progress.cjList ?? 0;
    for (let n = 0; idx < requests.length && n < batch; n++) {
      if (n > 0 && (clock.now() > ctx.softStop || clock.now() > unitEnd)) break;
      const req = requests[idx];
      const r = await counted(ctx, s, (client) =>
        client.listProducts(
          {
            keyword: req.keyword ?? undefined,
            trending: req.trending,
            createdAfter: req.createdAfter,
            orderBy: req.orderBy,
            // Points are per request: a keyword only needs its first results.
            size: req.window === undefined ? CJ_LIST_SIZE : Math.max(20, req.window),
          },
          ctx.signal,
        ),
      );
      s = r.s;
      idx++;
      s = { ...s, progress: { ...s.progress, cjList: idx } };
      if (!r.outcome.ok) {
        if (isCjStop(r.outcome.error))
          return stopCj(ctx, setStep(s, "cj", { done: idx }), r.outcome.error);
        // One bad list (e.g. CJ had a hiccup): note it and go on with the next.
        s = setStep(s, "cj", {
          done: idx,
          error: errorMessage(r.outcome.error),
          listFailures: (cjStep(s).listFailures ?? 0) + 1,
        });
        continue;
      }
      if (idx === 1) await clearBackoff(db, CJ_PROVIDER, deps.egress);
      const listed = r.result!.products as CjListProduct[];
      const candidates = addCandidates(s.cjCandidates ?? [], listed, cjRequestLabel(req), {
        take: req.take,
        window: req.window,
        max: MAX_CJ_DETAIL_REQUESTS,
      });
      s = setStep({ ...s, cjCandidates: candidates }, "cj", {
        done: idx,
        listed: cjStep(s).listed + listed.length,
      });
    }
    if (idx < requests.length) return s;
    const total = (s.cjCandidates ?? []).length;
    return {
      ...setStep(s, "cj", { done: 0, total }),
      cursor: total > 0 ? "cj_details" : "cj_finalize",
    };
  },
};

const cjDetails: UnitDef = {
  worstMs: 60_000,
  async run(ctx) {
    const { clock } = ctx;
    let s = ctx.state;
    const candidates = [...(s.cjCandidates ?? [])];
    const batch = (s.unit?.attempts ?? 1) > 1 ? 1 : CJ_DETAIL_BATCH;
    const unitEnd = clock.now() + CJ_UNIT_MS;
    let idx = s.progress.cjDetail ?? 0;
    for (let n = 0; idx < candidates.length && n < batch; n++) {
      if (n > 0 && (clock.now() > ctx.softStop || clock.now() > unitEnd)) break;
      const c = candidates[idx];
      const r = await counted(ctx, s, (client) => client.productDetail(c.id, ctx.signal));
      s = r.s;
      idx++;
      if (r.outcome.ok) {
        candidates[idx - 1] = { ...c, detail: candidateDetail(r.result!.detail) };
      }
      s = { ...s, cjCandidates: candidates, progress: { ...s.progress, cjDetail: idx } };
      s = setStep(s, "cj", { done: idx });
      if (!r.outcome.ok) {
        if (isCjStop(r.outcome.error)) return stopCj(ctx, s, r.outcome.error);
        s = setStep(s, "cj", { detailFailures: cjStep(s).detailFailures + 1 });
      }
    }
    return idx < candidates.length ? s : { ...s, cursor: "cj_finalize" };
  },
  // A detail request that keeps killing the process is skipped (judged on list data only).
  poison: ({ state: s }) => {
    const idx = (s.progress.cjDetail ?? 0) + 1;
    const next = setStep({ ...s, progress: { ...s.progress, cjDetail: idx } }, "cj", {
      done: idx,
      detailFailures: cjStep(s).detailFailures + 1,
    });
    return idx >= (s.cjCandidates ?? []).length ? { ...next, cursor: "cj_finalize" } : next;
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

/** The listing item of a candidate (list data plus whatever the detail request returned). */
export function candidateItem(c: CjCandidate): FetchedItem {
  const list: CjListProduct = {
    id: c.id,
    nameEn: c.title,
    bigImage: c.imageUrl ?? undefined,
    sellPrice: c.priceCents === null ? undefined : (c.priceCents / 100).toFixed(2),
    listedNum: c.listedNum ?? undefined,
    createAt: c.createAt ?? undefined,
    threeCategoryName: c.category ?? undefined,
  };
  const d = c.detail;
  const item = cjListingItem(
    list,
    d
      ? {
          id: c.id,
          listed: d.listed,
          soldOut: d.soldOut,
          orderCount: d.orderCount,
          totalQuantity: d.totalQuantity,
          totalRefundQuantity: d.totalRefundQuantity,
          latestPaymentDate: d.latestPaymentDate,
          createdate: d.createdAt === null ? null : String(d.createdAt),
        }
      : null,
  );
  return { ...item, raw: { candidate: c } };
}

/**
 * Tracks promising candidates as products (key `cj:<pid>`) and stores the CJ listing of every
 * candidate that has a product (new or from an earlier run). Others are not stored: a CJ
 * listing without a product would be matched by title, which is too loose (ADR-014).
 */
const cjFinalize: UnitDef = {
  worstMs: 30_000,
  async run(ctx) {
    const { db, runId } = ctx;
    let s = ctx.state;
    const next = s.steps.collect.status === "skipped" ? WRAP_UP_FROM : "collect";
    const st = cjStep(s);
    const candidates = s.cjCandidates ?? [];
    if (st.requests === 0) {
      if (st.status === "running")
        s = setStep(s, "cj", { status: "done", detail: "no requests made" });
      return { ...s, cursor: next };
    }
    const now = runNow(s);
    const promising = candidates.filter((c) => isCjPromising(c, now));
    const idByKey = await productIdsByKey(
      db,
      candidates.map((c) => cjProductKey(c.id)),
    );
    const toCreate = promising.filter((c) => !idByKey.has(cjProductKey(c.id)));
    let created = 0;
    if (toCreate.length > 0) {
      const usedSlugs = new Set(
        (await db.select({ slug: products.slug }).from(products)).map((p) => p.slug),
      );
      const inserted = await db
        .insert(products)
        .values(
          toCreate.map((c) => {
            let slug = slugify(c.title);
            for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(c.title)}-${n}`;
            usedSlugs.add(slug);
            const item = candidateItem(c);
            return {
              slug,
              title: c.title,
              category: c.category,
              imageUrl: c.imageUrl,
              landingKey: cjProductKey(c.id),
              canonicalUrl: item.url,
              // The product existed on CJ before we saw it: as old as its CJ listing.
              firstSeenAt: new Date(
                Math.min(now.getTime(), c.createAt ?? c.detail?.createdAt ?? now.getTime()),
              ),
            };
          }),
        )
        .onConflictDoNothing({ target: products.landingKey })
        .returning({ id: products.id, key: products.landingKey });
      created = inserted.length;
      for (const p of inserted) idByKey.set(p.key!, p.id);
      const missing = toCreate.map((c) => cjProductKey(c.id)).filter((k) => !idByKey.has(k));
      for (const [k, id] of await productIdsByKey(db, missing)) idByKey.set(k, id);
    }

    const toStore = candidates.flatMap((c) => {
      const productId = idByKey.get(cjProductKey(c.id));
      return productId ? [{ ...candidateItem(c), productId }] : [];
    });
    let ingestionRunId = s.unit?.ingestionRunId;
    if (ingestionRunId === undefined) {
      ingestionRunId = await startIngestionRun(db, CJ_META, now, runId);
      s = { ...s, unit: { ...s.unit!, ingestionRunId } };
      await ctx.save(s);
    }
    const failure = st.stopped ? new Error(st.stopped.reason) : undefined;
    const ingestion = await runIngestion(
      db,
      {
        ...CJ_META,
        async *fetch() {
          yield* toStore;
          if (failure) throw failure;
        },
      },
      { queries: [], limit: toStore.length + 1 },
      () => now,
      { pipelineRunId: runId, runId: ingestionRunId },
    );
    const withDetail = candidates.filter((c) => c.detail).length;
    const points =
      st.pointsUsedToday === null ? "" : `, ${st.pointsUsedToday} CJ points used today`;
    const detail =
      `${st.requests} requests${points}: ${st.listed} products listed, ` +
      `${candidates.length} checked (${withDetail} with sales data), ${promising.length} with sales → ` +
      `${created} new products, ${toStore.length} listings stored`;
    const allListsFailed = (st.listFailures ?? 0) >= (s.plan.cj ?? []).length;
    const failed = !!st.stopped || allListsFailed || ingestion.status === "failed";
    s = {
      ...setStep(s, "cj", {
        status: failed ? "failed" : "done",
        detail,
        ...(failed ? { error: st.error ?? ingestion.error } : {}),
      }),
      results: {
        ...s.results,
        newProducts: s.results.newProducts + created,
        cjProducts: (s.results.cjProducts ?? 0) + created,
      },
    };
    return { ...s, cursor: next };
  },
};

export const CJ_UNITS = { cj, cj_details: cjDetails, cj_finalize: cjFinalize };
