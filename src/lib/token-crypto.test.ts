import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";

describe("token encryption", () => {
  it("round-trips with the same key and refuses any other", () => {
    const stored = encryptToken("access-token-value", "key-a");
    expect(stored).not.toContain("access-token-value");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptToken(stored, "key-a")).toBe("access-token-value");
    expect(decryptToken(stored, "key-b")).toBeNull();
    expect(decryptToken("plain-text", "key-a")).toBeNull();
    // A fresh IV each time: the same token never encrypts to the same text.
    expect(encryptToken("access-token-value", "key-a")).not.toBe(stored);
  });
});
