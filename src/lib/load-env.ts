import { loadEnvConfig } from "@next/env";

/**
 * Loads `.env*` files for CLI jobs the same way Next.js does (`.env.local` included), so
 * scripts and the app always see the same configuration. Variables already set in the
 * environment (e.g. on Vercel or in CI) take precedence.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
