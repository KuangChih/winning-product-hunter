CREATE TABLE "login_failures" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_hash" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failures_client_time_idx" ON "login_failures" USING btree ("client_hash","failed_at");--> statement-breakpoint
CREATE INDEX "login_failures_time_idx" ON "login_failures" USING btree ("failed_at");