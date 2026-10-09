/**
 * Applies database migrations.
 *
 *   npm run db:migrate                  # fails if DATABASE_URL is missing
 *   tsx src/jobs/migrate.ts --if-configured   # used by `vercel-build`; skips without a database
 */
import "@/lib/load-env";
import { isDatabaseConfigured, migrateDb } from "@/db/client";
import { runJob } from "./run-job";

async function main() {
  if (process.argv.includes("--if-configured") && !isDatabaseConfigured()) {
    console.warn("DATABASE_URL is not set; skipping migrations.");
    return;
  }
  await migrateDb();
  console.log("migrations applied");
}

runJob(main);
