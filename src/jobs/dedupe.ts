/**
 * Finds duplicate products by product photo (dHash) and merges them.
 *
 *   npm run dedupe
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { hashProductImages, mergeDuplicateProducts } from "@/matching/merge";
import { runJob } from "./run-job";

async function main() {
  const db = await getDb();
  const { hashed, failed, skipped } = await hashProductImages(db, { limit: 500 });
  const { merged } = await mergeDuplicateProducts(db);
  console.log(
    `${hashed} images hashed (${failed} failed, ${skipped} without a usable photo), ` +
      `${merged} duplicates merged`,
  );
}

runJob(main);
