/**
 * Encrypts API access tokens kept in the database (`api_tokens`) with a key derived from the API
 * key in the environment (AES-256-GCM). Whoever reads the database without the environment
 * cannot use the token; when the API key changes the stored token no longer decrypts and is
 * simply fetched again.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`winning-product-hunter:api-token:${secret}`).digest();
}

export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

/** The token, or null when it was encrypted with another key or is not ours. */
export function decryptToken(stored: string, secret: string): string | null {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
