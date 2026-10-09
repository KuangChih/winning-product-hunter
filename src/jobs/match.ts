/**
 * Entity resolution CLI: assigns unmatched source items to products.
 *
 *   npm run match
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { runMatching } from "@/matching/run";
import { runJob } from "./run-job";

async function main() {
  const result = await runMatching(await getDb());
  console.log(
    `matched ${result.itemsMatched} items, created ${result.productsCreated} products, ` +
      `${result.itemsUnmatched} left unmatched`,
  );
}

runJob(main);
