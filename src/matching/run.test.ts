// @vitest-environment node
import { isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "./run";

describe("runMatching on fixture data", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 });
    }
  });

  afterEach(async () => {
    await t.close();
  });

  it("resolves the five sample products across Meta, AliExpress and Google Trends", async () => {
    const result = await runMatching(t.db);

    expect(result).toEqual({ productsCreated: 5, itemsMatched: 54, itemsUnmatched: 0 });

    const all = await t.db.select().from(products);
    const items = await t.db.select().from(sourceItems);
    for (const p of all) {
      const sources = new Set(items.filter((i) => i.productId === p.id).map((i) => i.source));
      expect([...sources].sort(), p.title).toEqual(["aliexpress", "google_trends", "meta_ads"]);
    }
  });

  it("is idempotent", async () => {
    await runMatching(t.db);
    const second = await runMatching(t.db);

    expect(second).toEqual({ productsCreated: 0, itemsMatched: 0, itemsUnmatched: 0 });
    expect(await t.db.select().from(sourceItems).where(isNull(sourceItems.productId))).toEqual([]);
  });
});
