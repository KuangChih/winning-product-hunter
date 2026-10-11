/**
 * Units of the resumable pipeline (ADR-013). Each unit is safe to re-run after a crash: its
 * marker (with the observation time) is saved before it starts, writes are upserts stamped with
 * that time, and results are saved as soon as it ends. Item-level `catch` blocks rethrow when
 * the tick's signal aborted, so running out of time is never recorded as a product failure.
 */
import { and, count, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { saveFxRates } from "@/data/fx";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
import { advertiserTargets, pickAdvertisers } from "@/discovery/advertisers";
import { fetchDiscoveryItems, storeDiscovery } from "@/discovery/discover";
import { DISCOVERY_KEYWORDS, keywordsForDay } from "@/discovery/keywords";
import type { ProductQuery } from "@/ingestion/collect-for-products";
import { createRateLimiter } from "@/ingestion/http";
import {
  finishIngestionRun,
  reapStaleIngestionRuns,
  startIngestionRun,
  type AdapterMeta,
} from "@/ingestion/run";
import type { SourceAdapter } from "@/ingestion/types";
import { hashProductImages, mergeDuplicateProducts } from "@/matching/merge";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import {
  collectForTargets,
  pickLandingPages,
  pickProducts,
  PROVIDER_OF,
  recordAttempts,
} from "../targets";
import { CJ_UNITS } from "./cj-units";
import type { Clock, RunnerDeps } from "./deps";
import {
  AD_LIBRARY_PROVIDER,
  adLibraryAllowance,
  clearBackoff,
  getBackoff,
  isAdLibraryBlock,
  isAdLibraryStop,
  isAdLibraryStopMessage,
  recordBlock,
} from "./guards";
import {
  DAILY_SWEEP_CAP,
  MAX_AD_REQUESTS_PER_RUN,
  MAX_ADVERTISER_REQUESTS,
  MAX_KEYWORD_REQUESTS,
} from "./options";
import { errorMessage, failUnit, setStep, STEP_OF_UNIT, WRAP_UP_FROM } from "./state";
import {
  closeOpenIngestionRuns,
  deleteOrphanStage,
  deleteStage,
  getStagedRequest,
  loadStage,
  upsertStage,
  type StageBucket,
} from "./store";
import type { CollectStepState, RunOptions, RunState, UnitName } from "./types";

/** ADR-006: one Ad Library page every 5 seconds. */
export const AD_LIBRARY_INTERVAL_MS = 5_000;
export const SHOPIFY_INTERVAL_MS = 1_500;
/** Products per collect unit (each runs one search per country) and per store-lookup unit. */
export const COLLECT_BATCH = 4;
export const STORES_BATCH = 10;
/** Photos per hash unit, and at most this many per run. */
export const HASH_BATCH = 30;
export const HASH_PER_RUN = 100;

const AD_LIBRARY_META: AdapterMeta = { source: "meta_ads", provider: AD_LIBRARY_PROVIDER };

export class LostLeaseError extends Error {
  constructor() {
    super("Another process took over the pipeline run");
    this.name = "LostLeaseError";
  }
}

export interface UnitCtx {
  db: AnyDatabase;
  deps: RunnerDeps;
  clock: Clock;
  runId: number;
  /** When the run was created (database clock). */
  runCreatedAt: Date;
  options: RunOptions;
  state: RunState;
  /** Aborts when the tick runs out of time (the unit is then retried by the next tick). */
  signal: AbortSignal;
  /** Clock time after which a unit should not start more items. */
  softStop: number;
  /** Observation time of this unit (same on a retry). */
  observedAt: Date;
  /** Saves state mid-unit (write-ahead accounting); throws LostLeaseError when fenced out. */
  save(s: RunState): Promise<void>;
}

export interface UnitDef {
  /** Longest this unit should take; a tick starts it only if it fits the budget. */
  worstMs: number;
  run(ctx: UnitCtx): Promise<RunState>;
  /** What to do after the unit was interrupted 3 times (default: its step fails). */
  poison?(ctx: UnitCtx, unit: UnitName): Promise<RunState> | RunState;
}

const runNow = (s: RunState) => new Date(s.now);

// --- start: FX rates and housekeeping --------------------------------------------------------

const start: UnitDef = {
  worstMs: 20_000,
  async run({ db, deps, state, signal }) {
    // Rows left "running" by a killed process would show as running forever on /sources.
    await reapStaleIngestionRuns(db).catch(() => 0);
    await deleteOrphanStage(db).catch(() => undefined);
    let s = state;
    try {
      const rates = await deps.fetchFxRates(signal);
      s = setStep(s, "fx", {
        status: "done",
        detail: `${await saveFxRates(db, rates)} rates for ${rates.date}`,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      s = setStep(s, "fx", { status: "failed", error: errorMessage(err) });
    }
    return { ...s, cursor: "discover" };
  },
};

// --- Ad Library requests ---------------------------------------------------------------------

const BUCKET: Record<
  StageBucket,
  {
    step: "discover" | "advertisers";
    progress: "keyword" | "advertiser";
    plan: "keywordRequests" | "advertiserRequests";
    finalize: UnitName;
    mode: "keyword" | "advertiser";
  }
> = {
  keyword: {
    step: "discover",
    progress: "keyword",
    plan: "keywordRequests",
    finalize: "discover_finalize",
    mode: "keyword",
  },
  advertiser: {
    step: "advertisers",
    progress: "advertiser",
    plan: "advertiserRequests",
    finalize: "advertisers_finalize",
    mode: "advertiser",
  },
};

/**
 * One Ad Library page. The request is counted and the next allowed request time saved before
 * it is sent, so a killed process can never undercount (ADR-006 caps); a kill costs at most
 * this one request again. A block or failure ends the sweep (as before) and is staged so the
 * finalize step stores what arrived and records the failure. A block is recorded (back-off)
 * before anything else, and a retry of a request whose answer was already staged reuses it,
 * so Meta is never asked again after it refused us.
 */
async function adRequest(ctx: UnitCtx, bucket: StageBucket): Promise<RunState> {
  const { db, deps, clock, runId, signal } = ctx;
  const b = BUCKET[bucket];
  let s = ctx.state;
  const requests = s.plan[b.plan] ?? [];
  const idx = s.progress[b.progress];
  if (idx >= requests.length || s.adLibrary.requests >= MAX_AD_REQUESTS_PER_RUN) {
    return { ...s, cursor: b.finalize };
  }
  const req = requests[idx];

  const advance = (ads: number): RunState => {
    const next: RunState = {
      ...s,
      progress: { ...s.progress, [b.progress]: idx + 1 },
      results: { ...s.results, adsFetched: s.results.adsFetched + ads },
    };
    return setStep(next, b.step, { done: idx + 1 });
  };

  // The process died after this request's answer was staged: do not ask Meta again.
  const staged = await getStagedRequest(db, runId, bucket, idx);
  if (staged) {
    s = advance(staged.ads);
    if (staged.failure === null) {
      return idx + 1 >= requests.length ? { ...s, cursor: b.finalize } : s;
    }
    if (isAdLibraryStopMessage(staged.failure) && !s.adLibrary.stopped) {
      s = {
        ...s,
        adLibrary: {
          ...s.adLibrary,
          stopped: { at: new Date(clock.now()).toISOString(), reason: staged.failure },
        },
      };
    }
    const backoff = await getBackoff(db, AD_LIBRARY_PROVIDER, deps.egress);
    if (backoff && backoff.until.getTime() > clock.now() && !s.adLibrary.blocked) {
      s = {
        ...s,
        adLibrary: {
          ...s.adLibrary,
          blocked: { at: backoff.updatedAt.toISOString(), reason: staged.failure },
        },
      };
    }
    return { ...s, cursor: b.finalize };
  }

  // This egress may be backing off although the sweep was planned elsewhere (e.g. the CLI
  // attached to a web run) or after planning: never send then.
  const backoff = await getBackoff(db, AD_LIBRARY_PROVIDER, deps.egress);
  if (backoff && backoff.until.getTime() > clock.now()) {
    const until = backoff.until.toISOString();
    return {
      ...setStep(
        s,
        b.step,
        idx === 0
          ? { status: "skipped", skipReason: "backoff", detail: `back-off until ${until}` }
          : { status: "failed", error: `Meta back-off for this machine until ${until}` },
      ),
      cursor: b.finalize,
    };
  }

  const t = clock.now();
  const startAt = Math.max(t, Math.min(s.rate.adLibraryNextAt ?? 0, t + AD_LIBRARY_INTERVAL_MS));
  s = {
    ...s,
    adLibrary: { ...s.adLibrary, requests: s.adLibrary.requests + 1 },
    rate: { ...s.rate, adLibraryNextAt: startAt + AD_LIBRARY_INTERVAL_MS },
  };
  await ctx.save(s);
  if (startAt > t) await clock.sleep(startAt - t, signal);

  const adapter = deps.adLibrary!({ mode: b.mode, countries: [req.country] });
  const { items, failure } = await fetchDiscoveryItems(adapter, [req.query], signal);
  const failureText = failure === undefined ? null : errorMessage(failure);
  const blockedAt =
    failure !== undefined && isAdLibraryBlock(failure) ? new Date(clock.now()) : null;
  // Back off first: even if staging fails, no later request may go to Meta during the back-off.
  if (blockedAt) await recordBlock(db, AD_LIBRARY_PROVIDER, deps.egress, failureText!, blockedAt);
  await upsertStage(db, runId, bucket, idx, items, failureText);

  s = advance(items.filter((i) => i.kind === "ad").length);
  if (failure !== undefined) {
    if (blockedAt) {
      s = {
        ...s,
        adLibrary: {
          ...s.adLibrary,
          blocked: { at: blockedAt.toISOString(), reason: failureText! },
        },
      };
    } else if (isAdLibraryStop(failure)) {
      s = {
        ...s,
        adLibrary: {
          ...s.adLibrary,
          stopped: { at: new Date(clock.now()).toISOString(), reason: failureText! },
        },
      };
    }
    return { ...s, cursor: b.finalize };
  }
  // Meta answered: earlier blocks of this egress are over.
  if (idx === 0) await clearBackoff(db, AD_LIBRARY_PROVIDER, deps.egress);
  return idx + 1 >= requests.length ? { ...s, cursor: b.finalize } : s;
}

/** An Ad Library request interrupted 3 times: end the sweep there (never hammer Meta). */
function poisonAdRequest(bucket: StageBucket) {
  return ({ state: s }: UnitCtx, unit: UnitName): RunState => {
    const b = BUCKET[bucket];
    if (s.plan[b.plan] === null) return failUnit(s, unit, new Error("Interrupted 3 times"));
    return {
      ...setStep(s, b.step, {
        status: "failed",
        error: `Request ${s.progress[b.progress] + 1} was interrupted 3 times; sweep ended`,
      }),
      cursor: b.finalize,
    };
  };
}

const discover: UnitDef = {
  worstMs: 45_000,
  poison: poisonAdRequest("keyword"),
  async run(ctx) {
    const { db, deps, clock, runId, options } = ctx;
    let s = ctx.state;
    if (s.plan.keywordRequests !== null) return adRequest(ctx, "keyword");

    // Plan the sweep once: allowance (back-off, daily cap), keywords and requests.
    if (!deps.adLibrary) {
      s = { ...s, plan: { ...s.plan, keywordRequests: [] } };
      return {
        ...setStep(s, "discover", { status: "skipped", skipReason: "not_configured" }),
        cursor: "advertisers",
      };
    }
    // Sweeps are counted by the UTC day runs were created on (database clock): use that day.
    const a = await adLibraryAllowance(db, {
      egress: deps.egress,
      now: new Date(clock.now()),
      day: ctx.runCreatedAt,
      excludeRunId: runId,
    });
    const allowance = {
      allowed: a.allowed,
      reason: a.reason,
      until: a.until,
      sweep: a.sweep,
      sweepsBefore: a.sweepsBefore,
    };
    s = { ...s, plan: { ...s.plan, adLibrary: allowance } };
    if (!allowance.allowed) {
      s = { ...s, plan: { ...s.plan, keywordRequests: [] } };
      return {
        ...setStep(s, "discover", { status: "skipped", skipReason: allowance.reason! }),
        cursor: "advertisers",
      };
    }
    const wanted =
      options.keywords ??
      keywordsForDay(runNow(s), options.keywordCount, DISCOVERY_KEYWORDS, {
        slot: allowance.sweepsBefore,
        slotsPerDay: DAILY_SWEEP_CAP,
      });
    const requests = wanted
      .flatMap((query) => options.countries.map((country) => ({ query, country })))
      .slice(0, MAX_KEYWORD_REQUESTS);
    // Only the keywords the request cap leaves room for are this run's keywords.
    const keywords = [...new Set(requests.map((r) => r.query))];
    s = { ...s, plan: { ...s.plan, keywords, keywordRequests: requests } };
    return setStep(s, "discover", { status: "running", done: 0, total: requests.length });
  },
};

const advertisers: UnitDef = {
  worstMs: 45_000,
  poison: poisonAdRequest("advertiser"),
  async run(ctx) {
    const { db, deps, options } = ctx;
    let s = ctx.state;
    if (s.plan.advertiserRequests !== null) return adRequest(ctx, "advertiser");

    const skip = (patch: Parameters<typeof setStep<"advertisers">>[2]): RunState => ({
      ...setStep({ ...s, plan: { ...s.plan, advertiserRequests: [] } }, "advertisers", patch),
      cursor: "cj",
    });
    if (!deps.adLibrary || options.advertisers === 0) {
      return skip({ status: "skipped", skipReason: "not_configured" });
    }
    if (s.adLibrary.blocked) return skip({ status: "skipped", skipReason: "blocked" });
    if (s.adLibrary.stopped) return skip({ status: "skipped", skipReason: "meta_unusable" });
    if (!s.plan.adLibrary?.allowed) {
      return skip({ status: "skipped", skipReason: s.plan.adLibrary?.reason ?? "not_configured" });
    }
    const budget = Math.min(
      options.advertisers,
      MAX_ADVERTISER_REQUESTS,
      MAX_AD_REQUESTS_PER_RUN - s.adLibrary.requests,
    );
    if (budget <= 0)
      return skip({ status: "done", detail: "no Ad Library requests left in this run" });
    const followed = await pickAdvertisers(db, budget, {
      day: runNow(s),
      slot: s.plan.adLibrary.sweepsBefore,
      slotsPerDay: DAILY_SWEEP_CAP,
    });
    if (followed.length === 0) {
      return skip({ status: "done", detail: "no advertisers with store product pages yet" });
    }
    const requests = advertiserTargets(followed).map((query) => ({
      query,
      country: query.split("@")[1] ?? "US",
    }));
    s = { ...s, plan: { ...s.plan, advertiserRequests: requests } };
    return setStep(s, "advertisers", { status: "running", done: 0, total: requests.length });
  },
};

/**
 * Groups everything the sweep staged (across all its requests) and stores it. When the run was
 * wrapped up early (stall, tick limit), the next step is already skipped: go to the wrap-up.
 */
function finalize(bucket: StageBucket, nextUnit: UnitName): UnitDef {
  const b = BUCKET[bucket];
  const nextStep = STEP_OF_UNIT[nextUnit]!;
  return {
    worstMs: 30_000,
    async run(ctx) {
      const { db, runId } = ctx;
      let s = ctx.state;
      const next = s.steps[nextStep].status === "skipped" ? WRAP_UP_FROM : nextUnit;
      const made = s.progress[b.progress];
      if (made === 0) {
        if (s.steps[b.step].status === "running") {
          s = setStep(s, b.step, { status: "done", detail: "no requests made" });
        }
        return { ...s, cursor: next };
      }
      // Opened once and saved with the marker, so a retry writes into the same row.
      let ingestionRunId = s.unit?.ingestionRunId;
      if (ingestionRunId === undefined) {
        ingestionRunId = await startIngestionRun(db, AD_LIBRARY_META, runNow(s), runId);
        s = { ...s, unit: { ...s.unit!, ingestionRunId } };
        await ctx.save(s);
      }
      const stage = await loadStage(db, runId, bucket);
      const queries = [...new Set((s.plan[b.plan] ?? []).slice(0, made).map((r) => r.query))];
      const r = await storeDiscovery(
        db,
        AD_LIBRARY_META,
        queries,
        stage.items,
        stage.failure === null ? undefined : new Error(stage.failure),
        runNow(s),
        { pipelineRunId: runId, ingestionRunId },
      );
      const summary = `${r.adsFetched} ads → ${r.groups} products (${r.productsCreated} new)`;
      const detail = bucket === "advertiser" ? `${made} advertisers: ${summary}` : summary;
      s = {
        ...s,
        results: { ...s.results, newProducts: s.results.newProducts + r.productsCreated },
      };
      // A request skipped after repeated interruptions already failed the step.
      const prev = s.steps[b.step];
      s =
        r.ingestion.status === "failed"
          ? setStep(s, b.step, { status: "failed", detail, error: r.ingestion.error })
          : setStep(s, b.step, { status: prev.status === "failed" ? "failed" : "done", detail });
      return { ...s, cursor: next };
    },
  };
}

// --- Collect (Shopify search) and advertiser stores (Shopify lookup) ---------------------------

interface CollectKind {
  step: "collect" | "stores";
  progress: "collect" | "stores";
  meta: AdapterMeta;
  batch: number;
  next: UnitName;
  empty: string;
  pick(db: AnyDatabase, s: RunState, options: RunOptions): Promise<ProductQuery[]>;
  adapter(
    deps: RunnerDeps,
    options: RunOptions,
    wait: (signal?: AbortSignal) => Promise<void>,
  ): SourceAdapter | null;
  detail(items: number, products: number): string;
}

const COLLECT: CollectKind = {
  step: "collect",
  progress: "collect",
  meta: { source: "shopify", provider: PROVIDER_OF.shopify_catalog },
  batch: COLLECT_BATCH,
  next: "stores",
  empty: "nothing to collect",
  pick: (db, s, o) =>
    pickProducts(db, o.collect, { provider: PROVIDER_OF.shopify_catalog, now: runNow(s) }),
  adapter: (deps, o, wait) => deps.shopifyCatalog?.({ countries: o.countries, wait }) ?? null,
  detail: (items, n) => `${items} items for ${n} products`,
};

const STORES: CollectKind = {
  step: "stores",
  progress: "stores",
  meta: { source: "shopify", provider: PROVIDER_OF.advertiser_stores },
  batch: STORES_BATCH,
  next: "hash",
  empty: "nothing to look up",
  pick: (db, s, o) => pickLandingPages(db, o.collect, { now: runNow(s) }),
  adapter: (deps, _o, wait) => deps.storeLookup?.({ country: "US", wait }) ?? null,
  detail: (items, n) => `${items} store listings for ${n} products`,
};

/**
 * Shopify refused us (unauthorized, forbidden, rate limited), not a product's own problem: stop
 * the step (ADR-006). So do this many failed products in a row (a source that keeps failing).
 */
const SHOPIFY_BLOCK = /^HTTP (401|403|429) /;
export const MAX_FAILED_IN_A_ROW = 3;

function collectUnit(kind: CollectKind): UnitDef {
  const planKey = kind.step;
  return {
    worstMs: 60_000,
    async run(ctx) {
      const { db, deps, clock, runId, options, signal, observedAt } = ctx;
      let s = ctx.state;
      const targets = s.plan[planKey];
      if (targets === null) {
        const probe = kind.adapter(deps, options, async () => {});
        if (!probe || options.collect === 0) {
          s = { ...s, plan: { ...s.plan, [planKey]: [] } };
          return {
            ...setStep(s, kind.step, { status: "skipped", skipReason: "not_configured" }),
            cursor: kind.next,
          };
        }
        const picked = await kind.pick(db, s, options);
        if (picked.length === 0) {
          s = { ...s, plan: { ...s.plan, [planKey]: picked } };
          return {
            ...setStep(s, kind.step, { status: "done", detail: kind.empty }),
            cursor: kind.next,
          };
        }
        // Opened once and saved with the marker (the plan is not saved yet, so a retry has the
        // same unit key and finds it): a crash here never leaves a second "running" row.
        let ingestionRunId = s.unit?.ingestionRunId;
        if (ingestionRunId === undefined) {
          ingestionRunId = await startIngestionRun(db, kind.meta, observedAt, runId);
          s = { ...s, unit: { ...s.unit!, ingestionRunId } };
          await ctx.save(s);
        }
        s = { ...s, plan: { ...s.plan, [planKey]: picked } };
        return setStep(s, kind.step, {
          status: "running",
          ingestionRunId,
          done: 0,
          total: picked.length,
        });
      }

      const st: CollectStepState = {
        ...s.steps[kind.step],
        errors: [...s.steps[kind.step].errors],
      };
      const limiter = createRateLimiter(
        SHOPIFY_INTERVAL_MS,
        () => clock.now(),
        clock.sleep,
        s.rate.shopifyNextAt ?? 0,
      );
      let nextAt = s.rate.shopifyNextAt;
      const wait = async (sig?: AbortSignal) => {
        await limiter(sig);
        nextAt = clock.now() + SHOPIFY_INTERVAL_MS;
      };
      const adapter = kind.adapter(deps, options, wait)!;
      // A retried unit (it was interrupted) does one product at a time, so a product that
      // keeps killing the process is the one skipped after 3 attempts.
      const batch = (s.unit?.attempts ?? 1) > 1 ? 1 : kind.batch;
      let idx = s.progress[kind.progress];
      let blocked = false;
      for (let n = 0; idx < targets.length && n < batch; n++) {
        if (n > 0 && clock.now() > ctx.softStop) break;
        const p = targets[idx];
        try {
          const r = await collectForTargets(db, adapter, [p], {
            ingestionRunId: st.ingestionRunId,
            signal,
            now: observedAt,
          });
          st.items += r.itemsFetched;
          if (r.status === "failed") {
            st.failedProducts++;
            st.failedInRow = (st.failedInRow ?? 0) + 1;
            if (st.errors.length < 5) st.errors.push(r.error ?? "failed");
            blocked = SHOPIFY_BLOCK.test(r.error ?? "");
          } else {
            st.failedInRow = 0;
          }
        } catch (err) {
          if (signal.aborted) throw err;
          st.failedProducts++;
          st.failedInRow = (st.failedInRow ?? 0) + 1;
          if (st.errors.length < 5) st.errors.push(errorMessage(err));
        }
        idx++;
        if ((st.failedInRow ?? 0) >= MAX_FAILED_IN_A_ROW) blocked = true;
        if (blocked) break;
      }
      st.done = idx;
      s = {
        ...s,
        progress: { ...s.progress, [kind.progress]: idx },
        rate: { ...s.rate, shopifyNextAt: nextAt },
        steps: { ...s.steps, [kind.step]: st },
      };
      if (!blocked && idx < targets.length) return s;
      return finishCollect(ctx, kind, s, blocked);
    },
    async poison({ db, state: s, observedAt }, unit) {
      const targets = s.plan[planKey];
      if (targets === null) return failUnit(s, unit, new Error("Interrupted 3 times"));
      const idx = s.progress[kind.progress];
      const st = s.steps[kind.step];
      const error = "Interrupted 3 times; skipped";
      if (targets[idx]) {
        await recordAttempts(
          db,
          kind.meta.provider,
          [{ productId: targets[idx].productId, outcome: "error", error }],
          observedAt,
        );
      }
      return {
        ...setStep(s, kind.step, {
          failedProducts: st.failedProducts + 1,
          errors: st.errors.length < 5 ? [...st.errors, error] : st.errors,
          done: idx + 1,
        }),
        progress: { ...s.progress, [kind.progress]: idx + 1 },
      };
    },
  };
}

async function finishCollect(
  ctx: UnitCtx,
  kind: CollectKind,
  s: RunState,
  blocked: boolean,
): Promise<RunState> {
  const st = s.steps[kind.step];
  const targets = s.plan[kind.step] ?? [];
  const attempted = s.progress[kind.progress];
  const failed = blocked || (attempted > 0 && st.failedProducts >= attempted);
  const error = st.failedProducts
    ? `${st.failedProducts} of ${attempted} products failed: ${st.errors[0] ?? ""}`
    : undefined;
  if (st.ingestionRunId !== undefined) {
    await finishIngestionRun(ctx.db, st.ingestionRunId, {
      status: failed ? "failed" : "succeeded",
      itemsFetched: st.items,
      error,
      finishedAt: new Date(ctx.clock.now()),
    });
  }
  // Products never reached because the source blocked us stay due (no attempt recorded).
  const detail = kind.detail(st.items, attempted < targets.length ? attempted : targets.length);
  return {
    ...setStep(
      s,
      kind.step,
      failed ? { status: "failed", detail, error } : { status: "done", detail, error },
    ),
    cursor: kind.next,
  };
}

// --- Dedupe, match, score, finish --------------------------------------------------------------

const hash: UnitDef = {
  worstMs: 60_000,
  async run({ db, deps, clock, state, signal, softStop, observedAt }) {
    // Always allow some downloads, even when the tick's budget is nearly used up.
    const remaining = Number.isFinite(softStop) ? Math.max(15_000, softStop - clock.now()) : null;
    const r = await hashProductImages(db, {
      limit: Math.min(HASH_BATCH, HASH_PER_RUN - state.progress.hashAttempted),
      retry: deps.imageRetry,
      until: remaining === null ? undefined : Date.now() + remaining,
      now: observedAt,
      signal,
    });
    const d = state.steps.dedupe;
    const attempted = state.progress.hashAttempted + r.hashed + r.failed + r.skipped;
    const s = setStep(
      { ...state, progress: { ...state.progress, hashAttempted: attempted } },
      "dedupe",
      { hashed: d.hashed + r.hashed, failed: d.failed + r.failed, skipped: d.skipped + r.skipped },
    );
    const more = r.more && attempted < HASH_PER_RUN && r.hashed + r.failed + r.skipped > 0;
    return more ? s : { ...s, cursor: "merge" };
  },
};

const merge: UnitDef = {
  worstMs: 30_000,
  async run({ db, state }) {
    const { merged } = await mergeDuplicateProducts(db);
    const d = state.steps.dedupe;
    const detail = `${d.hashed} images hashed (${d.failed} failed), ${merged} duplicates merged`;
    const s = setStep(state, "dedupe", {
      merged,
      detail,
      status: d.status === "failed" || d.status === "skipped" ? d.status : "done",
    });
    return { ...s, cursor: "match" };
  },
};

const match: UnitDef = {
  worstMs: 30_000,
  async run({ db, state }) {
    const r = await runMatching(db);
    const s = setStep(state, "match", {
      status: "done",
      detail: `${r.itemsMatched} matched, ${r.productsCreated} products created`,
    });
    return {
      ...s,
      results: { ...s.results, matchedProducts: s.results.matchedProducts + r.productsCreated },
      cursor: "score",
    };
  },
};

const score: UnitDef = {
  worstMs: 40_000,
  async run({ db, deps, state, observedAt }) {
    // One scoring batch per run: a retry finds the batch it already wrote.
    const scoreAt = deps.now ?? observedAt;
    const [existing] = await db
      .select({ n: count() })
      .from(productScores)
      .where(eq(productScores.computedAt, scoreAt));
    const productsScored =
      existing.n > 0 ? existing.n : (await runScoring(db, scoreAt)).productsScored;
    const s = setStep(state, "score", {
      status: "done",
      detail: `${productsScored} products scored`,
    });
    return { ...s, results: { ...s.results, productsScored }, cursor: "finish" };
  },
};

const finish: UnitDef = {
  worstMs: 10_000,
  async run({ db, runId, runCreatedAt, state }) {
    const [[ads], [created]] = await Promise.all([
      db
        .select({ n: count() })
        .from(sourceItems)
        .where(
          and(
            eq(sourceItems.provider, AD_LIBRARY_PROVIDER),
            eq(sourceItems.kind, "ad"),
            eq(sourceItems.firstSeenAt, runNow(state)),
          ),
        ),
      db
        .select({ n: count() })
        .from(products)
        .where(
          and(
            isNotNull(products.landingKey),
            isNull(products.mergedInto),
            gte(products.createdAt, runCreatedAt),
          ),
        ),
    ]);
    await closeOpenIngestionRuns(db, runId, "Interrupted: the pipeline run ended first");
    await deleteStage(db, runId);
    return {
      ...state,
      results: { ...state.results, newAds: ads.n, newProducts: created.n },
      cursor: "done",
    };
  },
  // Never leave a run open: finish anyway.
  poison: ({ state }) => ({ ...state, cursor: "done" }),
};

export const UNITS: Record<Exclude<UnitName, "done">, UnitDef> = {
  start,
  discover,
  discover_finalize: finalize("keyword", "advertisers"),
  advertisers,
  advertisers_finalize: finalize("advertiser", "cj"),
  ...CJ_UNITS,
  collect: collectUnit(COLLECT),
  stores: collectUnit(STORES),
  hash,
  merge,
  match,
  score,
  finish,
};
