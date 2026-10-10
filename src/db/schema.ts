import { sql } from "drizzle-orm";
import {
  bigserial,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Where a signal comes from (see docs/research/data-sources.md). */
export const sourceEnum = pgEnum("source", [
  "meta_ads",
  "tiktok_ads",
  "tiktok_creative_center",
  "google_ads",
  "google_trends",
  /** Deprecated (ADR-005): kept only because Postgres enums cannot drop values. */
  "aliexpress",
  "amazon",
  "cj",
  "shopify",
]);

export const sourceItemKindEnum = pgEnum("source_item_kind", [
  "ad",
  "video",
  "listing",
  "trend",
  "store_product",
]);

export const ingestionStatusEnum = pgEnum("ingestion_status", ["running", "succeeded", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** A resolved product: one real-world item that many source items may point at. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    imageUrl: text("image_url"),
    /**
     * Product key from ad landing pages (see src/discovery/landing.ts), set for products found
     * by discovery so repeated sweeps update the same product instead of creating duplicates.
     */
    landingKey: text("landing_key"),
    /** A representative product page URL. */
    canonicalUrl: text("canonical_url"),
    /**
     * Set when this product was found to be a duplicate of another (e.g. same photo under a
     * different handle). Its evidence moves to that product; the row stays so its landing key
     * keeps resolving to the surviving product.
     */
    mergedInto: uuid("merged_into"),
    /** Perceptual hash of the primary image, hex encoded (entity resolution stage 1). */
    imageHash: text("image_hash"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    uniqueIndex("products_landing_key_idx").on(t.landingKey),
    index("products_image_hash_idx").on(t.imageHash),
  ],
);

/**
 * One observation from a source: an ad, a video, a marketplace listing, a trend series.
 * Raw payload is kept so the UI can show evidence and so we can re-parse later.
 */
export const sourceItems = pgTable(
  "source_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: sourceEnum("source").notNull(),
    /** Who supplied the data: "official", "apify", "serpapi", "fixture"... */
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    kind: sourceItemKindEnum("kind").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    title: text("title"),
    url: text("url"),
    imageUrl: text("image_url"),
    /** Region as reported by the source: ISO 3166-1 alpha-2 country or a code such as "EU". */
    region: text("region"),
    /** ISO 3166-1 alpha-2 countries this item applies to (see src/lib/markets.ts). */
    countries: text("countries")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    advertiserId: text("advertiser_id"),
    advertiserName: text("advertiser_name"),
    /** Creative format for ads: "video", "image", "carousel". */
    format: text("format"),
    /** When the ad/listing started running according to the source. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** When it stopped; null while still active. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    priceCents: integer("price_cents"),
    currency: text("currency"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").$type<unknown>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("source_items_source_external_idx").on(t.source, t.externalId),
    index("source_items_product_idx").on(t.productId),
    index("source_items_countries_idx").using("gin", t.countries),
  ],
);

/**
 * Append-only time series of metric values (views, likes, orders, trend index, BSR...).
 * Never updated in place: back-testing depends on historical snapshots (ADR-002).
 */
export const signalSnapshots = pgTable(
  "signal_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  // One value per item, metric and instant: re-fetching a historical series must not duplicate it.
  (t) => [uniqueIndex("signal_snapshots_series_idx").on(t.sourceItemId, t.metric, t.observedAt)],
);

/** A computed Winning Score with its full breakdown so the UI can explain it. */
export const productScores = pgTable(
  "product_scores",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    scoringVersion: text("scoring_version").notNull(),
    score: real("score").notNull(),
    confidence: real("confidence").notNull(),
    breakdown: jsonb("breakdown").$type<unknown>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_scores_product_time_idx").on(t.productId, t.computedAt),
    index("product_scores_rank_idx").on(t.computedAt, t.score),
  ],
);

/** One run of an ingestion job, for the source health dashboard. */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: sourceEnum("source").notNull(),
    provider: text("provider").notNull(),
    status: ingestionStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    itemsFetched: integer("items_fetched").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("ingestion_runs_source_time_idx").on(t.source, t.startedAt.desc())],
);

/** Daily reference exchange rates from the European Central Bank (units of currency per EUR). */
export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    perEur: doublePrecision("per_eur").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.currency] })],
);
