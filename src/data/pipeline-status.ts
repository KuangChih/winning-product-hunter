/**
 * Discovery status for server-rendered pages: the same JSON as `GET /api/pipeline/status`
 * (without the watchdog, which only the poll runs), so the page's first paint and the poll agree.
 */
import { getDb, isDatabaseConfigured, isMissingTableError, type AnyDatabase } from "@/db/client";
import { toRunProgress, type RunProgress } from "@/pipeline/progress";
import { listRecentRuns } from "@/pipeline/runner";
import { loadProgress, toStatus, type PipelineStatus } from "@/pipeline/web";

type Env = Record<string, string | undefined>;

export async function getPipelineStatus(
  env: Env = process.env,
  db?: AnyDatabase,
): Promise<PipelineStatus> {
  if (!db && !isDatabaseConfigured()) {
    return toStatus(null, { configured: false, migrated: false }, env);
  }
  try {
    const progress = await loadProgress(db ?? (await getDb()), env);
    return toStatus(progress, { configured: true, migrated: true }, env);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return toStatus(null, { configured: true, migrated: false }, env);
  }
}

/** The last runs, newest first; empty without a database or before the tables exist. */
export async function getRecentRuns(
  limit = 10,
  db?: AnyDatabase,
  now = Date.now(),
): Promise<RunProgress[]> {
  if (!db && !isDatabaseConfigured()) return [];
  try {
    const rows = await listRecentRuns(db ?? (await getDb()), limit);
    return rows.map((r) => toRunProgress(r, now));
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return [];
  }
}
