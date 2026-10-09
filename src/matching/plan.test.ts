import { describe, expect, it } from "vitest";
import { containment, jaccard, slugify, titleTokens } from "./normalize";
import { planMatches, type UnmatchedItem } from "./plan";

const t0 = new Date("2026-10-01T00:00:00Z");
let n = 0;
const item = (kind: UnmatchedItem["kind"], title: string, firstSeenAt = t0): UnmatchedItem => ({
  id: `i${++n}`,
  kind,
  title,
  imageUrl: null,
  firstSeenAt,
});

describe("titleTokens", () => {
  it("drops offer words, numbers and plurals", () => {
    expect([...titleTokens("NEW 2026 Cloud Pillow Slides - Free Shipping!")]).toEqual([
      "cloud",
      "pillow",
      "slide",
    ]);
  });

  it("measures overlap", () => {
    const a = titleTokens("LED Light Therapy Face Mask");
    expect(jaccard(a, titleTokens("LED Face Mask Light Therapy"))).toBe(1);
    expect(containment(titleTokens("face mask"), a)).toBe(1);
    expect(containment(titleTokens("face cream"), a)).toBe(0.5);
  });

  it("slugifies", () => {
    expect(slugify("Silicone Dog Paw Cleaner Cup!")).toBe("silicone-dog-paw-cleaner-cup");
  });
});

describe("planMatches", () => {
  it("groups near-identical titles from different sources into one new product", () => {
    const plan = planMatches(
      [],
      [
        item("ad", "Adjustable Posture Corrector Brace"),
        item("listing", "Posture Corrector Brace Adjustable - Free Shipping"),
        item("ad", "LED Light Therapy Face Mask"),
      ],
    );

    expect(plan.newProducts.map((p) => p.slug)).toEqual([
      "adjustable-posture-corrector-brace",
      "led-light-therapy-face-mask",
    ]);
    const [a, b, c] = plan.assignments.map((x) => x.productRef);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it("joins existing products and does not merge unrelated items", () => {
    const plan = planMatches(
      [{ id: "p1", slug: "led-face-mask", title: "LED Light Therapy Face Mask" }],
      [
        item("listing", "LED Light Therapy Face Mask"),
        item("listing", "Face Mask Sheet Hydrating"),
      ],
    );

    expect(plan.assignments[0].productRef).toEqual({ existing: "p1" });
    expect(plan.newProducts).toHaveLength(1);
  });

  it("attaches trend keywords to the most specific product containing every keyword token", () => {
    const plan = planMatches(
      [
        { id: "mask", slug: "m", title: "LED Light Therapy Face Mask" },
        { id: "sheet", slug: "s", title: "Face Mask" },
      ],
      [item("trend", "face mask"), item("trend", "gaming chair")],
    );

    expect(plan.assignments).toEqual([
      { itemId: expect.any(String), productRef: { existing: "sheet" }, similarity: 1 },
    ]);
    expect(plan.unmatched).toHaveLength(1);
  });

  it("de-duplicates slugs against existing products", () => {
    const plan = planMatches(
      [{ id: "p1", slug: "cloud-slides", title: "Something Completely Different" }],
      [item("listing", "Cloud Slides")],
    );
    expect(plan.newProducts[0].slug).toBe("cloud-slides-2");
  });

  it("leaves items without usable titles unmatched", () => {
    const plan = planMatches([], [item("ad", "Free shipping!!! 2026")]);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.newProducts).toHaveLength(0);
  });
});
