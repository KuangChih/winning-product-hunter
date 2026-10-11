/**
 * The runner's real sources (ADR-006 rules: honest User-Agent, Meta spaced 5 s apart by the
 * runner, stop on block). No env loading here: routes import it; CLI jobs load `.env.local`.
 */
import { fetchWithRetry } from "@/ingestion/http";
import { createCjClient, CJ_PROVIDER } from "@/ingestion/sources/cj";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import { createMetaApiClient } from "@/ingestion/sources/meta-ads";
import {
  createShopifyCatalogAdapter,
  createStoreLookupAdapter,
} from "@/ingestion/sources/shopify-catalog";
import { createDbTokenStore } from "@/ingestion/token-store";
import { ECB_DAILY_URL, parseEcbDaily } from "@/lib/fx";
import type { RunnerDeps } from "./runner/deps";

type Env = Record<string, string | undefined>;

/** Per-attempt timeouts, so one hung socket cannot hold a tick. */
export const TIMEOUTS = {
  adLibrary: 30_000,
  metaApi: 30_000,
  shopify: 20_000,
  ecb: 15_000,
  cj: 15_000,
} as const;

/**
 * Where requests leave from: Meta blocking Vercel's (or GitHub's) IPs must not stop the user's
 * own machine, and the other way round.
 */
export function pipelineEgress(env: Env = process.env): string {
  return env.VERCEL ? "vercel" : env.GITHUB_ACTIONS ? "github" : "local";
}

/** Which deployment created a run ("production", "preview"…, "github" or "local"). */
export function pipelineEnv(env: Env = process.env): string {
  if (env.VERCEL) return env.VERCEL_ENV || "preview";
  return env.GITHUB_ACTIONS ? "github" : "local";
}

/** `fetchImpl` replaces the network (tests). */
export function createLiveDeps(
  env: Env = process.env,
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
): RunnerDeps {
  const profile = env.SHOPIFY_UCP_AGENT_PROFILE || undefined;
  const cjKey = env.CJ_API_KEY?.trim() || undefined;
  const metaToken = env.META_ACCESS_TOKEN?.trim() || undefined;
  return {
    egress: pipelineEgress(env),
    async fetchFxRates(signal) {
      const res = await fetchWithRetry(
        ECB_DAILY_URL,
        { signal },
        { timeoutMs: TIMEOUTS.ecb, fetchImpl },
      );
      return parseEcbDaily(await res.text());
    },
    adLibrary: ({ mode, countries }) =>
      createAdLibraryWebAdapter({
        mode,
        countries,
        // The runner sends exactly one request per unit and spaces them itself. No retries: a
        // retry would be an uncounted request, and a 429 means stop and back off (ADR-006).
        maxRequests: 1,
        retry: { timeoutMs: TIMEOUTS.adLibrary, retries: 0, fetchImpl },
      }),
    // Official Ad Library API (ADR-015): one attempt per request, the token only in the
    // environment (never in errors, logs or stored URLs).
    ...(metaToken
      ? {
          metaApi: () =>
            createMetaApiClient({
              token: metaToken,
              retry: { timeoutMs: TIMEOUTS.metaApi, retries: 0, fetchImpl },
            }),
        }
      : {}),
    // The key stays in the environment; the cached token is encrypted with it (ADR-014).
    ...(cjKey
      ? {
          cj: (db) =>
            createCjClient({
              apiKey: cjKey,
              tokens: createDbTokenStore(db, CJ_PROVIDER, cjKey),
              // One attempt per request: a CJ refusal stops the step (no retry storm).
              retry: { timeoutMs: TIMEOUTS.cj, retries: 0, fetchImpl },
            }),
        }
      : {}),
    shopifyCatalog: ({ countries, wait }) =>
      createShopifyCatalogAdapter({
        countries,
        profile,
        wait,
        retry: { timeoutMs: TIMEOUTS.shopify, fetchImpl },
      }),
    storeLookup: ({ country, wait }) =>
      createStoreLookupAdapter({
        country,
        profile,
        wait,
        retry: { timeoutMs: TIMEOUTS.shopify, fetchImpl },
      }),
  };
}
