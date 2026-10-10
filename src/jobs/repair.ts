/**
 * One-off data repairs.
 *
 *   npm run repair -- ad-attachments            (dry run: report only)
 *   npm run repair -- ad-attachments --apply    (fix, then re-score)
 *   npm run repair -- product-images            (dry run: report only)
 *   npm run repair -- product-images --apply    (clear wrong photos; `npm run dedupe` re-hashes)
 *   npm run repair -- store-listings            (dry run: report only)
 *   npm run repair -- store-listings --apply    (clear lookup attempts; the next pipeline re-queries)
 *
 * ad-attachments: Ad Library ads that a keyword search attached to the wrong product move to
 * the product whose page they link to, or are dropped (they are re-collected by discovery).
 *
 * product-images: products whose photo came from a Shopify search result (a similar product
 * from another store) lose that photo and its hash; the next dedupe uses the advertiser's own
 * listing photo, or leaves the product without one.
 *
 * store-listings: products whose advertiser listing (own price, ADR-012) was overwritten by a
 * Shopify search result have their lookup attempts cleared, so the next pipeline run looks them
 * up again (see `repairStoreListings` for the rule).
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { repairAdAttachments, repairProductImages, repairStoreListings } from "@/matching/repair";
import { runScoring } from "@/scoring/run";
import { runJob } from "./run-job";

async function main() {
  const [task, ...flags] = process.argv.slice(2);
  if (task !== "ad-attachments" && task !== "product-images" && task !== "store-listings")
    throw new Error(
      "Usage: npm run repair -- <ad-attachments|product-images|store-listings> [--apply]",
    );
  const apply = flags.includes("--apply");
  const db = await getDb();
  if (task === "store-listings") {
    const r = await repairStoreListings(db, { apply });
    console.log(
      `${apply ? "repaired" : "dry run"}: ${r.affected} products have an advertiser page stored ` +
        `only as a search result (${r.withoutOwnListing} without any own listing, ` +
        `${r.stillFresh} still fresh from another page and re-queried later)` +
        (apply ? `; ${r.attemptsCleared} lookup attempts cleared, run \`npm run pipeline\`` : ""),
    );
    return;
  }
  if (task === "product-images") {
    const r = await repairProductImages(db, { apply });
    console.log(
      `${apply ? "repaired" : "dry run"}: ${r.wrongImages} products show a photo that is not ` +
        `from their own listing or ads (${r.withOwnListingPhoto} have an own-listing photo); ` +
        `${r.mergedIntoAffected} earlier merges involved them (not undone)` +
        (apply ? `; ${r.reset} reset, run \`npm run dedupe\` to hash the right photos` : ""),
    );
    return;
  }
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
