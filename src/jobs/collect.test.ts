// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseCollectArgs } from "./collect";

describe("parseCollectArgs", () => {
  it("defaults to the five priority markets", () => {
    expect(parseCollectArgs(["shopify_catalog"])).toEqual({
      source: "shopify_catalog",
      products: 20,
      countries: ["US", "CA", "GB", "AU", "NZ"],
      dryRun: false,
    });
  });

  it("parses options and rejects unknown sources", () => {
    expect(
      parseCollectArgs(["shopify_catalog", "--products=3", "--countries=us,de", "--dry-run"]),
    ).toMatchObject({ products: 3, countries: ["US", "DE"], dryRun: true });
    expect(parseCollectArgs(["meta_ad_library"]).source).toBe("meta_ad_library");
    expect(() => parseCollectArgs(["meta_ads"])).toThrow(
      /shopify_catalog, meta_ad_library, advertiser_stores/,
    );
  });
});
