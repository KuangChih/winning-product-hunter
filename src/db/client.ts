import { neon } from "@neondatabase/serverless";
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

export function createNeonDb(databaseUrl: string): AnyDatabase {
  return drizzle(neon(databaseUrl), { schema }) as unknown as AnyDatabase;
}

let cached: Promise<Connection> | undefined;

/** Lazily connects so that builds and tests never need DATABASE_URL. */
export async function getDb(): Promise<AnyDatabase> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
    cached = url.startsWith(PGLITE_PREFIX)
      ? connectPglite(url.slice(PGLITE_PREFIX.length))
      : Promise.resolve({ db: createNeonDb(url), close: async () => {} });
  }
  return (await cached).db;
}

/** Releases the connection so CLI jobs can exit (PGlite keeps the process alive). */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  const conn = await cached;
  cached = undefined;
  await conn.close();
}
