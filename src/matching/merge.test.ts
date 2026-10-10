// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productScores, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { runDiscovery } from "@/discovery/discover";
import { runIngestion } from "@/ingestion/run";
import type { FetchedItem, SourceAdapter } from "@/ingestion/types";
import { runScoring } from "@/scoring/run";
import { findDuplicateGroups, hashProductImages, mergeDuplicateProducts } from "./merge";

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

    expect(await hashProductImages(t.db, { retry: { fetchImpl } })).toEqual({
      hashed: 3,
      failed: 0,
    });
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
