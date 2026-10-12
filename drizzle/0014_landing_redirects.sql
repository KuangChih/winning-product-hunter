CREATE TABLE "landing_redirects" (
	"url" text PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"final_url" text,
	"status" integer,
	"checked_at" timestamp with time zone NOT NULL
);
