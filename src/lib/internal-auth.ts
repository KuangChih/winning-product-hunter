/**
 * Authentication of the internal pipeline routes (ADR-013). Web Crypto only.
 *
 * - The tick route (one function hands the run to the next) accepts only a Bearer token derived
 *   from a server secret: `CRON_SECRET`, or `DATABASE_URL` when no cron secret is set (always
 *   secret, and present whenever the pipeline can run). Never the site cookie.
 * - The daily cron route requires `Authorization: Bearer $CRON_SECRET` exactly as Vercel Cron
 *   sends it; without `CRON_SECRET` it is not configured (503, fail closed).
 */
import { safeEqual } from "./site-auth";

type Env = Record<string, string | undefined>;
export type InternalAuth = "ok" | "unauthorized" | "unconfigured";

async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The tick token, or null when neither secret is set. */
export async function pipelineTickToken(env: Env = process.env): Promise<string | null> {
  const secret = env.CRON_SECRET || env.DATABASE_URL;
  return secret ? sha256hex(`winning-product-hunter:pipeline-tick:${secret}`) : null;
}

function bearer(header: string | null): string | null {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  return m ? m[1] : null;
}

/** Compares hashes, so the comparison time depends on neither value's length. */
async function sameSecret(given: string | null, expected: string): Promise<boolean> {
  return given !== null && safeEqual(await sha256hex(given), await sha256hex(expected));
}

export async function checkPipelineAuth(
  header: string | null,
  env: Env = process.env,
): Promise<InternalAuth> {
  const token = await pipelineTickToken(env);
  if (!token) return "unconfigured";
  return (await sameSecret(bearer(header), token)) ? "ok" : "unauthorized";
}

export function isCronConfigured(env: Env = process.env): boolean {
  return Boolean(env.CRON_SECRET);
}

export async function checkCronAuth(
  header: string | null,
  env: Env = process.env,
): Promise<InternalAuth> {
  if (!env.CRON_SECRET) return "unconfigured";
  return (await sameSecret(bearer(header), env.CRON_SECRET)) ? "ok" : "unauthorized";
}
