import { describe, expect, it } from "vitest";
import { parseMetaAd, type MetaArchivedAd } from "@/ingestion/sources/meta-ads";
import {
  apiAdProduct,
  captionDomain,
  groupApiAds,
  isApiGroupPromising,
  metaApiProductKey,
  normalizeLinkTitle,
  pickWebProduct,
  type WebProduct,
} from "./meta-api";

const NOW = new Date("2026-10-11T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** An official-API ad in the documented ArchivedAd shape. */
const ad = (id: string, extra: Partial<MetaArchivedAd> = {}) =>
  parseMetaAd(
    {
      id,
      page_id: "77",
      page_name: "Glow Store",
      ad_delivery_start_time: daysAgo(3),
      ad_creative_link_titles: ["LED Face Mask"],
      ad_creative_link_captions: ["GLOWSTORE.CO.UK"],
      ...extra,
    },
    ["GB", "DE"],
  );

describe("official Meta API products (ADR-015)", () => {
  it("reads the store domain from a link caption, and only a plain domain", () => {
    expect(captionDomain("GLOWSTORE.CO.UK")).toBe("glowstore.co.uk");
    expect(captionDomain("https://www.Glowstore.com/products/mask")).toBe("glowstore.com");
    expect(captionDomain("Free shipping today")).toBeNull();
    expect(captionDomain("facebook.com")).toBeNull();
    expect(captionDomain("m.me")).toBeNull();
    expect(captionDomain("")).toBeNull();
    expect(captionDomain(undefined)).toBeNull();
  });

  it("keeps link titles that name a product, not calls to action or templates", () => {
    expect(normalizeLinkTitle("LED Face Mask – 50% OFF!")).toBe("led face mask 50 off");
    expect(normalizeLinkTitle("Shop Now")).toBeNull();
    expect(normalizeLinkTitle("{{product.name}}")).toBeNull();
    // One content word is too little to tell products apart.
    expect(normalizeLinkTitle("Mask")).toBeNull();
    expect(normalizeLinkTitle("The New Mask")).toBeNull();
  });

  it("needs one domain and one title across all cards of an ad", () => {
    expect(apiAdProduct(ad("1"))).toEqual({
      domain: "glowstore.co.uk",
      title: "led face mask",
      display: "LED Face Mask",
    });
    const carousel = ad("2", { ad_creative_link_titles: ["LED Face Mask", "Neck Massager Pro"] });
    expect(apiAdProduct(carousel)).toBeNull();
    const twoShops = ad("3", { ad_creative_link_captions: ["glowstore.co.uk", "other.com"] });
    expect(apiAdProduct(twoShops)).toBeNull();
    expect(apiAdProduct(ad("4", { ad_creative_link_captions: undefined }))).toBeNull();
  });

  it("groups by domain + title, counts an ad found twice once, applies the discovery rules", () => {
    const groups = groupApiAds([
      ad("1"),
      ad("2", { ad_creative_link_titles: ["led face mask!"] }),
      ad("1"),
      ad("3", { ad_creative_link_captions: ["other-shop.com"] }),
      ad("4", { ad_creative_link_titles: ["Shop now"] }),
    ]);
    expect(groups.map((g) => [g.key, g.ads.length])).toEqual([
      [metaApiProductKey("glowstore.co.uk", "led face mask"), 2],
      [metaApiProductKey("other-shop.com", "led face mask"), 1],
    ]);
    expect(groups[0].displayTitle).toBe("LED Face Mask");
    // Two ads → promising; one 3-day-old ad → not; one ad running 20 days → promising.
    expect(isApiGroupPromising(groups[0], NOW)).toBe(true);
    expect(isApiGroupPromising(groups[1], NOW)).toBe(false);
    const old = groupApiAds([ad("5", { ad_delivery_start_time: daysAgo(20) })]);
    expect(isApiGroupPromising(old[0], NOW)).toBe(true);
  });

  it("attaches to a website product only for the same store and a clearly similar title", () => {
    const [group] = groupApiAds([ad("1"), ad("2")]);
    const web = (id: string, title: string, hosts: string[], handle: string | null = null) =>
      ({ id, title, hosts, handle }) satisfies WebProduct;
    // Same store, same handle.
    expect(
      pickWebProduct(group, [web("a", "Led Face Mask", ["glowstore.co.uk"], "led-face-mask")]),
    ).toBe("a");
    // Same store, similar title ("led face mask" vs "LED Face Mask Pro": Jaccard 3/4).
    expect(pickWebProduct(group, [web("b", "LED Face Mask Pro", ["glowstore.co.uk"])])).toBe("b");
    // Same title, another store: not the same product listing.
    expect(pickWebProduct(group, [web("c", "LED Face Mask", ["othershop.com"])])).toBeNull();
    // Same store, different product.
    expect(pickWebProduct(group, [web("d", "Neck Massager", ["glowstore.co.uk"])])).toBeNull();
    // Loosely similar ("led mask" ∩ "led face mask light therapy": 2/5): not attached.
    expect(
      pickWebProduct(group, [web("e", "LED Light Therapy Mask Set", ["glowstore.co.uk"])]),
    ).toBeNull();
    // Two candidates qualify: never guess (and do not track it apart either).
    expect(
      pickWebProduct(group, [
        web("f", "LED Face Mask", ["glowstore.co.uk"]),
        web("g", "LED Face Mask Pro", ["glowstore.co.uk"]),
      ]),
    ).toBe("ambiguous");
    // The same handle decides over a merely similar title (measured case on the demo data).
    expect(
      pickWebProduct(group, [
        web("h", "Led Face Mask", ["glowstore.co.uk"], "led-face-mask"),
        web("i", "Glow LED Face Mask FDA", ["glowstore.co.uk"], "glow-led-face-mask-fda"),
      ]),
    ).toBe("h");
  });
});
