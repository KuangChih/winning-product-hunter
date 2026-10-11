CREATE TABLE "cj_landed_costs" (
	"product_id" uuid NOT NULL,
	"country" text NOT NULL,
	"cj_pid" text NOT NULL,
	"vid" text NOT NULL,
	"variant_key" text NOT NULL,
	"variant_price_cents" integer NOT NULL,
	"weight_g" integer,
	"variant_basis" text NOT NULL,
	"matched_variants" integer NOT NULL,
	"total_variants" integer NOT NULL,
	"carrier" text,
	"freight_cents" integer,
	"min_days" integer,
	"max_days" integer,
	"shipping_options" integer NOT NULL,
	"max_days_allowed" integer NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cj_landed_costs_product_id_country_pk" PRIMARY KEY("product_id","country")
);
--> statement-breakpoint
ALTER TABLE "cj_landed_costs" ADD CONSTRAINT "cj_landed_costs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;