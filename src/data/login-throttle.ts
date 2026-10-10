import { and, count, eq, gte, lt } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { loginFailures } from "@/db/schema";

/**
 * Login throttling for the shared site password (ADR-010). Two limits: one per client, and a
 * site-wide one so rotating IP addresses does not allow unlimited guesses.
 */
export const LOGIN_LIMITS = {
  windowMs: 15 * 60_000,
  perClient: 10,
  global: 100,
  /** Failures older than this are deleted. */
  retentionMs: 24 * 60 * 60_000,
} as const;

/**
 * Salted hash of the client address. The salt is per deployment (derived from the password),
 * so hashes cannot be matched against other data sets.
 */
export async function clientHash(address: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`winning-product-hunter:login:${salt}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The client address as seen by the hosting proxy. On Vercel `x-forwarded-for` is set by the
 * platform (client-supplied values are overwritten), and its first entry is the client.
 */
export function clientAddress(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function isLoginThrottled(
  db: AnyDatabase,
  hash: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_LIMITS.windowMs);
  const [[mine], [all]] = await Promise.all([
    db
      .select({ n: count() })
      .from(loginFailures)
      .where(and(eq(loginFailures.clientHash, hash), gte(loginFailures.failedAt, since))),
    db.select({ n: count() }).from(loginFailures).where(gte(loginFailures.failedAt, since)),
  ]);
  return mine.n >= LOGIN_LIMITS.perClient || all.n >= LOGIN_LIMITS.global;
}

export async function recordLoginFailure(db: AnyDatabase, hash: string, now = new Date()) {
  await db.insert(loginFailures).values({ clientHash: hash, failedAt: now });
  await db
    .delete(loginFailures)
    .where(lt(loginFailures.failedAt, new Date(now.getTime() - LOGIN_LIMITS.retentionMs)));
}

/** A successful login clears that client's failures. */
export async function clearLoginFailures(db: AnyDatabase, hash: string) {
  await db.delete(loginFailures).where(eq(loginFailures.clientHash, hash));
}
