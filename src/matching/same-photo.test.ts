import { describe, expect, it } from "vitest";
import { isPhotoHash, isSamePhoto, samePhotoOf } from "./same-photo";

const BASE = "ffff0000ffff0000";
const ONE_BIT = "ffff0000ffff0001";
const SIX_BITS = "ffff0000ffff003f";
const FAR = "0f0f0f0f0f0f0f0f";

describe("isSamePhoto", () => {
  it("treats a near-identical photo as the same product whatever the titles", () => {
    expect(
      isSamePhoto(
        { imageHash: BASE, title: "8 In 1 Mandoline Slicer Vegetable Slicer Potato Peeler" },
        { imageHash: ONE_BIT, title: "Kitchen Helper N05" },
      ),
    ).toBe(true);
  });

  it("needs title overlap for a merely similar photo", () => {
    const product = { imageHash: BASE, title: "Rechargeable Automatic Hair Curler Women Portable" };
    expect(
      isSamePhoto(product, {
        imageHash: SIX_BITS,
        title: "Automatic Hair Curler USB Rechargeable",
      }),
    ).toBe(true);
    expect(isSamePhoto(product, { imageHash: SIX_BITS, title: "Dog Water Bowl" })).toBe(false);
  });

  it("never matches different photos, unusable photos or missing hashes", () => {
    const product = { imageHash: BASE, title: "Neck Fan" };
    expect(isSamePhoto(product, { imageHash: FAR, title: "Neck Fan" })).toBe(false);
    // "-" marks a photo that could not be used; padding it must not look like a match.
    expect(
      isSamePhoto({ imageHash: "0000000000000000", title: "x" }, { imageHash: "-", title: "x" }),
    ).toBe(false);
    expect(isSamePhoto(product, { imageHash: null, title: "Neck Fan" })).toBe(false);
  });
});

describe("samePhotoOf", () => {
  it("is null when either side has no usable hash (not compared), else the comparison", () => {
    expect(samePhotoOf(undefined, { imageHash: BASE, title: "a" })).toBeNull();
    expect(
      samePhotoOf({ imageHash: null, title: "a" }, { imageHash: BASE, title: "a" }),
    ).toBeNull();
    expect(samePhotoOf({ imageHash: BASE, title: "a" }, { imageHash: "-", title: "a" })).toBeNull();
    expect(samePhotoOf({ imageHash: BASE, title: "a" }, { imageHash: ONE_BIT, title: "b" })).toBe(
      true,
    );
    expect(samePhotoOf({ imageHash: BASE, title: "a" }, { imageHash: FAR, title: "a" })).toBe(
      false,
    );
  });

  it("recognises only 16-hex-digit hashes", () => {
    expect(isPhotoHash(BASE)).toBe(true);
    expect(isPhotoHash("-")).toBe(false);
    expect(isPhotoHash("abc")).toBe(false);
    expect(isPhotoHash(null)).toBe(false);
  });
});

describe("samePhotoOf with a product's other photos (ADR-019)", () => {
  it("matches a store photo that is one of CJ's gallery or variant photos", () => {
    const product = { imageHash: FAR, title: "Pet Hair Remover Mitt", extraHashes: [BASE] };
    expect(samePhotoOf(product, { imageHash: ONE_BIT, title: "Deshedding Glove" })).toBe(true);
    expect(samePhotoOf(product, { imageHash: SIX_BITS, title: "Dog Water Bowl" })).toBe(false);
    // Only other photos, no usable main photo: still comparable.
    expect(
      samePhotoOf(
        { imageHash: null, title: "x", extraHashes: [BASE] },
        { imageHash: BASE, title: "y" },
      ),
    ).toBe(true);
    expect(
      samePhotoOf(
        { imageHash: null, title: "x", extraHashes: ["-"] },
        { imageHash: BASE, title: "y" },
      ),
    ).toBeNull();
  });
});
