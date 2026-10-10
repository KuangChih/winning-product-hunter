/**
 * Fetches today's ECB reference exchange rates and stores them.
 *
 *   npm run fx
 */
import "@/lib/load-env";
import { saveFxRates } from "@/data/fx";
import { getDb } from "@/db/client";
import { fetchWithRetry } from "@/ingestion/http";
import { ECB_DAILY_URL, parseEcbDaily } from "@/lib/fx";
import { runJob } from "./run-job";

async function main() {
  const res = await fetchWithRetry(ECB_DAILY_URL);
  const rates = parseEcbDaily(await res.text());
  const n = await saveFxRates(await getDb(), rates);
  console.log(`stored ${n} ECB rates for ${rates.date}`);
}

runJob(main);
