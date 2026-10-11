/**
 * Database-backed cache for API access tokens (`api_tokens`, ADR-014). Tokens are stored
 * encrypted with a key derived from the API key (see src/lib/token-crypto.ts) and never logged.
 */
import { eq } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

export interface CachedToken {
  token: string;
  expiresAt: Date;
}

/** Where an API client keeps its access token between runs. */
export interface TokenStore {
  get(): Promise<CachedToken | null>;
  set(token: CachedToken): Promise<void>;
  clear(): Promise<void>;
}

export function createDbTokenStore(db: AnyDatabase, provider: string, secret: string): TokenStore {
  return {
    async get() {
      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.provider, provider));
      if (!row) return null;
      const token = decryptToken(row.token, secret);
      return token === null ? null : { token, expiresAt: row.expiresAt };
    },
    async set({ token, expiresAt }) {
      const values = { token: encryptToken(token, secret), expiresAt, updatedAt: new Date() };
      await db
        .insert(apiTokens)
        .values({ provider, ...values })
        .onConflictDoUpdate({ target: apiTokens.provider, set: values });
    },
    async clear() {
      await db.delete(apiTokens).where(eq(apiTokens.provider, provider));
    },
  };
}

/** In-memory store (tests, one-off scripts). */
export function createMemoryTokenStore(initial: CachedToken | null = null): TokenStore {
  let current = initial;
  return {
    get: async () => current,
    set: async (t) => {
      current = t;
    },
    clear: async () => {
      current = null;
    },
  };
}
