// @vitest-environment node
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productScores, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { ingestItems } from "@/ingestion/run";
import { runScoring } from "@/scoring/run";
import type { ScoreBreakdown } from "@/scoring/score";
import { dHash } from "./image-hash";
import { hashListingPhotos, thumbnailUrl, UNUSABLE_PHOTO } from "./listing-photos";

const NOW = new Date("2026-10-11T00:00:00Z");

async function photo(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="100%" height="100%" fill="#ddd"/><circle cx="90" cy="120" r="60" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

async function otherPhoto() {
  return sharp({ create: { width: 300, height: 300, channels: 3, background: "#123456" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="300" height="300"><rect x="200" y="10" width="90" height="280" fill="#fff"/></svg>',
        ),
      },
    ])
    .jpeg()
    .toBuffer();
}

describe("thumbnailUrl", () => {
  it("asks Shopify's CDN for a small image and leaves other hosts alone", () => {
    expect(thumbnailUrl("https://cdn.shopify.com/s/files/a.jpg?v=1")).toBe(
      "https://cdn.shopify.com/s/files/a.jpg?v=1&width=256",
    );
    expect(thumbnailUrl("https://img.example.com/a.jpg")).toBe("https://img.example.com/a.jpg");
  });
});

describe("hashListingPhotos (ADR-016)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function product(slug: string, imageHash: string | null) {
    const [p] = await t.db
      .insert(products)
      .values({ slug, title: "Mandoline Vegetable Slicer", imageHash, firstSeenAt: NOW })
      .returning();
    return p;
  }

  const result = (
    productId: string,
    id: string,
    imageUrl: string,
    seller: string,
    cents = 2500,
  ) => ({
    source: "shopify" as const,
    provider: "shopify_catalog",
    externalId: `${id}|US`,
    kind: "store_product" as const,
    productId,
    title: "Mandoline Slicer",
    imageUrl,
    countries: ["US"],
    advertiserId: seller,
    priceCents: cents,
    currency: "USD",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  });

  it("hashes each search-result photo once, marks unusable ones and feeds the same-photo price", async () => {
    const own = await photo("#333");
    const ownHash = await dHash(own);
    const cj = await product("cj-slicer", ownHash);
    const noPhoto = await product("no-photo", null);
    const images: Record<string, Buffer> = {
      "https://cdn.shopify.com/same.jpg?width=256": await photo("#333"),
      "https://cdn.shopify.com/other.jpg?width=256": await otherPhoto(),
    };
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      requested.push(String(url));
      const body = images[String(url)];
      return body ? new Response(new Uint8Array(body)) : new Response("", { status: 404 });
    };
    await t.db.insert(sourceItems).values([
      // Two stores showing the same supplier photo: one download.
      result(cj.id, "1", "https://cdn.shopify.com/same.jpg", "a.com", 2000),
      result(cj.id, "2", "https://cdn.shopify.com/same.jpg", "b.com", 3000),
      result(cj.id, "3", "https://cdn.shopify.com/other.jpg", "c.com", 99900),
      result(cj.id, "4", "https://cdn.shopify.com/gone.jpg", "d.com"),
      result(cj.id, "5", "http://insecure.example.com/x.jpg", "e.com"),
      // A product without its own photo hash cannot be compared: its results wait.
      result(noPhoto.id, "6", "https://cdn.shopify.com/wait.jpg", "f.com"),
      {
        source: "cj" as const,
        provider: "cj_api",
        externalId: "cj-1",
        kind: "listing" as const,
        productId: cj.id,
        priceCents: 500,
        currency: "USD",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      },
    ]);

    const r = await hashListingPhotos(t.db, { retry: { fetchImpl, retries: 0 } });
    expect(r).toEqual({ hashed: 2, failed: 2, more: false });
    expect(requested.filter((u) => u.includes("same.jpg"))).toHaveLength(1);
    expect(requested.some((u) => u.includes("insecure") || u.includes("wait.jpg"))).toBe(false);

    const rows = await t.db
      .select({ externalId: sourceItems.externalId, imageHash: sourceItems.imageHash })
      .from(sourceItems)
      .where(eq(sourceItems.provider, "shopify_catalog"));
    const hashOf = Object.fromEntries(rows.map((x) => [x.externalId, x.imageHash]));
    expect(hashOf["1|US"]).toBe(hashOf["2|US"]);
    expect(hashOf["4|US"]).toBe(UNUSABLE_PHOTO);
    expect(hashOf["5|US"]).toBe(UNUSABLE_PHOTO);
    expect(hashOf["6|US"]).toBeNull();
    // Nothing left to do for comparable products.
    expect(await hashListingPhotos(t.db, { retry: { fetchImpl } })).toEqual({
      hashed: 0,
      failed: 0,
      more: false,
    });

    await runScoring(t.db, NOW);
    const [score] = await t.db
      .select()
      .from(productScores)
      .where(eq(productScores.productId, cj.id));
    const margin = (score.breakdown as ScoreBreakdown).subScores.margin;
    // Median of the two same-photo stores (20 and 30 USD) vs CJ's 5 USD; c.com is a different product.
    expect(margin.explain).toEqual({
      key: "marginSamePhoto",
      params: { retail: "25.00", supplier: "5.00", stores: 2 },
    });
  });

  it("forgets a hash when the result's photo changes", async () => {
    const p = await product("p", "ffff0000ffff0000");
    const item = {
      externalId: "9|US",
      kind: "store_product" as const,
      title: "Slicer",
      imageUrl: "https://cdn.shopify.com/a.jpg",
      productId: p.id,
      metrics: [],
      raw: {},
    };
    const meta = { source: "shopify" as const, provider: "shopify_catalog" };
    await ingestItems(t.db, meta, [item], { now: () => NOW });
    await t.db.update(sourceItems).set({ imageHash: "ffff0000ffff0000" });
    await ingestItems(t.db, meta, [item], { now: () => NOW });
    const [same] = await t.db.select({ h: sourceItems.imageHash }).from(sourceItems);
    expect(same.h).toBe("ffff0000ffff0000");
    await ingestItems(t.db, meta, [{ ...item, imageUrl: "https://cdn.shopify.com/b.jpg" }], {
      now: () => NOW,
    });
    const [changed] = await t.db.select({ h: sourceItems.imageHash }).from(sourceItems);
    expect(changed.h).toBeNull();
  });
});
