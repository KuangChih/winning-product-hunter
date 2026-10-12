/**
 * Store-page redirect checks (ADR-018), after the store lookups: landing pages the Shopify
 * catalog did not know are followed to where the store redirects them (robots.txt honoured,
 * HEAD, honest User-Agent, ≥ 2 s apart, at most `REDIRECTS_PER_RUN` per run, 403 / 429 stops and
 * backs the egress off). Only the final URL is kept (`landing_redirects`), and when it is another
 * page (domain or handle) the catalog is asked again with it.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { collectionAttempts, landingRedirects, products, sourceItems } from "@/db/schema";
import { landingKey } from "@/discovery/landing";
import type { ProductQuery } from "@/ingestion/collect-for-products";
import { createRateLimiter } from "@/ingestion/http";
import {
  createRedirectResolver,
  STORE_PAGES_PROVIDER,
  type RedirectResult,
} from "@/ingestion/sources/store-redirect";
import { collectLookups, hostVariants, PROVIDER_OF } from "@/pipeline/targets";
import { getBackoff, recordBlock } from "./guards";
import { errorMessage } from "./state";
import type { CollectStepState } from "./types";
import type { UnitDef } from "./units";

/** ADR-006: a store's own pages at most every 2 seconds. */
export const REDIRECT_INTERVAL_MS = 2_000;
/** Landing pages checked per run (each: robots.txt once per store, then one HEAD). */
export const REDIRECTS_PER_RUN = 30;
/** A checked page is not checked again for this long. */
export const REDIRECT_FRESH_DAYS = 30;
/**
 * A store that refuses us (403 / 429) is not asked again in the run (its page is cached as
 * blocked for `REDIRECT_FRESH_DAYS`); this many refusing stores in one run look like a block of
 * our address: no more checks, and this egress backs off (ADR-006).
 */
export const MAX_BLOCKED_STORES = 3;
/** A unit stops starting checks after this long (each check ≤ 3 requests × 8 s). */
const REDIRECT_UNIT_MS = 25_000;
const SHOPIFY_INTERVAL_MS = 1_500;
const DAY = 86_400_000;

const pageKey = (url: string | null | undefined) => {
  const k = landingKey(url);
  return k ? `${k.host}|${k.key}` : null;
};

/**
 * Products the catalog did not find at their landing page (latest store lookup: empty) whose
 * page was not checked recently: one landing page each, at most `limit`.
 */
export async function pickRedirectTargets(
  db: AnyDatabase,
  now: Date,
  limit: number,
): Promise<ProductQuery[]> {
  const emptyLookups = await db
    .select({ productId: collectionAttempts.productId })
    .from(collectionAttempts)
    .innerJoin(products, eq(products.id, collectionAttempts.productId))
    .where(
      and(
        eq(collectionAttempts.provider, PROVIDER_OF.advertiser_stores),
        eq(collectionAttempts.outcome, "empty"),
        isNull(products.mergedInto),
      ),
    )
    .orderBy(desc(collectionAttempts.attemptedAt));
  if (emptyLookups.length === 0) return [];
  const ids = emptyLookups.map((r) => r.productId);
  const ads = await db
    .select({
      productId: sourceItems.productId,
      url: sql<string | null>`${sourceItems.raw}->>'landing_url'`,
    })
    .from(sourceItems)
    .where(and(eq(sourceItems.kind, "ad"), inArray(sourceItems.productId, ids)));
  const urlOf = new Map<string, string>();
  for (const a of ads) {
    const k = landingKey(a.url);
    // Shopify product pages only (the catalog knows nothing else; e.g. Amazon is skipped).
    if (k?.handle && !urlOf.has(a.productId!)) urlOf.set(a.productId!, k.url);
  }
  const urls = [...urlOf.values()];
  const recent = urls.length
    ? await db
        .select({ url: landingRedirects.url })
        .from(landingRedirects)
        .where(
          and(
            inArray(landingRedirects.url, urls),
            gte(landingRedirects.checkedAt, new Date(now.getTime() - REDIRECT_FRESH_DAYS * DAY)),
          ),
        )
    : [];
  const checked = new Set(recent.map((r) => r.url));
  return ids
    .flatMap((productId) => {
      const url = urlOf.get(productId);
      return url && !checked.has(url) ? [{ productId, query: url }] : [];
    })
    .slice(0, limit);
}

/** Final URLs (another page than the landing page) of these products' checked pages. */
async function changedPages(db: AnyDatabase, targets: ProductQuery[]): Promise<ProductQuery[]> {
  const urls = targets.map((t) => t.query as string);
  if (urls.length === 0) return [];
  const rows = await db
    .select()
    .from(landingRedirects)
    .where(and(inArray(landingRedirects.url, urls), eq(landingRedirects.outcome, "redirected")));
  const finalOf = new Map(rows.map((r) => [r.url, r.finalUrl]));
  return targets.flatMap((t) => {
    const final = finalOf.get(t.query as string);
    return final && pageKey(final) !== pageKey(t.query as string)
      ? [{ productId: t.productId, query: hostVariants(final) }]
      : [];
  });
}

const emptyCounts = () => ({
  checked: 0,
  requests: 0,
  changed: 0,
  found: 0,
  disallowed: 0,
  blocked: 0,
  blockedHosts: [] as string[],
});

export const storeRedirects: UnitDef = {
  worstMs: 60_000,
  async run(ctx) {
    const { db, deps, clock, signal, observedAt } = ctx;
    let s = ctx.state;
    const st: CollectStepState = { ...s.steps.stores };
    const counts = { ...emptyCounts(), ...st.redirects };
    const done = (state: typeof s, note?: string) => {
      const c = state.steps.stores.redirects ?? counts;
      const detail =
        `${state.steps.stores.detail ?? ""}; redirects: ${c.checked} pages checked ` +
        `(${c.requests} requests), ${c.changed} moved, ${c.found} found in the catalog` +
        (c.disallowed ? `, ${c.disallowed} disallowed by robots.txt` : "") +
        (c.blocked ? `, ${c.blocked} stores refused us (${note ?? "403/429"})` : "");
      return {
        ...state,
        steps: { ...state.steps, stores: { ...state.steps.stores, detail } },
        cursor: "hash" as const,
      };
    };

    let targets = s.plan.redirects;
    if (targets === null || targets === undefined) {
      if (!deps.storePageFetch || !deps.storeLookup) return { ...s, cursor: "hash" };
      const backoff = await getBackoff(db, STORE_PAGES_PROVIDER, deps.egress);
      if (backoff && backoff.until.getTime() > clock.now()) return { ...s, cursor: "hash" };
      targets = await pickRedirectTargets(db, new Date(s.now), REDIRECTS_PER_RUN);
      s = {
        ...s,
        plan: { ...s.plan, redirects: targets },
        progress: { ...s.progress, redirects: 0 },
      };
      if (targets.length === 0) return { ...s, cursor: "hash" };
      return s;
    }

    let idx = s.progress.redirects ?? 0;
    if (idx < targets.length) {
      const limiter = createRateLimiter(
        REDIRECT_INTERVAL_MS,
        () => clock.now(),
        clock.sleep,
        s.rate.storePagesNextAt ?? 0,
      );
      let nextAt = s.rate.storePagesNextAt ?? null;
      const resolve = createRedirectResolver({
        fetchImpl: deps.storePageFetch,
        timeoutMs: 8_000,
        wait: async (sig) => {
          await limiter(sig);
          nextAt = clock.now() + REDIRECT_INTERVAL_MS;
        },
        onRequest: () => counts.requests++,
      });
      const unitEnd = clock.now() + REDIRECT_UNIT_MS;
      let blocked: RedirectResult | null = null;
      const blockedHosts = new Set(counts.blockedHosts);
      for (let n = 0; idx < targets.length; n++) {
        if (n > 0 && (clock.now() > unitEnd || clock.now() > ctx.softStop)) break;
        const url = targets[idx].query as string;
        const host = new URL(url).hostname;
        idx++;
        // A store that refused us is not asked again in this run.
        if (blockedHosts.has(host)) continue;
        const r = await resolve(url, signal);
        counts.checked++;
        if (r.outcome === "disallowed") counts.disallowed++;
        if (r.outcome === "redirected" && pageKey(r.finalUrl) !== pageKey(url)) counts.changed++;
        if (r.outcome === "blocked") {
          counts.blocked++;
          blockedHosts.add(host);
          counts.blockedHosts = [...blockedHosts];
          if (blockedHosts.size >= MAX_BLOCKED_STORES) blocked = r;
        }
        await db
          .insert(landingRedirects)
          .values({
            url,
            outcome: r.outcome,
            finalUrl: r.finalUrl,
            status: r.status,
            checkedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: landingRedirects.url,
            set: {
              outcome: r.outcome,
              finalUrl: r.finalUrl,
              status: r.status,
              checkedAt: observedAt,
            },
          });
        if (blocked) break;
      }
      s = {
        ...s,
        progress: { ...s.progress, redirects: blocked ? targets.length : idx },
        rate: { ...s.rate, storePagesNextAt: nextAt },
        steps: { ...s.steps, stores: { ...s.steps.stores, redirects: { ...counts } } },
      };
      if (blocked) {
        await recordBlock(
          db,
          STORE_PAGES_PROVIDER,
          deps.egress,
          `HTTP ${blocked.status} from ${new URL(blocked.url).host}`,
          new Date(clock.now()),
        );
      } else if (idx < targets.length) {
        return s;
      }
    }

    // Ask the catalog again for the pages that moved (one request per 50 URLs).
    const moved = await changedPages(db, targets);
    if (moved.length > 0) {
      const limiter = createRateLimiter(
        SHOPIFY_INTERVAL_MS,
        () => clock.now(),
        clock.sleep,
        s.rate.shopifyNextAt ?? 0,
      );
      const adapter = deps.storeLookup!({ country: "US", wait: (sig) => limiter(sig) });
      try {
        for (let i = 0; i < moved.length; i += 25) {
          // 25 products × 2 URLs (with and without www.) = 50 URLs per request.
          await collectLookups(db, adapter, moved.slice(i, i + 25), {
            now: observedAt,
            signal,
            ingestionRunId: st.ingestionRunId,
          });
        }
        s = { ...s, rate: { ...s.rate, shopifyNextAt: clock.now() + SHOPIFY_INTERVAL_MS } };
      } catch (err) {
        if (signal.aborted) throw err;
        st.errors = [...st.errors, errorMessage(err)].slice(0, 5);
      }
      const foundRows = await db
        .select({ productId: collectionAttempts.productId })
        .from(collectionAttempts)
        .where(
          and(
            eq(collectionAttempts.provider, PROVIDER_OF.advertiser_stores),
            eq(collectionAttempts.outcome, "found"),
            inArray(
              collectionAttempts.productId,
              moved.map((m) => m.productId),
            ),
            gte(collectionAttempts.attemptedAt, observedAt),
          ),
        );
      counts.found = foundRows.length;
    }
    s = {
      ...s,
      steps: {
        ...s.steps,
        stores: { ...s.steps.stores, errors: st.errors, redirects: { ...counts } },
      },
    };
    return done(s, counts.blocked ? "403/429" : undefined);
  },
};
