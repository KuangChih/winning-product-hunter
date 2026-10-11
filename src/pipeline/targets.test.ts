// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionAttempts, productScores, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import type { SourceAdapter } from "@/ingestion/types";
import {
  collectForTargets,
  hostVariants,
  pickLandingPages,
  pickProducts,
  recordAttempts,
  type AttemptOutcome,
} from "./targets";

const NOW = new Date("2026-10-10T00:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const PROVIDER = "shopify_catalog";

describe("collection targets", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function product(title: string, opts: { score?: number; discovered?: boolean } = {}) {
    const [p] = await t.db
      .insert(products)
      .values({
        slug: `p-${n++}`,
        title,
        landingKey: opts.discovered === false ? null : `handle:${title}`,
        firstSeenAt: ago(30),
      })
      .returning();
    if (opts.score !== undefined) {
      await t.db.insert(productScores).values({
        productId: p.id,
        scoringVersion: "test",
        score: opts.score,
        confidence: 1,
        breakdown: {},
        computedAt: ago(1),
      });
    }
    return p.id;
  }
  async function item(productId: string, provider: string, raw: unknown = {}, kind = "ad") {
    await t.db.insert(sourceItems).values({
      source:
        provider === "fixture"
          ? "meta_ads"
          : provider.startsWith("shopify")
            ? "shopify"
            : "meta_ads",
      provider,
      externalId: `item-${n++}`,
      kind: kind as "ad",
      productId,
      firstSeenAt: ago(20),
      lastSeenAt: ago(20),
      raw,
    });
  }
  const attempt = (
    productId: string,
    outcome: AttemptOutcome,
    daysAgo: number,
    provider = PROVIDER,
  ) => recordAttempts(t.db, provider, [{ productId, outcome }], ago(daysAgo));

  describe("pickProducts", () => {
    it("ranks discovered products, then by score, and never picks sample products", async () => {
      const low = await product("Low", { score: 10 });
      const high = await product("High", { score: 90 });
      const matched = await product("Matched", { score: 99, discovered: false });
      const sample = await product("Sample", { score: 100 });
      await item(sample, "fixture");

      const picked = await pickProducts(t.db, 10, { provider: PROVIDER, now: NOW });
      expect(picked.map((p) => p.productId)).toEqual([high, low, matched]);
      expect(picked[0]).toMatchObject({ query: "High", landingKey: "handle:High" });
    });

    it("skips recent attempts and puts never-tried products before tried ones", async () => {
      const foundRecently = await product("Found recently", { score: 90 });
      const emptyLongAgo = await product("Empty long ago", { score: 80 });
      const failedToday = await product("Failed today", { score: 70 });
      const failedYesterday = await product("Failed two days ago", { score: 60 });
      const neverTried = await product("Never tried", { score: 10 });
      await attempt(foundRecently, "found", 3);
      await attempt(emptyLongAgo, "empty", 8);
      await attempt(failedToday, "error", 0.1);
      await attempt(failedYesterday, "error", 2);
      // Another provider's attempts do not count.
      await attempt(neverTried, "found", 0, "image_hash");

      const picked = await pickProducts(t.db, 10, { provider: PROVIDER, now: NOW });
      expect(picked.map((p) => p.query)).toEqual([
        "Never tried",
        "Empty long ago",
        "Failed two days ago",
      ]);
      // Without a provider there is no attempt filter.
      expect(await pickProducts(t.db, 10, { now: NOW })).toHaveLength(5);
    });
  });

  describe("pickLandingPages", () => {
    it("uses ad landing URLs, skipping recent attempts and sample products", async () => {
      const a = await product("a", { score: 10 });
      const b = await product("b", { score: 20 });
      const tried = await product("tried");
      const sample = await product("sample");
      await item(a, "ad_library_web", { landing_url: "https://a.example/products/a?utm=1" });
      await item(a, "ad_library_web", { other: true });
      await item(b, "ad_library_web", { landing_url: "https://b.example/products/b" });
      await item(tried, "ad_library_web", { landing_url: "https://t.example/products/t" });
      await item(sample, "fixture", { landing_url: "https://s.example/products/s" });
      await attempt(tried, "empty", 2, "shopify_catalog_lookup");
      await attempt(b, "empty", 10, "shopify_catalog_lookup");

      const picked = await pickLandingPages(t.db, 10, { now: NOW });
      // With and without "www.": the catalog only knows the store's own host.
      expect(picked).toEqual([
        {
          productId: a,
          query: ["https://a.example/products/a", "https://www.a.example/products/a"],
        },
        {
          productId: b,
          query: ["https://b.example/products/b", "https://www.b.example/products/b"],
        },
      ]);
    });

    it("hostVariants adds or removes www.", () => {
      expect(hostVariants("https://shop.example/products/x")).toEqual([
        "https://shop.example/products/x",
        "https://www.shop.example/products/x",
      ]);
      expect(hostVariants("https://www.shop.example/products/x")).toEqual([
        "https://www.shop.example/products/x",
        "https://shop.example/products/x",
      ]);
      expect(hostVariants("not a url")).toEqual(["not a url"]);
    });
  });

  describe("collectForTargets", () => {
    it("records found, empty and the product the source failed on", async () => {
      const [found, empty, failing, notReached] = await Promise.all(
        ["found", "empty", "failing", "not-reached"].map((x) => product(x)),
      );
      const adapter: SourceAdapter = {
        source: "shopify",
        provider: PROVIDER,
        async *fetch(ctx) {
          const [q] = ctx.queries;
          if (q === "failing") throw new Error("HTTP 500");
          if (q === "found") {
            yield { externalId: `x-${q}`, kind: "store_product", metrics: [], raw: {} };
          }
        },
      };
      const targets = [found, empty, failing, notReached].map((productId, i) => ({
        productId,
        query: ["found", "empty", "failing", "not-reached"][i],
      }));

      const r = await collectForTargets(t.db, adapter, targets, { now: NOW });
      expect(r).toMatchObject({ status: "failed", itemsFetched: 1 });
      const rows = await t.db.select().from(collectionAttempts);
      const outcome = new Map(rows.map((row) => [row.productId, row.outcome]));
      expect(outcome.get(found)).toBe("found");
      expect(outcome.get(empty)).toBe("empty");
      expect(outcome.get(failing)).toBe("error");
      expect(outcome.has(notReached)).toBe(false);
      expect(rows.find((row) => row.productId === failing)?.error).toBe("HTTP 500");
    });

    it("on abort records the products finished before it, not the one cut short", async () => {
      const [found, empty, cut, notReached] = await Promise.all(
        ["found", "empty", "cut", "not-reached"].map((x) => product(x)),
      );
      const controller = new AbortController();
      const adapter: SourceAdapter = {
        source: "shopify",
        provider: PROVIDER,
        async *fetch(ctx) {
          const [q] = ctx.queries;
          if (q === "found") {
            yield { externalId: `x-${q}`, kind: "store_product", metrics: [], raw: {} };
          }
          if (q === "cut") {
            controller.abort(new Error("time budget"));
            throw controller.signal.reason;
          }
        },
      };
      const targets = [found, empty, cut, notReached].map((productId, i) => ({
        productId,
        query: ["found", "empty", "cut", "not-reached"][i],
      }));

      await expect(
        collectForTargets(t.db, adapter, targets, { now: NOW, signal: controller.signal }),
      ).rejects.toThrow("time budget");
      const rows = await t.db.select().from(collectionAttempts);
      expect(new Map(rows.map((row) => [row.productId, row.outcome]))).toEqual(
        new Map([
          [found, "found"],
          [empty, "empty"],
        ]),
      );
    });

    it("does not count keyword-level items as found for the product", async () => {
      const id = await product("keyword-only");
      const adapter: SourceAdapter = {
        source: "meta_ads",
        provider: "ad_library_web",
        async *fetch() {
          yield { externalId: "kw-count", kind: "trend", metrics: [], raw: {} };
        },
      };
      await collectForTargets(t.db, adapter, [{ productId: id, query: "x" }], { now: NOW });
      const [row] = await t.db.select().from(collectionAttempts);
      expect(row).toMatchObject({ productId: id, outcome: "empty" });
    });
  });
});
