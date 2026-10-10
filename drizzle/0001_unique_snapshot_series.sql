-- Remove duplicate snapshots (same item, metric and instant) created by re-fetching
-- historical series before this constraint existed; keep the earliest row.
DELETE FROM "signal_snapshots" a USING "signal_snapshots" b
WHERE a."source_item_id" = b."source_item_id"
  AND a."metric" = b."metric"
  AND a."observed_at" = b."observed_at"
  AND a."id" > b."id";--> statement-breakpoint
DROP INDEX "signal_snapshots_series_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "signal_snapshots_series_idx" ON "signal_snapshots" USING btree ("source_item_id","metric","observed_at");
