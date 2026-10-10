import { describe, expect, it } from "vitest";
import { adFacts, adRunDays, externalHref, type FactsAd, urlHost } from "./ad-facts";

const NOW = new Date("2026-10-10T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ad = (over: Partial<FactsAd>): FactsAd => ({
  kind: "ad",
  source: "meta_ads",
  url: null,
  advertiserId: null,
  advertiserName: null,
  landingUrl: null,
  countries: [],
  startedAt: null,
  endedAt: null,
  ...over,
});

describe("ad facts", () => {
  it("counts days until now for active ads and until the end for stopped ones", () => {
    expect(adRunDays({ startedAt: day(30), endedAt: null }, NOW)).toBe(30);
    expect(adRunDays({ startedAt: day(30), endedAt: day(10) }, NOW)).toBe(20);
    // An end date in the future means it is still running.
    expect(adRunDays({ startedAt: day(5), endedAt: new Date(NOW.getTime() + 1e9) }, NOW)).toBe(5);
    expect(adRunDays({ startedAt: null, endedAt: null }, NOW)).toBeNull();
  });

  it("only allows web links", () => {
    expect(externalHref("https://www.facebook.com/ads/library/?id=1")).toBe(
      "https://www.facebook.com/ads/library/?id=1",
    );
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("data:text/html,x")).toBeNull();
    expect(externalHref("not a url")).toBeNull();
    expect(externalHref(null)).toBeNull();
    expect(urlHost("https://WWW.Shop.example/products/x?y=1")).toBe("shop.example");
  });

  it("summarizes active ads, advertisers, the longest run, domains and the primary ad", () => {
    const facts = adFacts(
      [
        ad({
          advertiserId: "a",
          startedAt: day(40),
          url: "https://www.facebook.com/ads/library/?id=1",
          landingUrl: "https://shop-a.example/products/cup",
        }),
        // Longest overall, but stopped: not the primary ad.
        ad({
          advertiserId: "b",
          startedAt: day(90),
          endedAt: day(30),
          url: "https://www.facebook.com/ads/library/?id=2",
          landingUrl: "https://www.shop-b.example/products/cup",
        }),
        ad({
          advertiserId: "a",
          startedAt: day(10),
          url: "https://www.facebook.com/ads/library/?id=3",
          landingUrl: "https://shop-a.example/products/cup-1",
        }),
        // Not an ad: ignored.
        { ...ad({ advertiserId: "z" }), kind: "store_product", landingUrl: null },
      ],
      NOW,
    );
    expect(facts).toEqual({
      totalAds: 3,
      activeAds: 2,
      activeAdvertisers: 1,
      longestRunDays: 60,
      landingDomains: ["shop-a.example", "shop-b.example"],
      primaryAd: { url: "https://www.facebook.com/ads/library/?id=1", days: 40 },
    });
  });

  it("gives no numbers it does not have", () => {
    expect(adFacts([], NOW)).toEqual({
      totalAds: 0,
      activeAds: 0,
      activeAdvertisers: 0,
      longestRunDays: null,
      landingDomains: [],
      primaryAd: null,
    });
    // An active ad with an unsafe link is not offered as the link to check.
    expect(adFacts([ad({ url: "javascript:alert(1)" })], NOW).primaryAd).toBeNull();
  });
});
