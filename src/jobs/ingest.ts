/**
 * Ingestion CLI. Runs locally, in GitHub Actions, or behind a Vercel Cron trigger (ADR-003).
 *
 *   npm run ingest -- <source|all> [--fixture] [--dry-run] [--limit=N] [--query=term ...]
 *
 * --fixture uses sample data instead of live APIs (the only mode until adapters land).
 * --dry-run prints parsed items instead of writing to the database.
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import type { Source, SourceAdapter } from "@/ingestion/types";
import { runJob } from "./run-job";

export interface IngestArgs {
  sources: string[];
  fixture: boolean;
  dryRun: boolean;
  limit: number;
  queries: string[];
}

export function parseArgs(argv: string[]): IngestArgs {
  const args: IngestArgs = { sources: [], fixture: false, dryRun: false, limit: 500, queries: [] };
  for (const a of argv) {
    if (a === "--fixture") args.fixture = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--query=")) args.queries.push(a.slice("--query=".length));
    else if (a.startsWith("--")) throw new Error(`Unknown flag ${a}`);
    else args.sources.push(a);
  }
  if (args.sources.length === 0) throw new Error("Specify a source or 'all'.");
  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be > 0");
  return args;
}

export function resolveAdapters(args: IngestArgs): SourceAdapter[] {
  if (!args.fixture) {
    throw new Error("Live adapters are not implemented yet; pass --fixture.");
  }
  const names = args.sources.includes("all")
    ? (Object.keys(fixtureAdapters) as Source[])
    : args.sources;
  return names.map((name) => {
    const make = fixtureAdapters[name as Source];
    if (!make) {
      throw new Error(`No fixture for '${name}'. Available: ${Object.keys(fixtureAdapters)}`);
    }
    return make();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adapters = resolveAdapters(args);
  const ctx = { queries: args.queries, limit: args.limit };

  let failed = false;
  for (const adapter of adapters) {
    const label = `${adapter.source}/${adapter.provider}`;
    if (args.dryRun) {
      let n = 0;
      for await (const item of adapter.fetch(ctx)) {
        n++;
        console.log(`${label}\t${item.externalId}\t${item.title ?? ""}\t${item.metrics.length}m`);
      }
      console.log(`${label}: ${n} items (dry run)`);
      continue;
    }
    const result = await runIngestion(await getDb(), adapter, ctx);
    console.log(`${label}: ${result.status}, ${result.itemsFetched} items, run #${result.runId}`);
    if (result.status === "failed") {
      failed = true;
      console.error(`${label}: ${result.error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/ingest.ts")) {
  runJob(main);
}
