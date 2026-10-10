// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionAttempts, productScores, products, sourceItems, watchlist } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { runDiscovery } from "@/discovery/discover";
import { runIngestion } from "@/ingestion/run";
import type { FetchedItem, SourceAdapter } from "@/ingestion/types";
import { runScoring } from "@/scoring/run";
import {
  findDuplicateGroups,
  hashProductImages,
  isAllowedImageUrl,
  mergeDuplicateProducts,
} from "./merge";

const NOW = new Date("2026-10-10T00:00:00Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("findDuplicateGroups", () => {
  const c = (id: string, title: string, imageHash: string, daysAgo: number) => ({
    id,
    title,
    imageHash,
    firstSeenAt: day(daysAgo),
  });

  it("merges identical photos regardless of title, keeping the earliest product", () => {
    const groups = findDuplicateGroups([
      c("new", "Smart Webbing Brace", "ffff0000ffff0000", 1),
      c("old", "Instant Posture Corrector", "ffff0000ffff0001", 30),
      c("other", "Neck Massager", "0f0f0f0f0f0f0f0f", 5),
    ]);
    expect(groups).toEqual([["old", "new"]]);
  });

  it("requires title overlap when photos are only similar", () => {
    const similar = "ffff0000ffff003f"; // 6 bits from the base hash
    expect(
      findDuplicateGroups([
        c("a", "Posture Corrector Brace", "ffff0000ffff0000", 2),
        c("b", "Back Posture Corrector", similar, 1),
      ]),
    ).toEqual([["a", "b"]]);
    expect(
      findDuplicateGroups([
        c("a", "Posture Corrector Brace", "ffff0000ffff0000", 2),
        c("b", "Dog Water Bowl", similar, 1),
      ]),
    ).toEqual([]);
  });
});

describe("hashProductImages + mergeDuplicateProducts", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function photo(color: string, size: number) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="#ddd"/><circle cx="${size * 0.3}" cy="${size * 0.4}" r="${size * 0.2}" fill="${color}"/></svg>`;
    return sharp(Buffer.from(svg)).jpeg().toBuffer();
  }

  it("hashes product photos, merges the duplicate and keeps its handle resolving to the survivor", async () => {
    const same = await photo("#333", 300);
    const sameResized = await photo("#333", 800);
    const different = await photo("#333", 300).then(() =>
      sharp({ create: { width: 300, height: 300, channels: 3, background: "#123456" } })
        .composite([
          {
            input: Buffer.from(
              '<svg width="300" height="300"><rect x="200" y="10" width="90" height="280" fill="#fff"/></svg>',
            ),
          },
        ])
        .jpeg()
        .toBuffer(),
    );
    const images: Record<string, Buffer> = {
      "https://cdn.test/a.jpg": same,
      "https://cdn.test/b.jpg": sameResized,
      "https://cdn.test/c.jpg": different,
    };
    const fetchImpl = vi.fn<typeof fetch>(
      async (url) => new Response(new Uint8Array(images[String(url)])),
    );

    const [a, b, c] = await t.db
      .insert(products)
      .values([
        {
          slug: "a",
          title: "Instant Posture Corrector",
          landingKey: "handle:instant-posture-corrector",
          imageUrl: "https://cdn.test/a.jpg",
          firstSeenAt: day(30),
        },
        {
          slug: "b",
          title: "Smart Webbing Brace",
          landingKey: "handle:smart-webbing-brace",
          imageUrl: "https://cdn.test/b.jpg",
          firstSeenAt: day(2),
        },
        {
          slug: "c",
          title: "Neck Massager",
          landingKey: "handle:neck-massager",
          imageUrl: "https://cdn.test/c.jpg",
          firstSeenAt: day(5),
        },
      ])
      .returning();
    const ad = (id: string, productId: string): FetchedItem => ({
      externalId: id,
      kind: "ad",
      productId,
      countries: ["US"],
      startedAt: day(10),
      metrics: [],
      raw: {},
    });
    await runIngestion(
      t.db,
      {
        source: "meta_ads",
        provider: "ad_library_web",
        async *fetch() {
          yield ad("1", a.id);
          yield ad("2", b.id);
          yield ad("3", c.id);
        },
      },
      { queries: [], limit: 10 },
    );
    await runScoring(t.db, NOW);

    expect(await hashProductImages(t.db, { retry: { fetchImpl } })).toMatchObject({
      hashed: 3,
      failed: 0,
    });
    await t.db.insert(watchlist).values({ productId: b.id, scoreAtAdd: 42 });
    expect(await mergeDuplicateProducts(t.db)).toEqual({ merged: 1 });

    // b's ad moved to a; b is marked merged and its scores are gone.
    const [adB] = await t.db.select().from(sourceItems).where(eq(sourceItems.externalId, "2"));
    expect(adB.productId).toBe(a.id);
    const [merged] = await t.db.select().from(products).where(eq(products.id, b.id));
    expect(merged.mergedInto).toBe(a.id);
    expect(
      await t.db.select().from(productScores).where(eq(productScores.productId, b.id)),
    ).toEqual([]);
    expect(await t.db.select().from(products).where(isNull(products.mergedInto))).toHaveLength(2);
    // Watching b now means watching a.
    expect(await t.db.select().from(watchlist)).toEqual([
      expect.objectContaining({ productId: a.id, scoreAtAdd: 42 }),
    ]);

    // Discovering b's handle again attaches to the survivor instead of recreating b.
    const adapter: SourceAdapter = {
      source: "meta_ads",
      provider: "ad_library_web",
      async *fetch() {
        for (const id of ["9", "10"]) {
          yield {
            ...ad(id, ""),
            productId: undefined,
            raw: { landing_url: "https://x.com/products/smart-webbing-brace" },
          };
        }
      },
    };
    const result = await runDiscovery(t.db, adapter, ["brace"], NOW);
    expect(result).toMatchObject({ productsCreated: 0, productsUpdated: 1 });
    const [ad9] = await t.db.select().from(sourceItems).where(eq(sourceItems.externalId, "9"));
    expect(ad9.productId).toBe(a.id);
  });
});

describe("hashProductImages attempts and photo choice", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const jpeg = () =>
    sharp({ create: { width: 20, height: 20, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
  async function product(title: string, imageUrl: string | null = null) {
    const [p] = await t.db
      .insert(products)
      .values({ slug: `s-${n++}`, title, imageUrl, firstSeenAt: NOW })
      .returning();
    return p.id;
  }
  async function listing(productId: string, provider: string, imageUrl: string) {
    await t.db.insert(sourceItems).values({
      source: "shopify",
      provider,
      externalId: `l-${n++}`,
      kind: "store_product",
      productId,
      imageUrl,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
  }

  it("uses the advertiser's own listing photo, never a similar product's", async () => {
    const own = await product("Own listing");
    const similarOnly = await product("Similar only");
    await listing(own, "shopify_catalog", "https://cdn.test/similar-1.jpg");
    await listing(own, "shopify_catalog_lookup", "https://cdn.test/own.jpg");
    await listing(similarOnly, "shopify_catalog", "https://cdn.test/similar-2.jpg");
    const body = await jpeg();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(body)));

    const r = await hashProductImages(t.db, { retry: { fetchImpl }, now: NOW });
    expect(r).toEqual({ hashed: 1, failed: 0, skipped: 1, more: false });
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual(["https://cdn.test/own.jpg"]);
    const [p] = await t.db.select().from(products).where(eq(products.id, own));
    expect(p.imageUrl).toBe("https://cdn.test/own.jpg");
    const [s] = await t.db.select().from(products).where(eq(products.id, similarOnly));
    expect(s.imageUrl).toBeNull();
  });

  it("does not retry a failed photo before new products, nor within a day", async () => {
    const broken = await product("Broken", "https://cdn.test/broken.jpg");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 404 }));
    expect(await hashProductImages(t.db, { retry: { fetchImpl }, now: NOW })).toMatchObject({
      failed: 1,
    });

    const fresh = await product("Fresh", "https://cdn.test/fresh.jpg");
    const later = new Date(NOW.getTime() + 3_600_000);
    const ok = await jpeg();
    const okFetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(ok)));
    expect(
      await hashProductImages(t.db, { retry: { fetchImpl: okFetch }, now: later, limit: 1 }),
    ).toMatchObject({ hashed: 1 });
    expect(okFetch.mock.calls.map((c) => String(c[0]))).toEqual(["https://cdn.test/fresh.jpg"]);
    // Still within a day: the broken photo is not tried again.
    expect(await hashProductImages(t.db, { retry: { fetchImpl: okFetch }, now: later })).toEqual({
      hashed: 0,
      failed: 0,
      skipped: 0,
      more: false,
    });
    const nextDay = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(
      await hashProductImages(t.db, { retry: { fetchImpl: okFetch }, now: nextDay }),
    ).toMatchObject({ hashed: 1 });
    const [b] = await t.db.select().from(products).where(eq(products.id, broken));
    expect(b.imageHash).not.toBeNull();
    expect(fresh).toBeTruthy();
  });

  it("skips sample products and unsafe URLs, and stops at the deadline", async () => {
    const sample = await product("Sample", "https://cdn.test/sample.jpg");
    await listing(sample, "fixture", "https://cdn.test/sample.jpg");
    await product("Local", "http://127.0.0.1/x.jpg");
    await product("Waiting", "https://cdn.test/waiting.jpg");
    const fetchImpl = vi.fn<typeof fetch>();

    expect(
      await hashProductImages(t.db, { retry: { fetchImpl }, now: NOW, until: Date.now() - 1 }),
    ).toEqual({ hashed: 0, failed: 0, skipped: 0, more: true });
    // Not reached: not marked as tried.
    expect(await t.db.select().from(collectionAttempts)).toEqual([]);

    const r = await hashProductImages(t.db, {
      retry: { fetchImpl: async () => new Response("", { status: 500 }) },
      now: NOW,
    });
    expect(r).toMatchObject({ skipped: 1, failed: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("on abort keeps finished outcomes and gives back products it never reached", async () => {
    const ids = new Map<string, string>();
    for (const i of [1, 2, 3]) {
      ids.set(`https://cdn.test/${i}.jpg`, await product(`P${i}`, `https://cdn.test/${i}.jpg`));
    }
    const body = await jpeg();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      // The second download is cut short by the caller's time budget.
      if (fetchImpl.mock.calls.length === 2) {
        controller.abort(new Error("time budget"));
        throw controller.signal.reason;
      }
      return new Response(new Uint8Array(body));
    });

    await expect(
      hashProductImages(t.db, { retry: { fetchImpl }, now: NOW, signal: controller.signal }),
    ).rejects.toThrow("time budget");
    const [done, cut] = fetchImpl.mock.calls.map((c) => ids.get(String(c[0]))!);
    const untried = [...ids.values()].find((id) => id !== done && id !== cut)!;
    const rows = await t.db.select().from(collectionAttempts);
    const byId = new Map(rows.map((r) => [r.productId, r]));
    expect(byId.get(done)?.outcome).toBe("found");
    expect(byId.get(cut)).toMatchObject({ outcome: "error", error: "Interrupted" });
    expect(byId.has(untried)).toBe(false);
  });

  it("checks every redirect hop against the URL guard", async () => {
    const safe = await product("Safe redirect", "https://cdn.test/a.jpg");
    const unsafe = await product("Unsafe redirect", "https://cdn.test/b.jpg");
    const body = await jpeg();
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } });
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u === "https://cdn.test/a.jpg") return redirect("/a2.jpg");
      if (u === "https://cdn.test/b.jpg") return redirect("http://169.254.169.254/latest");
      return new Response(new Uint8Array(body));
    });

    const r = await hashProductImages(t.db, { retry: { fetchImpl }, now: NOW });
    expect(r).toMatchObject({ hashed: 1, failed: 1 });
    expect(fetchImpl.mock.calls.map((c) => String(c[0])).sort()).toEqual([
      "https://cdn.test/a.jpg",
      "https://cdn.test/a2.jpg",
      "https://cdn.test/b.jpg",
    ]);
    expect(fetchImpl.mock.calls.every((c) => c[1]?.redirect === "manual")).toBe(true);
    const [s] = await t.db.select().from(products).where(eq(products.id, safe));
    expect(s.imageHash).not.toBeNull();
    const [u] = await t.db.select().from(products).where(eq(products.id, unsafe));
    expect(u.imageHash).toBeNull();
  });

  it("rejects non-https and private-network image URLs", () => {
    expect(isAllowedImageUrl("https://cdn.shopify.com/a.jpg")).toBe(true);
    for (const url of [
      "http://cdn.shopify.com/a.jpg",
      "file:///etc/passwd",
      "https://localhost/a.jpg",
      "https://10.0.0.1/a.jpg",
      "https://192.168.1.1/a.jpg",
      "https://172.16.0.1/a.jpg",
      "https://169.254.169.254/latest",
      "https://[::1]/a.jpg",
      "not a url",
    ]) {
      expect(isAllowedImageUrl(url), url).toBe(false);
    }
  });
});
