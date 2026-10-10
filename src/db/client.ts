import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema (Neon in production, PGlite in dev/tests). */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/** `DATABASE_URL=pglite:./.data/dev` runs a local file-backed Postgres for demos without Neon. */
const PGLITE_PREFIX = "pglite:";

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

interface Connection {
  db: AnyDatabase;
  close: () => Promise<void>;
}

async function connectPglite(dir: string): Promise<Connection> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = path.resolve(dir);
  await mkdir(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return { db: db as unknown as AnyDatabase, close: () => client.close() };
}

/** A Neon HTTP query that has not answered by then fails instead of hanging the process. */
export const NEON_QUERY_TIMEOUT_MS = 20_000;

/** Migrations run in their own process (`npm run db:migrate`, Vercel build). */
export const NEON_MIGRATION_TIMEOUT_MS = 10 * 60_000;

/** Wraps fetch so every request also aborts after `timeoutMs`. */
export function fetchWithTimeout(
  timeoutMs: number,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, signal });
  };
}

// Global to the Neon driver: applies to every HTTP query of this process.
neonConfig.fetchFunction = fetchWithTimeout(NEON_QUERY_TIMEOUT_MS);

export function createNeonDb(databaseUrl: string): AnyDatabase {
  return drizzle(neon(databaseUrl), { schema }) as unknown as AnyDatabase;
}

/**
 * One connection per process, kept on `globalThis`: Next.js bundles pages and route handlers
 * separately, each with its own copy of this module. With PGlite two copies would open the same
 * directory as two independent in-memory databases, and a page would never see what a route
 * (e.g. a discovery tick) wrote.
 */
const CACHE_KEY = Symbol.for("winning-product-hunter.db");
/** The connection and the URL it was made for (a changed DATABASE_URL gets a new one). */
type DbCache = { [CACHE_KEY]?: { url: string; connection: Promise<Connection> } };
const store = globalThis as DbCache;

/** Lazily connects so that builds and tests never need DATABASE_URL. */
export async function getDb(): Promise<AnyDatabase> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  let cached = store[CACHE_KEY];
  if (!cached || cached.url !== url) {
    // Release the connection made for the old URL (PGlite keeps a database open).
    cached?.connection.then((c) => c.close()).catch(() => {});
    const connection = url.startsWith(PGLITE_PREFIX)
      ? connectPglite(url.slice(PGLITE_PREFIX.length))
      : Promise.resolve({ db: createNeonDb(url), close: async () => {} });
    cached = { url, connection };
    store[CACHE_KEY] = cached;
    // A failed connect must not stick: the next call tries again.
    connection.catch(() => {
      if (store[CACHE_KEY]?.connection === connection) store[CACHE_KEY] = undefined;
    });
  }
  return (await cached.connection).db;
}

/**
 * Applies pending migrations from `drizzle/`. PGlite databases are migrated on connect;
 * Neon databases are migrated here (run on every Vercel build, see docs/DEPLOY.md).
 */
export async function migrateDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  if (url.startsWith(PGLITE_PREFIX)) {
    await getDb();
    return;
  }
  const { migrate } = await import("drizzle-orm/neon-http/migrator");
  // A migration (e.g. building an index on a grown table) may legitimately take minutes; a
  // client-side abort would report failure for a change the server still commits.
  neonConfig.fetchFunction = fetchWithTimeout(NEON_MIGRATION_TIMEOUT_MS);
  const db = drizzle(neon(url), { schema });
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
}

/** Postgres "undefined_table": the schema has not been migrated yet. */
export function isMissingTableError(err: unknown): boolean {
  for (let e = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "42P01") return true;
  }
  return false;
}

/** Releases the connection so CLI jobs can exit (PGlite keeps the process alive). */
export async function closeDb(): Promise<void> {
  const cached = store[CACHE_KEY];
  if (!cached) return;
  store[CACHE_KEY] = undefined;
  await (await cached.connection).close();
}
