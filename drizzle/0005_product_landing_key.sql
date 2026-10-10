ALTER TABLE "products" ADD COLUMN "landing_key" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "canonical_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_landing_key_idx" ON "products" USING btree ("landing_key");