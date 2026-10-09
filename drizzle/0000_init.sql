CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('meta_ads', 'tiktok_ads', 'tiktok_creative_center', 'google_ads', 'google_trends', 'aliexpress', 'amazon', 'cj', 'shopify');--> statement-breakpoint
CREATE TYPE "public"."source_item_kind" AS ENUM('ad', 'video', 'listing', 'trend', 'store_product');--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" "source" NOT NULL,
	"provider" text NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "product_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"scoring_version" text NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"breakdown" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"image_url" text,
	"image_hash" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_item_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" "source_item_kind" NOT NULL,
	"product_id" uuid,
	"title" text,
	"url" text,
	"image_url" text,
	"region" text,
	"advertiser_id" text,
	"advertiser_name" text,
	"format" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"price_cents" integer,
	"currency" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_scores" ADD CONSTRAINT "product_scores_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_snapshots" ADD CONSTRAINT "signal_snapshots_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_time_idx" ON "ingestion_runs" USING btree ("source","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_scores_product_time_idx" ON "product_scores" USING btree ("product_id","computed_at");--> statement-breakpoint
CREATE INDEX "product_scores_rank_idx" ON "product_scores" USING btree ("computed_at","score");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_image_hash_idx" ON "products" USING btree ("image_hash");--> statement-breakpoint
CREATE INDEX "signal_snapshots_series_idx" ON "signal_snapshots" USING btree ("source_item_id","metric","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_items_source_external_idx" ON "source_items" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "source_items_product_idx" ON "source_items" USING btree ("product_id");