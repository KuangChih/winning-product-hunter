-- Advertiser own-listing rows (shopify_catalog_lookup) move to their own external id namespace
-- ("lookup|<product gid>|<country>"), so a Shopify search returning the same product no longer
-- overwrites them (same source, same external id). Rows whose new id is already taken are left
-- as they are (idempotent, never deletes).
UPDATE "source_items" AS s
SET "external_id" = 'lookup|' || s."external_id"
WHERE s."provider" = 'shopify_catalog_lookup'
  AND s."external_id" NOT LIKE 'lookup|%'
  AND NOT EXISTS (
    SELECT 1 FROM "source_items" AS t
    WHERE t."source" = s."source" AND t."external_id" = 'lookup|' || s."external_id"
  );
