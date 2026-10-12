CREATE TABLE "product_photos" (
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"hash" text,
	"hashed_at" timestamp with time zone,
	CONSTRAINT "product_photos_product_id_url_pk" PRIMARY KEY("product_id","url")
);
--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;