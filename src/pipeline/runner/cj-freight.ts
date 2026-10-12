/**
 * CJ shipping quotes (ADR-017): after the CJ listings are stored, quote shipping to the US for
 * the variant each CJ product's margin is based on (`chooseVariant`), at most
 * `MAX_CJ_FREIGHT_REQUESTS` per run (10 CJ points each), paced like every CJ request. Products
 * with a retail price (so a landed margin can be computed) come first. A quote is reused while
 * the variant is the same and the quote is younger than `FREIGHT_FRESH_DAYS`.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { cjLandedCosts, products, sourceItems } from "@/db/schema";
import { CjApiError, CJ_PROVIDER, isCjStop, type CjVariant } from "@/ingestion/sources/cj";
import { OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { extraPhotoHashes } from "@/matching/product-photos";
import { SEARCH_LISTING_PROVIDER, samePhotoOf } from "@/matching/same-photo";
import {
  chooseShipping,
  chooseVariant,
  LANDED_COUNTRY,
  MAX_DELIVERY_DAYS,
  type VariantChoice,
} from "@/pricing/landed";
import { counted } from "./cj-units";
import { recordBlock } from "./guards";
import { errorMessage, setStep } from "./state";
import type { UnitDef } from "./units";

/** Freight requests per run (10 points each) and per unit. */
export const MAX_CJ_FREIGHT_REQUESTS = 20;
export const CJ_FREIGHT_BATCH = 8;
/** A quote for the same variant is reused this long. */
export const FREIGHT_FRESH_DAYS = 7;

const DAY = 86_400_000;

export interface FreightTarget {
  productId: string;
  pid: string;
  choice: VariantChoice;
  /** The product has a retail price (own listing or same-photo store): a margin is possible. */
  hasRetail: boolean;
}

type Labels = { name?: string; values?: Array<{ label?: string }> }[] | null;

/**
 * CJ products whose landed cost needs a (new) shipping quote, products with a retail price
 * first. Rows whose variant choice changed without needing a new quote (same variant) get their
 * price fields updated here.
 */
export async function pickFreightTargets(
  db: AnyDatabase,
  now: Date,
  { limit, exclude = [] }: { limit: number; exclude?: string[] },
): Promise<FreightTarget[]> {
  const listings = await db
    .select({
      productId: sourceItems.productId,
      pid: sourceItems.externalId,
      variants: sql<CjVariant[] | null>`${sourceItems.raw}->'candidate'->'detail'->'variants'`,
      title: products.title,
      imageHash: products.imageHash,
    })
    .from(sourceItems)
    .innerJoin(products, eq(products.id, sourceItems.productId))
    .where(
      and(
        eq(sourceItems.provider, CJ_PROVIDER),
        eq(sourceItems.kind, "listing"),
        isNull(products.mergedInto),
      ),
    );
  const withVariants = listings.filter(
    (l) => Array.isArray(l.variants) && l.variants.length > 0 && !exclude.includes(l.productId!),
  );
  if (withVariants.length === 0) return [];
  const ids = withVariants.map((l) => l.productId!);
  const extras = await extraPhotoHashes(db, ids);

  const [stores, existing] = await Promise.all([
    db
      .select({
        productId: sourceItems.productId,
        provider: sourceItems.provider,
        title: sourceItems.title,
        imageHash: sourceItems.imageHash,
        options: sql<Labels>`${sourceItems.raw}->'options'`,
      })
      .from(sourceItems)
      .where(
        and(
          inArray(sourceItems.productId, ids),
          eq(sourceItems.kind, "store_product"),
          isNotNull(sourceItems.priceCents),
        ),
      ),
    db
      .select()
      .from(cjLandedCosts)
      .where(and(inArray(cjLandedCosts.productId, ids), eq(cjLandedCosts.country, LANDED_COUNTRY))),
  ]);
  const rowOf = new Map(existing.map((r) => [r.productId, r]));

  const targets: FreightTarget[] = [];
  for (const l of withVariants) {
    const mine = stores.filter((s) => s.productId === l.productId);
    const same = mine.filter(
      (s) =>
        s.provider === SEARCH_LISTING_PROVIDER &&
        samePhotoOf({ ...l, extraHashes: extras.get(l.productId!) ?? [] }, s) === true,
    );
    const labels = same.map((s) =>
      (s.options ?? []).flatMap((o) => (o.values ?? []).flatMap((v) => (v.label ? [v.label] : []))),
    );
    const choice = chooseVariant(l.variants!, labels);
    if (!choice) continue;
    const hasRetail = same.length > 0 || mine.some((s) => s.provider === OWN_LISTING_PROVIDER);
    const row = rowOf.get(l.productId!);
    const fresh = row && now.getTime() - row.quotedAt.getTime() < FREIGHT_FRESH_DAYS * DAY;
    if (row && fresh && row.vid === choice.variant.vid) {
      if (
        row.variantPriceCents !== choice.priceCents ||
        row.variantBasis !== choice.basis ||
        row.matchedVariants !== choice.matched
      ) {
        await db
          .update(cjLandedCosts)
          .set({
            variantPriceCents: choice.priceCents,
            variantBasis: choice.basis,
            matchedVariants: choice.matched,
            totalVariants: choice.total,
            updatedAt: now,
          })
          .where(
            and(
              eq(cjLandedCosts.productId, l.productId!),
              eq(cjLandedCosts.country, LANDED_COUNTRY),
            ),
          );
      }
      continue;
    }
    targets.push({ productId: l.productId!, pid: l.pid, choice, hasRetail });
  }
  return targets
    .sort((a, b) => Number(b.hasRetail) - Number(a.hasRetail) || a.pid.localeCompare(b.pid))
    .slice(0, limit);
}

export const cjFreight: UnitDef = {
  worstMs: 60_000,
  async run(ctx) {
    const { db, clock } = ctx;
    let s = ctx.state;
    const st = s.steps.cj;
    const done = s.progress.cjFreight ?? 0;
    const tried = s.cjFreightTried ?? [];
    const finish = (state: typeof s) => ({
      ...setStep(state, "cj", {
        detail:
          `${state.steps.cj.detail ?? ""}; shipping quotes: ${state.steps.cj.freightQuotes ?? 0}` +
          ((state.steps.cj.freightFailures ?? 0) > 0
            ? ` (${state.steps.cj.freightFailures} failed)`
            : ""),
      }),
      cursor: "collect" as const,
    });
    if (!ctx.deps.cj || st.stopped || done >= MAX_CJ_FREIGHT_REQUESTS) return finish(s);
    const now = new Date(s.now);
    const targets = await pickFreightTargets(db, now, {
      limit: Math.min(CJ_FREIGHT_BATCH, MAX_CJ_FREIGHT_REQUESTS - done),
      exclude: tried,
    });
    if (targets.length === 0) return finish(s);

    for (const [n, t] of targets.entries()) {
      if (n > 0 && clock.now() > ctx.softStop) break;
      s = { ...s, cjFreightTried: [...(s.cjFreightTried ?? []), t.productId] };
      const r = await counted(ctx, s, (client) =>
        client.freight({ vid: t.choice.variant.vid, to: LANDED_COUNTRY }, ctx.signal),
      );
      s = { ...r.s, progress: { ...r.s.progress, cjFreight: (r.s.progress.cjFreight ?? 0) + 1 } };
      if (!r.outcome.ok) {
        const err = r.outcome.error;
        if (isCjStop(err)) {
          const at = new Date(clock.now());
          if (err instanceof CjApiError && err.kind === "points") {
            await recordBlock(db, CJ_PROVIDER, ctx.deps.egress, errorMessage(err), at);
          }
          s = setStep(s, "cj", { stopped: { at: at.toISOString(), reason: errorMessage(err) } });
          return finish(s);
        }
        s = setStep(s, "cj", { freightFailures: (s.steps.cj.freightFailures ?? 0) + 1 });
        continue;
      }
      const options = r.result!.options;
      const best = chooseShipping(options);
      const values = {
        productId: t.productId,
        country: LANDED_COUNTRY,
        cjPid: t.pid,
        vid: t.choice.variant.vid,
        variantKey: t.choice.variant.key,
        variantPriceCents: t.choice.priceCents,
        weightG: t.choice.variant.weightG === null ? null : Math.round(t.choice.variant.weightG),
        variantBasis: t.choice.basis,
        matchedVariants: t.choice.matched,
        totalVariants: t.choice.total,
        carrier: best?.carrier ?? null,
        freightCents: best?.costCents ?? null,
        minDays: best?.minDays ?? null,
        maxDays: best?.maxDays ?? null,
        shippingOptions: options.length,
        maxDaysAllowed: MAX_DELIVERY_DAYS,
        quotedAt: now,
        updatedAt: now,
      };
      await db
        .insert(cjLandedCosts)
        .values(values)
        .onConflictDoUpdate({
          target: [cjLandedCosts.productId, cjLandedCosts.country],
          set: values,
        });
      s = setStep(s, "cj", { freightQuotes: (s.steps.cj.freightQuotes ?? 0) + 1 });
    }
    return s;
  },
};
