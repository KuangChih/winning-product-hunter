// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, signalSnapshots, sourceItems } from "./schema";
import { createTestDb } from "./testing/pglite";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

describe("database schema", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  const now = new Date("2026-10-09T00:00:00Z");

  it("links source items to products and keeps signal history append-only", async () => {
    const [product] = await t.db
      .insert(products)
      .values({ slug: "posture-corrector", title: "Posture Corrector", firstSeenAt: now })
      .returning();

    const [ad] = await t.db
      .insert(sourceItems)
      .values({
        source: "meta_ads",
        provider: "fixture",
        externalId: "ad-1",
        kind: "ad",
        productId: product.id,
        region: "EU",
        format: "video",
        startedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning();

    await t.db.insert(signalSnapshots).values([
      { sourceItemId: ad.id, metric: "eu_total_reach", value: 1000, observedAt: now },
      {
        sourceItemId: ad.id,
        metric: "eu_total_reach",
        value: 2500,
        observedAt: new Date("2026-10-10T00:00:00Z"),
      },
    ]);

    const series = await t.db
      .select()
      .from(signalSnapshots)
      .where(
        and(eq(signalSnapshots.sourceItemId, ad.id), eq(signalSnapshots.metric, "eu_total_reach")),
      )
      .orderBy(signalSnapshots.observedAt);

    expect(series.map((s) => s.value)).toEqual([1000, 2500]);
  });

  it("rejects a duplicate external id from the same source", async () => {
    const item = {
      source: "aliexpress" as const,
      provider: "fixture",
      externalId: "100500",
      kind: "listing" as const,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await t.db.insert(sourceItems).values(item);
    await expect(t.db.insert(sourceItems).values(item)).rejects.toThrow();
  });

  it("upserts a source item on (source, external id)", async () => {
    const base = {
      source: "tiktok_ads" as const,
      provider: "fixture",
      externalId: "v-1",
      kind: "ad" as const,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await t.db.insert(sourceItems).values(base);
    const later = new Date("2026-10-12T00:00:00Z");
    await t.db
      .insert(sourceItems)
      .values({ ...base, lastSeenAt: later })
      .onConflictDoUpdate({
        target: [sourceItems.source, sourceItems.externalId],
        set: { lastSeenAt: later },
      });

    const rows = await t.db.select().from(sourceItems);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt.toISOString()).toBe(later.toISOString());
    expect(rows[0].firstSeenAt.toISOString()).toBe(now.toISOString());
  });
});
