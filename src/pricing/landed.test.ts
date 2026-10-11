import { describe, expect, it } from "vitest";
import type { CjVariant } from "@/ingestion/sources/cj";
import { chooseShipping, chooseVariant, landedMargin, variantTokens } from "./landed";

const v = (key: string, priceCents: number, weightG: number | null): CjVariant => ({
  vid: key,
  key,
  priceCents,
  weightG,
});

// The elephant pillow measured on 2026-10-11 (docs/research/cj-api.md, section 7).
const elephant = [
  v("Blue-1Style", 647, 970),
  v("Blue-40cm", 332, 301),
  v("Blue-60cm", 486, 768),
  v("Blue-80cm", 995, 1300),
  v("Grey-30cm", 221, 177),
  v("Grey-40cm", 332, 303),
  v("Grey-60cm", 486, 744),
  v("Pink-60cm", 486, 824),
];

describe("chooseVariant (ADR-017)", () => {
  it("is certain when every variant costs the same (heaviest for shipping)", () => {
    const c = chooseVariant([v("Black-USB", 599, 351), v("Pinkgrey-USB", 599, 628)]);
    expect(c).toMatchObject({ basis: "single_price", priceCents: 599, matched: 2, total: 2 });
    expect(c!.variant.key).toBe("Pinkgrey-USB");
  });

  it("keeps only the variants the same-photo stores offer, then the most expensive", () => {
    // The store sells colours and "40 cm" / "60 cm": never the 80 cm or 30 cm sizes.
    const store = ["Blue", "Grey", "Pink", "Purple", "Yellow", "40 cm", "60 cm"];
    const c = chooseVariant(elephant, [store]);
    expect(c).toMatchObject({ basis: "store_options", priceCents: 486, matched: 5, total: 8 });
    expect(c!.variant.key).toBe("Pink-60cm");
  });

  it("falls back to the most expensive variant when no store option matches", () => {
    const c = chooseVariant(elephant, [["Green And Yellow", "Yellow"]]);
    expect(c).toMatchObject({ basis: "max_variant", priceCents: 995, matched: 8, total: 8 });
    expect(c!.variant.key).toBe("Blue-80cm");
    expect(chooseVariant(elephant)).toMatchObject({ basis: "max_variant" });
    expect(chooseVariant([])).toBeNull();
  });

  it("splits CJ variant names into comparable parts", () => {
    expect(variantTokens("Light Purple-USB")).toEqual(["lightpurple", "usb"]);
    expect(variantTokens("Blue-40cm")).toEqual(["blue", "40cm"]);
  });
});

describe("chooseShipping", () => {
  const o = (carrier: string, costCents: number, minDays: number, maxDays: number | null) => ({
    carrier,
    costCents,
    minDays,
    maxDays,
  });

  it("takes the cheapest option that arrives within 15 days", () => {
    const best = chooseShipping([
      o("CJPacket Eub", 2993, 12, 50),
      o("YunExpress Ordinary", 3673, 4, 7),
      o("CJPacket Ordinary Over Length", 3733, 7, 11),
    ]);
    expect(best?.carrier).toBe("YunExpress Ordinary");
  });

  it("is null when nothing arrives in time or the time is unknown", () => {
    expect(chooseShipping([o("Slow", 100, 15, 45), o("Unknown", 50, 3, null)])).toBeNull();
  });
});

describe("landedMargin", () => {
  it("needs all three inputs and can be negative", () => {
    expect(landedMargin(4005, 486, 1500)).toMatchObject({
      profitUsdCents: 2019,
      margin: 2019 / 4005,
    });
    expect(landedMargin(2000, 995, 2993)!.margin).toBeLessThan(0);
    expect(landedMargin(null, 486, 1500)).toBeNull();
    expect(landedMargin(4005, null, 1500)).toBeNull();
    expect(landedMargin(4005, 486, null)).toBeNull();
  });
});
