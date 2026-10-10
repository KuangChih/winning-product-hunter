import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, signalSnapshots, sourceItems } from "@/db/schema";
import { getLatestFxRates } from "@/data/fx";
import {
  extractFeatures,
  MOMENTUM_MAX_BASELINE_DAYS,
  type AdDays,
  type ItemInput,
} from "./features";
import { SCORING_VERSION, scoreProducts } from "./score";

type Snapshot = ItemInput["snapshots"][number];

/** Rows returned by `db.execute`, for both PGlite and neon-http. */
function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/**
 * The snapshots scoring reads, reduced in SQL so the response stays small as the append-only
 * history grows (see `extractFeatures`):
 * - the latest value of every metric of every attached item;
 * - the whole `search_interest` series of trend items (trend slope);
 * - per product, how many ads were observed on each of the latest collection days (momentum).
 */
async function loadSnapshots(db: AnyDatabase) {
  const attached = and(
    eq(sourceItems.id, signalSnapshots.sourceItemId),
    isNotNull(sourceItems.productId),
  );
  const [latest, series, days] = await Promise.all([
    db
      .selectDistinctOn([signalSnapshots.sourceItemId, signalSnapshots.metric], {
        itemId: signalSnapshots.sourceItemId,
        kind: sourceItems.kind,
        metric: signalSnapshots.metric,
        value: signalSnapshots.value,
        observedAt: signalSnapshots.observedAt,
      })
      .from(signalSnapshots)
      .innerJoin(sourceItems, attached)
      .orderBy(
        signalSnapshots.sourceItemId,
        signalSnapshots.metric,
        sql`${signalSnapshots.observedAt} desc`,
      ),
    db
      .select({
        itemId: signalSnapshots.sourceItemId,
        value: signalSnapshots.value,
        observedAt: signalSnapshots.observedAt,
      })
      .from(signalSnapshots)
      .innerJoin(sourceItems, attached)
      .where(and(eq(sourceItems.kind, "trend"), eq(signalSnapshots.metric, "search_interest"))),
    db.execute(sql`
      select product_id, ads, total from (
        select product_id, day, ads,
          row_number() over (partition by product_id order by day desc) as rn,
          count(*) over (partition by product_id) as total
        from (
          select si.product_id, (ss.observed_at at time zone 'UTC')::date as day,
            count(distinct si.id) as ads
          from ${signalSnapshots} ss
          join ${sourceItems} si on si.id = ss.source_item_id
          where si.product_id is not null and si.kind = 'ad' and si.started_at is not null
          group by 1, 2
        ) per_day
      ) ranked
      where rn <= ${MOMENTUM_MAX_BASELINE_DAYS + 1}
      order by product_id, rn desc`),
  ]);

  const snapsByItem = new Map<string, Snapshot[]>();
  const add = (itemId: string, s: Snapshot) => {
    const list = snapsByItem.get(itemId);
    if (list) list.push(s);
    else snapsByItem.set(itemId, [s]);
  };
  for (const s of latest) {
    // Trend series are loaded whole below.
    if (s.kind === "trend" && s.metric === "search_interest") continue;
    add(s.itemId, { metric: s.metric, value: s.value, observedAt: s.observedAt });
  }
  for (const s of series) {
    add(s.itemId, { metric: "search_interest", value: s.value, observedAt: s.observedAt });
  }

  const adDaysByProduct = new Map<string, AdDays>();
  for (const r of rowsOf<{ product_id: string; ads: number | string; total: number | string }>(
    days,
  )) {
    const d = adDaysByProduct.get(r.product_id) ?? { recent: [], total: Number(r.total) };
    d.recent.push(Number(r.ads));
    adDaysByProduct.set(r.product_id, d);
  }
  return { snapsByItem, adDaysByProduct };
}

/**
 * Scores every product that has at least one source item and appends rows to product_scores.
 * One INSERT keeps a scoring batch atomic; at 6 parameters per row it stays under Postgres'
 * 65,535-parameter limit up to about 10,000 products.
 */
export async function runScoring(db: AnyDatabase, now: Date = new Date()) {
  const items = await db
    .select({
      id: sourceItems.id,
      productId: sourceItems.productId,
      source: sourceItems.source,
      provider: sourceItems.provider,
      kind: sourceItems.kind,
      advertiserId: sourceItems.advertiserId,
      format: sourceItems.format,
      startedAt: sourceItems.startedAt,
      endedAt: sourceItems.endedAt,
      priceCents: sourceItems.priceCents,
      currency: sourceItems.currency,
      countries: sourceItems.countries,
    })
    .from(sourceItems)
    .where(isNotNull(sourceItems.productId));
  if (items.length === 0) return { productsScored: 0 };

  const [{ snapsByItem, adDaysByProduct }, fx, productRows] = await Promise.all([
    loadSnapshots(db),
    getLatestFxRates(db),
    db
      .select({ id: products.id, firstSeenAt: products.firstSeenAt })
      .from(products)
      .where(
        inArray(
          products.id,
          db
            .selectDistinct({ id: sourceItems.productId })
            .from(sourceItems)
            .where(isNotNull(sourceItems.productId)),
        ),
      ),
  ]);

  const itemsByProduct = new Map<string, ItemInput[]>();
  for (const i of items) {
    const input: ItemInput = {
      source: i.source,
      provider: i.provider,
      kind: i.kind,
      advertiserId: i.advertiserId,
      format: i.format,
      startedAt: i.startedAt,
      endedAt: i.endedAt,
      priceCents: i.priceCents,
      currency: i.currency,
      countries: i.countries,
      snapshots: snapsByItem.get(i.id) ?? [],
    };
    const list = itemsByProduct.get(i.productId!);
    if (list) list.push(input);
    else itemsByProduct.set(i.productId!, [input]);
  }

  const features = productRows.map((p) =>
    extractFeatures(
      itemsByProduct.get(p.id) ?? [],
      p.firstSeenAt,
      now,
      fx,
      adDaysByProduct.get(p.id) ?? { recent: [], total: 0 },
    ),
  );
  const scores = scoreProducts(features);

  await db.insert(productScores).values(
    productRows.map((p, i) => ({
      productId: p.id,
      scoringVersion: SCORING_VERSION,
      score: scores[i].score,
      confidence: scores[i].confidence,
      breakdown: scores[i].breakdown,
      computedAt: now,
    })),
  );
  return { productsScored: productRows.length };
}
