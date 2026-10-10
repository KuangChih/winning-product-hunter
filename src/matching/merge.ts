import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { collectionAttempts, productScores, products, sourceItems, watchlist } from "@/db/schema";
import { fetchWithRetry, type RetryOptions } from "@/ingestion/http";
import { OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { recordAttempts, type AttemptRow } from "@/pipeline/targets";
import { dHash, hammingDistance } from "./image-hash";
import { jaccard, titleTokens } from "./normalize";

/** Thresholds for treating two products as the same item (tunable with a labeled set). */
export const MERGE_RULES = {
  /** Near-identical photo: same product even if titles differ (different store names). */
  identicalImage: 2,
  /** Similar photo: same product only if titles also overlap. */
  similarImage: 8,
  minTitleJaccard: 0.25,
};

export interface HashCandidate {
  id: string;
  title: string;
  imageHash: string;
  firstSeenAt: Date;
}

/**
 * Groups products that are the same item by photo (dHash) and title. Returns one group per
 * merged set; the first id in each group is the survivor (the earliest seen product).
 */
export function findDuplicateGroups(candidates: HashCandidate[]): string[][] {
  const parent = new Map(candidates.map((c) => [c.id, c.id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const tokens = new Map(candidates.map((c) => [c.id, titleTokens(c.title)]));

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const distance = hammingDistance(a.imageHash, b.imageHash);
      const same =
        distance <= MERGE_RULES.identicalImage ||
        (distance <= MERGE_RULES.similarImage &&
          jaccard(tokens.get(a.id)!, tokens.get(b.id)!) >= MERGE_RULES.minTitleJaccard);
      if (same) parent.set(find(a.id), find(b.id));
    }
  }

  const groups = new Map<string, HashCandidate[]>();
  for (const c of candidates) {
    const root = find(c.id);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) =>
      g
        .sort(
          (x, y) => x.firstSeenAt.getTime() - y.firstSeenAt.getTime() || x.id.localeCompare(y.id),
        )
        .map((c) => c.id),
    );
}

/** Image downloads larger than this are rejected (product photos are far smaller). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Attempt-log provider for photo downloads (see `recordAttempts`). */
export const IMAGE_HASH_PROVIDER = "image_hash";

/**
 * Only public https URLs are downloaded: no other schemes, no localhost or private-network
 * literals (the URLs come from third-party pages).
 */
export function isAllowedImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(127|10|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.includes(":") && /^(::1?$|f[cd]|fe80:|::ffff:)/.test(host)) return false;
  return true;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`Image too large (${declared} bytes)`);
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Image too large (over ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const MAX_IMAGE_REDIRECTS = 3;

/** Downloads an image, checking every redirect hop with `isAllowedImageUrl`. */
async function fetchImage(url: string, init: RequestInit, opts: RetryOptions): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await fetchWithRetry(current, { ...init, redirect: "manual" }, opts);
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!location) throw new Error(`Redirect without Location from ${current}`);
    if (hop >= MAX_IMAGE_REDIRECTS) throw new Error(`Too many redirects from ${url}`);
    const next = new URL(location, current).toString();
    if (!isAllowedImageUrl(next)) throw new Error(`Redirect to a disallowed URL: ${next}`);
    current = next;
  }
}

/**
 * The photo that shows this product: its own image, else the advertiser's own store listing,
 * else one of its ads. Never a Shopify search result: those are similar products from other
 * stores, and a wrong photo both misleads on the product card and merges unrelated products.
 */
export function productImageUrl(
  own: string | null,
  items: Array<{ provider: string; kind: string; imageUrl: string | null }>,
): string | null {
  return (
    own ??
    items.find((i) => i.provider === OWN_LISTING_PROVIDER && i.imageUrl)?.imageUrl ??
    items.find((i) => i.kind === "ad" && i.imageUrl)?.imageUrl ??
    null
  );
}

export interface HashImagesOptions {
  limit?: number;
  retry?: RetryOptions;
  /** Stop starting new downloads after this time (epoch ms); `more` is then true. */
  until?: number;
  now?: Date;
  /** A product whose photo failed is tried again after this many days. */
  retryAfterDays?: number;
  /** Per-download timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Computes dHash for active products that have none yet (see `productImageUrl` for which
 * photo). Every attempt is logged, so photos that fail to download are retried only after
 * `retryAfterDays` and never hold back products not tried yet. Sample products are skipped.
 */
export async function hashProductImages(
  db: AnyDatabase,
  {
    limit = 100,
    retry,
    until,
    now = new Date(),
    retryAfterDays = 1,
    timeoutMs = 15_000,
    signal,
  }: HashImagesOptions = {},
): Promise<{ hashed: number; failed: number; skipped: number; more: boolean }> {
  const retryBefore = new Date(now.getTime() - retryAfterDays * 86_400_000);
  const sample = db
    .selectDistinct({ productId: sourceItems.productId })
    .from(sourceItems)
    .where(and(eq(sourceItems.provider, "fixture"), isNotNull(sourceItems.productId)));
  const pending = await db
    .select({
      id: products.id,
      imageUrl: products.imageUrl,
      prev: {
        attemptedAt: collectionAttempts.attemptedAt,
        outcome: collectionAttempts.outcome,
        error: collectionAttempts.error,
      },
    })
    .from(products)
    .leftJoin(
      collectionAttempts,
      and(
        eq(collectionAttempts.productId, products.id),
        eq(collectionAttempts.provider, IMAGE_HASH_PROVIDER),
      ),
    )
    .where(
      and(
        isNull(products.imageHash),
        isNull(products.mergedInto),
        notInArray(products.id, sample),
        or(isNull(collectionAttempts.attemptedAt), lt(collectionAttempts.attemptedAt, retryBefore)),
      ),
    )
    .orderBy(sql`${collectionAttempts.attemptedAt} asc nulls first`, products.id)
    .limit(limit);
  if (pending.length === 0) return { hashed: 0, failed: 0, skipped: 0, more: false };

  const listings = await db
    .select({
      productId: sourceItems.productId,
      imageUrl: sourceItems.imageUrl,
      provider: sourceItems.provider,
      kind: sourceItems.kind,
    })
    .from(sourceItems)
    .where(
      and(
        inArray(
          sourceItems.productId,
          pending.map((p) => p.id),
        ),
        isNotNull(sourceItems.imageUrl),
      ),
    );
  const listingsOf = new Map<string, typeof listings>();
  for (const l of listings) {
    listingsOf.set(l.productId!, [...(listingsOf.get(l.productId!) ?? []), l]);
  }

  // Marked first, so photos that hang a killed process are not the first ones retried.
  await recordAttempts(
    db,
    IMAGE_HASH_PROVIDER,
    pending.map((p) => ({ productId: p.id, outcome: "error", error: "Interrupted" })),
    now,
  );

  let hashed = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;
  const outcomes: AttemptRow[] = [];
  // The download a caller abort cut short keeps its "Interrupted" mark.
  let inFlight: string | undefined;
  try {
    for (const p of pending) {
      signal?.throwIfAborted();
      if (until !== undefined && Date.now() > until) {
        stopped = true;
        break;
      }
      const url = productImageUrl(p.imageUrl, listingsOf.get(p.id) ?? []);
      if (!url || !isAllowedImageUrl(url)) {
        skipped++;
        outcomes.push({ productId: p.id, outcome: "empty" });
        continue;
      }
      inFlight = p.id;
      try {
        const res = await fetchImage(url, { signal }, { retries: 1, timeoutMs, ...retry });
        const hash = await dHash(await readCapped(res, MAX_IMAGE_BYTES));
        await db
          .update(products)
          .set({ imageHash: hash, imageUrl: p.imageUrl ?? url })
          .where(eq(products.id, p.id));
        hashed++;
        outcomes.push({ productId: p.id, outcome: "found" });
      } catch (err) {
        // The caller's time budget ran out: not this photo's fault.
        if (signal?.aborted) throw err;
        failed++;
        outcomes.push({
          productId: p.id,
          outcome: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      inFlight = undefined;
    }
  } finally {
    // Also on abort: keep what was learned, and give back products this call never reached.
    await recordAttempts(db, IMAGE_HASH_PROVIDER, outcomes, now);
    const reached = new Set(outcomes.map((o) => o.productId));
    if (inFlight) reached.add(inFlight);
    for (const p of pending.filter((x) => !reached.has(x.id))) {
      const where = and(
        eq(collectionAttempts.provider, IMAGE_HASH_PROVIDER),
        eq(collectionAttempts.productId, p.id),
      );
      if (p.prev?.attemptedAt) await db.update(collectionAttempts).set(p.prev).where(where);
      else await db.delete(collectionAttempts).where(where);
    }
  }
  return { hashed, failed, skipped, more: stopped || pending.length === limit };
}

/**
 * Merges duplicate products: evidence moves to the survivor, the duplicates' scores are dropped
 * (they are recomputed for the survivor) and duplicates are marked `merged_into`.
 */
export async function mergeDuplicateProducts(db: AnyDatabase): Promise<{ merged: number }> {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      imageHash: products.imageHash,
      firstSeenAt: products.firstSeenAt,
    })
    .from(products)
    .where(isNull(products.mergedInto));
  const groups = findDuplicateGroups(
    rows.flatMap((r) => (r.imageHash ? [{ ...r, imageHash: r.imageHash }] : [])),
  );

  let merged = 0;
  for (const [survivor, ...duplicates] of groups) {
    await db
      .update(sourceItems)
      .set({ productId: survivor })
      .where(inArray(sourceItems.productId, duplicates));
    await db.delete(productScores).where(inArray(productScores.productId, duplicates));
    // Keep following a merged product: the earliest watch moves to the survivor.
    const [watched] = await db
      .select()
      .from(watchlist)
      .where(inArray(watchlist.productId, duplicates))
      .orderBy(watchlist.addedAt)
      .limit(1);
    if (watched) {
      await db
        .insert(watchlist)
        .values({ ...watched, productId: survivor })
        .onConflictDoNothing();
      await db.delete(watchlist).where(inArray(watchlist.productId, duplicates));
    }
    await db.update(products).set({ mergedInto: survivor }).where(inArray(products.id, duplicates));
    merged += duplicates.length;
  }
  return { merged };
}
