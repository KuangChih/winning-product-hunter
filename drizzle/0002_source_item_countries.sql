ALTER TABLE "source_items" ADD COLUMN "countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "source_items_countries_idx" ON "source_items" USING gin ("countries");--> statement-breakpoint
-- Backfill from the region reported by each source (mirrors toCountries in src/lib/markets.ts).
UPDATE "source_items" SET "countries" = CASE upper("region")
  WHEN 'EU' THEN ARRAY['DE','FR','SE','BE','ES']
  WHEN 'EEA' THEN ARRAY['DE','FR','SE','BE','ES','NO']
  WHEN 'UK' THEN ARRAY['GB']
  ELSE ARRAY[upper("region")]
END
WHERE "region" IS NOT NULL AND upper("region") NOT IN ('', 'WORLDWIDE', 'ALL');
