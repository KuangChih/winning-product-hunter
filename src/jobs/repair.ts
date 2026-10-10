/**
 * One-off data repairs.
 *
 *   npm run repair -- ad-attachments            (dry run: report only)
 *   npm run repair -- ad-attachments --apply    (fix, then re-score)
 *
 * ad-attachments: Ad Library ads that a keyword search attached to the wrong product move to
 * the product whose page they link to, or are dropped (they are re-collected by discovery).
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { repairAdAttachments } from "@/matching/repair";
import { runScoring } from "@/scoring/run";
import { runJob } from "./run-job";

async function main() {
  const [task, ...flags] = process.argv.slice(2);
  if (task !== "ad-attachments")
    throw new Error("Usage: npm run repair -- ad-attachments [--apply]");
  const apply = flags.includes("--apply");
  const db = await getDb();
  const r = await repairAdAttachments(db, { apply });
  console.log(
    `${apply ? "repaired" : "dry run"}: ${r.mismatched} mismatched ads on ${r.affectedProducts} products ` +
      `(${r.moved} moved, ${r.dropped} dropped), ${r.emptiedProducts} empty products removed`,
  );
  if (apply && r.mismatched > 0) {
    const scored = await runScoring(db);
    console.log(`re-scored ${scored.productsScored} products`);
  }
}

runJob(main);
