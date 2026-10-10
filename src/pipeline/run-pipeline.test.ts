// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestFxRates } from "@/data/fx";
import { productScores, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import { createShopifyCatalogAdapter } from "@/ingestion/sources/shopify-catalog";
import { parseEcbDaily } from "@/lib/fx";
import { runPipeline } from "./run-pipeline";

const rec = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, "../ingestion/sources/__recordings__", name), "utf8");
const adHtml = rec("meta-ad-library-search.html");
const catalogJson = JSON.parse(rec("shopify-catalog-search.json"));
const ecbXml = rec("ecb-eurofxref-daily.xml");
const NOW = new Date("2026-10-10T00:00:00Z");

describe("runPipeline (recorded responses)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const deps = (adBody: string) => ({
    fetchFxRates: async () => parseEcbDaily(ecbXml),
    discoveryAdapter: createAdLibraryWebAdapter({
      countries: ["US"],
      retry: { fetchImpl: vi.fn<typeof fetch>(async () => new Response(adBody)) },
    }),
    discoveryKeywords: ["posture corrector"],
    collectAdapter: createShopifyCatalogAdapter({
      countries: ["US"],
      retry: { fetchImpl: vi.fn<typeof fetch>(async () => Response.json(catalogJson)) },
    }),
    collectProducts: 5,
    now: NOW,
  });

  it("discovers a real product, adds Shopify evidence to it and scores it", async () => {
    const results = await runPipeline(t.db, deps(adHtml));

    expect(results.map((r) => [r.step, r.ok])).toEqual([
      ["fx", true],
      ["discover", true],
      ["collect", true],
      ["match", true],
      ["score", true],
    ]);
    expect((await getLatestFxRates(t.db))?.date).toBe("2026-10-09");
    const [product] = await t.db.select().from(products);
    expect(product.title).toBe("Instant Posture Corrector");
    const sources = new Set(
      (await t.db.select().from(sourceItems))
        .filter((i) => i.productId === product.id)
        .map((i) => i.source),
    );
    expect([...sources].sort()).toEqual(["meta_ads", "shopify"]);
    expect(await t.db.select().from(productScores)).toHaveLength(1);
  });

  it("keeps going when discovery is blocked and reports the failure", async () => {
    const results = await runPipeline(t.db, deps("<html><title>Log in</title></html>"));
    expect(results.find((r) => r.step === "discover")).toMatchObject({ ok: false });
    expect(results.find((r) => r.step === "score")).toMatchObject({ ok: true });
  });

  it("does not re-collect a product that already has fresh evidence", async () => {
    await runPipeline(t.db, deps(adHtml));
    const second = await runPipeline(t.db, deps(adHtml));
    expect(second.find((r) => r.step === "collect")?.detail).toBe("nothing to collect");
  });
});
