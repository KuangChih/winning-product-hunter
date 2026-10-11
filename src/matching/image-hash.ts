import sharp from "sharp";

/**
 * Difference hash (dHash, 64 bits as 16 hex chars). Robust to resizing, recompression and small
 * color changes, which is what re-uploads of the same supplier photo across stores look like.
 * Not robust to crops or rotations; those need embeddings (later).
 */
export async function dHash(image: Buffer): Promise<string> {
  const pixels = await sharp(image).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let hex = "";
  let nibble = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      nibble = (nibble << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0);
      if (++bit % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

export { hammingDistance } from "./same-photo";
