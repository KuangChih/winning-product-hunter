// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestionRuns } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { classify, getSourceHealth } from "./source-health";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("classify", () => {
  it("flags failing, stale, degraded and healthy sources", () => {
    expect(classify("failed", hoursAgo(1), 1, NOW)).toBe("failing");
    expect(classify("succeeded", hoursAgo(72), 0, NOW)).toBe("stale");
    expect(classify("succeeded", null, 0, NOW)).toBe("stale");
    expect(classify("succeeded", hoursAgo(5), 2, NOW)).toBe("degraded");
    expect(classify("succeeded", hoursAgo(5), 0, NOW)).toBe("healthy");
  });
});

describe("getSourceHealth", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("summarizes runs per source and provider, worst first", async () => {
    const run = (
      source: "meta_ads" | "shopify",
      provider: string,
      status: "succeeded" | "failed",
      h: number,
      error: string | null = null,
    ) => ({
      source,
      provider,
      status,
      startedAt: hoursAgo(h),
      finishedAt: hoursAgo(h - 0.1),
      itemsFetched: status === "succeeded" ? 100 : 3,
      error,
    });
    await t.db.insert(ingestionRuns).values([
      run("shopify", "shopify_catalog", "succeeded", 30),
      run("shopify", "shopify_catalog", "succeeded", 6),
      run("meta_ads", "ad_library_web", "succeeded", 30),
      run("meta_ads", "ad_library_web", "failed", 6, "Meta Ad Library blocked the request"),
      // Older than the 7-day window: ignored.
      run("meta_ads", "ad_library_web", "failed", 24 * 9),
      // Sample data: hidden by default.
      run("meta_ads", "fixture", "succeeded", 2),
    ]);

    const health = await getSourceHealth(t.db, { now: NOW });

    expect(health.map((h) => [h.provider, h.status])).toEqual([
      ["ad_library_web", "failing"],
      ["shopify_catalog", "healthy"],
    ]);
    expect(health[0]).toMatchObject({
      runs: 2,
      failures: 1,
      lastRun: { status: "failed", error: "Meta Ad Library blocked the request", itemsFetched: 3 },
    });
    expect(health[0].lastSuccessAt?.getTime()).toBeCloseTo(hoursAgo(29.9).getTime(), -3);
    expect(await getSourceHealth(t.db, { now: NOW, includeSample: true })).toHaveLength(3);
  });
});
