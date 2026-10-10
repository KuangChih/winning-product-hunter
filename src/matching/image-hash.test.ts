// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dHash, hammingDistance } from "./image-hash";

/** A synthetic "product photo": a gradient with a dark rectangle at a given position. */
async function photo(rectX: number, width = 400, format: "png" | "jpeg" = "png") {
  const height = Math.round(width * 0.75);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#eee"/><stop offset="1" stop-color="#888"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="${(rectX * width) / 400}" y="${height * 0.3}" width="${width * 0.25}" height="${height * 0.4}" fill="#222"/>
  </svg>`;
  return sharp(Buffer.from(svg))[format]({ quality: 60 }).toBuffer();
}

describe("dHash", () => {
  it("is stable across resizing and recompression of the same photo", async () => {
    const original = await dHash(await photo(60));
    const resizedJpeg = await dHash(await photo(60, 1000, "jpeg"));
    expect(original).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(original, resizedJpeg)).toBeLessThanOrEqual(4);
  });

  it("separates clearly different photos", async () => {
    const a = await dHash(await photo(20));
    const b = await dHash(await photo(260));
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });
});

describe("hammingDistance", () => {
  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
  });
});
