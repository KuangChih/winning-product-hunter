/**
 * Scoring CLI: computes Winning Scores for all matched products.
 *
 *   npm run score
 */
import "dotenv/config";
import { getDb } from "@/db/client";
import { runScoring } from "@/scoring/run";
import { runJob } from "./run-job";

async function main() {
  const { productsScored } = await runScoring(await getDb());
  console.log(`scored ${productsScored} products`);
}

runJob(main);
