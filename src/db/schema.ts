import { sql } from "drizzle-orm";
import {
  bigint,
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
// Type-only and relative: drizzle-kit loads this file without the "@/" alias.
import type { RunOptions, RunState, StagedItem } from "../pipeline/runner/types";

/** Where a signal comes from (see docs/research/first-party-sources.md). */
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

/**
 * Products the user follows. Single list while the site is personal (ADR-008); a user_id joins
 * the key when multi-user accounts arrive (Phase 5).
 */
export const watchlist = pgTable("watchlist", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  /** Winning Score when the product was added, to show the change since then. */
  scoreAtAdd: real("score_at_add"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Failed site-password attempts, for login throttling (ADR-010). Stores a salted hash of the
 * client IP, never the IP itself; rows older than a day are pruned.
 */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientHash: text("client_hash").notNull(),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_failures_client_time_idx").on(t.clientHash, t.failedAt),
    index("login_failures_time_idx").on(t.failedAt),
  ],
);

export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const pipelineTriggerEnum = pgEnum("pipeline_trigger", ["web", "cron", "cli"]);

/**
 * One run of the daily real-data pipeline, executed in resumable units (ADR-013): the web
 * button, Vercel Cron and the CLI all drive the same row. `state` holds the cursor, plan and
 * progress; `lock_token` / `locked_until` is the lease of the process currently working on it.
 */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    trigger: pipelineTriggerEnum("trigger").notNull(),
    status: pipelineRunStatusEnum("status").notNull().default("running"),
    /** Where the run was created ("production", "local"…); others never resume it. */
    env: text("env").notNull(),
    /** What the run was asked to do (keywords, advertisers, collect size, countries). */
    options: jsonb("options").$type<RunOptions>().notNull(),
    /** Versioned run state (cursor, plan, progress, rate limits, step results). */
    state: jsonb("state").$type<RunState>().notNull(),
    lockToken: uuid("lock_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ticks: integer("ticks").notNull().default(0),
    /** Ad Library requests reserved by this run (counted before each request is sent). */
    adLibraryRequests: integer("ad_library_requests").notNull().default(0),
    lastKickError: text("last_kick_error"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // No $onUpdate: always set to now() in SQL, so every writer uses the database clock.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // At most one active run at a time.
    uniqueIndex("pipeline_runs_one_running_idx")
      .on(t.status)
      .where(sql`"status" = 'running'`),
    index("pipeline_runs_created_idx").on(t.createdAt.desc()),
  ],
);

/**
 * Items fetched by one Ad Library request of a run, kept until the run's discovery step
 * groups them all together (a product is "promising" across every keyword of the sweep).
 */
export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    /** "keyword" or "advertiser". */
    bucket: text("bucket").notNull(),
    /** Position of the request in the run's plan. */
    idx: integer("idx").notNull(),
    items: jsonb("items").$type<StagedItem[]>().notNull(),
    /** Why the request failed (the sweep ends there), if it did. */
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.bucket, t.idx] })],
);

/**
 * Last collection attempt per provider and product, so products that gave nothing (or whose
 * photo failed to download) are not picked again ahead of products never tried.
 */
export const collectionAttempts = pgTable(
  "collection_attempts",
  {
    /** "shopify_catalog", "shopify_catalog_lookup", "image_hash"… */
    provider: text("provider").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    outcome: text("outcome").$type<"found" | "empty" | "error">().notNull(),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.productId] }),
    index("collection_attempts_time_idx").on(t.provider, t.attemptedAt),
  ],
);

/**
 * A source that blocked us (CAPTCHA, 403/429, login wall): no requests until `until` (ADR-006).
 * Keyed by egress ("vercel", "github", "local") so a block of the server's IPs does not stop the
 * user's own machine. `strikes` escalates the wait on repeated blocks and resets on success.
 */
export const sourceBackoff = pgTable(
  "source_backoff",
  {
    provider: text("provider").notNull(),
    egress: text("egress").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
    strikes: integer("strikes").notNull().default(1),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.egress] })],
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
    /** The pipeline run that started it; null for standalone CLI jobs. */
    pipelineRunId: bigint("pipeline_run_id", { mode: "number" }).references(() => pipelineRuns.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("ingestion_runs_source_time_idx").on(t.source, t.startedAt.desc()),
    index("ingestion_runs_pipeline_run_idx").on(t.pipelineRunId),
  ],
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
