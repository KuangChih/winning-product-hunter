/**
 * Loads SAMPLE data end to end: ingest every fixture source, match, then score.
 * For local demos and preview environments; never point this at production data.
 *
 *   npm run seed
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { runJob } from "./run-job";

async function main() {
  const db = await getDb();
  for (const make of Object.values(fixtureAdapters)) {
    const adapter = make();
    const result = await runIngestion(db, adapter, { queries: [], limit: 500 });
    console.log(
      `${adapter.source}/${adapter.provider}: ${result.status}, ${result.itemsFetched} items`,
    );
    if (result.status === "failed") throw new Error(result.error);
  }
  const matched = await runMatching(db);
  console.log(`matched ${matched.itemsMatched} items, created ${matched.productsCreated} products`);
  const { productsScored } = await runScoring(db);
  console.log(`scored ${productsScored} products`);
}

runJob(main);
