CREATE TYPE "public"."pipeline_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pipeline_trigger" AS ENUM('web', 'cron', 'cli');--> statement-breakpoint
CREATE TABLE "collection_attempts" (
	"provider" text NOT NULL,
	"product_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	CONSTRAINT "collection_attempts_provider_product_id_pk" PRIMARY KEY("provider","product_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trigger" "pipeline_trigger" NOT NULL,
	"status" "pipeline_run_status" DEFAULT 'running' NOT NULL,
	"env" text NOT NULL,
	"options" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"lock_token" uuid,
	"locked_until" timestamp with time zone,
	"ticks" integer DEFAULT 0 NOT NULL,
	"ad_library_requests" integer DEFAULT 0 NOT NULL,
	"last_kick_error" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"run_id" bigint NOT NULL,
	"bucket" text NOT NULL,
	"idx" integer NOT NULL,
	"items" jsonb NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stage_run_id_bucket_idx_pk" PRIMARY KEY("run_id","bucket","idx")
);
--> statement-breakpoint
CREATE TABLE "source_backoff" (
	"provider" text NOT NULL,
	"egress" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"strikes" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_backoff_provider_egress_pk" PRIMARY KEY("provider","egress")
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "pipeline_run_id" bigint;--> statement-breakpoint
ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_attempts_time_idx" ON "collection_attempts" USING btree ("provider","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_one_running_idx" ON "pipeline_runs" USING btree ("status") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "pipeline_runs_created_idx" ON "pipeline_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_runs_pipeline_run_idx" ON "ingestion_runs" USING btree ("pipeline_run_id");