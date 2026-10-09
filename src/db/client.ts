import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/** Any Drizzle Postgres database with our schema (Neon in production, PGlite in tests). */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

let cached: Database | undefined;

/** Lazily connects so that builds and tests never need DATABASE_URL. */
export function getDb(): Database {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
    cached = createDb(url);
  }
  return cached;
}
