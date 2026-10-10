// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestionRuns, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import type { FetchedItem } from "@/ingestion/types";
import { groupAdsByLanding, isPromising, runDiscovery } from "./discover";
import { keywordsForDay } from "./keywords";
import { landingKey, normalizeHandle, titleFromHandle } from "./landing";

const NOW = new Date("2026-10-10T00:00:00Z");
const html = fs.readFileSync(
  path.resolve(__dirname, "../ingestion/sources/__recordings__/meta-ad-library-search.html"),
  "utf8",
);

describe("landingKey", () => {
  it("keys Shopify product pages by handle so the same product across stores groups together", () => {
    const a = landingKey("https://www.axzenia.com/products/instant-posture-corrector?variant=1");
    const b = landingKey(
      "https://corecareshop.com/collections/all/products/Instant-Posture-Corrector-2",
    );
    expect(a).toMatchObject({ key: "handle:instant-posture-corrector", host: "axzenia.com" });
    expect(b?.key).toBe(a?.key);
    expect(a?.url).toBe("https://axzenia.com/products/instant-posture-corrector");
  });

  it("accepts explicit product URL patterns and rejects everything else", () => {
    expect(landingKey("https://brand.com/item/neck-massager")?.key).toBe(
      "url:brand.com/item/neck-massager",
    );
    expect(landingKey("https://brand.com/en/product/neck-massager/details")?.key).toBe(
      "url:brand.com/product/neck-massager",
    );
    // Advertorials, listicles and membership pages are not products.
    expect(landingKey("https://shop.puppypad.co/listicle")).toBeNull();
    expect(landingKey("https://fabfitfun.com/get-the-box/bonus-box")).toBeNull();
    expect(landingKey("https://neckline-us.com/neckline-usa/adv-pdp-ear")).toBeNull();
    expect(landingKey("https://brand.com/")).toBeNull();
    expect(landingKey("https://brand.com/collections/sale")).toBeNull();
    expect(landingKey("https://www.facebook.com/somepage")).toBeNull();
    expect(landingKey("not a url")).toBeNull();
    expect(landingKey(null)).toBeNull();
  });

  it("normalizes handles and builds titles", () => {
    expect(normalizeHandle("led-face-mask-copy")).toBe("led-face-mask");
    expect(normalizeHandle("neck-massager-12")).toBe("neck-massager");
    expect(normalizeHandle("noxa-neck-massager-copy-1")).toBe("noxa-neck-massager");
    expect(normalizeHandle("therapro--neck-massager")).toBe("therapro-neck-massager");
    expect(titleFromHandle("instant-posture-corrector")).toBe("Instant Posture Corrector");
  });
});

describe("keywordsForDay", () => {
  it("rotates through the list day by day", () => {
    const list = ["a", "b", "c", "d", "e"];
    const day0 = new Date(0);
    const day1 = new Date(86_400_000);
    expect(keywordsForDay(day0, 2, list)).toEqual(["a", "b"]);
    expect(keywordsForDay(day1, 2, list)).toEqual(["c", "d"]);
    expect(keywordsForDay(new Date(2 * 86_400_000), 2, list)).toEqual(["e", "a"]);
  });
});

describe("groupAdsByLanding / isPromising", () => {
  const ad = (id: string, url: string, extra: Partial<FetchedItem> = {}): FetchedItem => ({
    externalId: id,
    kind: "ad",
    title: "Shop now!",
    metrics: [],
    raw: { landing_url: url },
    ...extra,
  });

  it("groups by landing page and counts distinct stores", () => {
    const groups = groupAdsByLanding([
      ad("1", "https://a.com/products/neck-massager"),
      ad("2", "https://b.com/products/neck-massager"),
      ad("3", "https://a.com/"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "Neck Massager", stores: ["a.com", "b.com"] });
  });

  it("only tracks groups with several ads, reused creatives or long-running ads", () => {
    const [single] = groupAdsByLanding([ad("1", "https://a.com/products/x")]);
    expect(isPromising(single, NOW)).toBe(false);
    const [variants] = groupAdsByLanding([
      ad("1", "https://a.com/products/x", { metrics: [{ metric: "creative_variants", value: 3 }] }),
    ]);
    expect(isPromising(variants, NOW)).toBe(true);
    const [old] = groupAdsByLanding([
      ad("1", "https://a.com/products/x", { startedAt: new Date("2026-09-01T00:00:00Z") }),
    ]);
    expect(isPromising(old, NOW)).toBe(true);
  });
});

describe("runDiscovery with the recorded Ad Library page", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const adapter = (body: string) =>
    createAdLibraryWebAdapter({
      countries: ["US"],
      retry: { fetchImpl: vi.fn<typeof fetch>(async () => new Response(body)) },
    });

  it("creates one product for ads from two stores selling the same handle, and is idempotent", async () => {
    const first = await runDiscovery(t.db, adapter(html), ["posture corrector"], NOW);
    expect(first).toMatchObject({
      adsFetched: 3,
      groups: 1,
      productsCreated: 1,
      productsUpdated: 0,
    });

    const [product] = await t.db.select().from(products);
    expect(product).toMatchObject({
      title: "Instant Posture Corrector",
      slug: "instant-posture-corrector",
      landingKey: "handle:instant-posture-corrector",
    });
    const items = await t.db.select().from(sourceItems);
    expect(items.filter((i) => i.kind === "ad").every((i) => i.productId === product.id)).toBe(
      true,
    );
    // The keyword-level active-ad count is kept, unattached.
    expect(items.find((i) => i.kind === "trend")?.productId).toBeNull();

    const second = await runDiscovery(t.db, adapter(html), ["posture corrector"], NOW);
    expect(second).toMatchObject({ productsCreated: 0, productsUpdated: 1 });
    expect(await t.db.select().from(products)).toHaveLength(1);
  });

  it("records a failed run when blocked, without creating anything", async () => {
    const result = await runDiscovery(
      t.db,
      adapter("<html><title>Log in to Facebook</title></html>"),
      ["x"],
      NOW,
    );
    expect(result.ingestion.status).toBe("failed");
    expect(await t.db.select().from(products)).toEqual([]);
    expect((await t.db.select().from(ingestionRuns))[0].status).toBe("failed");
  });
});
