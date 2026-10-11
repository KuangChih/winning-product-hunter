import { MOMENTUM_MIN_BASELINE_DAYS, type ProductFeatures } from "./features";
import { clamp, percentileRanks } from "./stats";

export const SCORING_VERSION = "v1.4";

/** Weights and parameters from docs/research/scoring.md. Tunable after back-testing. */
export const SCORING_CONFIG = {
  weights: {
    longevity: 0.15,
    scaling: 0.15,
    marketReach: 0.1,
    momentum: 0.15,
    demandTrend: 0.15,
    marketplace: 0.15,
    margin: 0.15,
  },
  /** Landed margin (after the CJ variant's price and shipping, ADR-017) for a full margin score. */
  fullMargin: 0.4,
  corroborationPerSource: 0.1,
  corroborationMax: 1.3,
  saturationMaxPenalty: 0.5,
  singleSourceCap: 70,
  /**
   * A score measured on less than this share of the weights of demand signals (one sub-score,
   * e.g. a product known only from CJ's order count) is capped at `thinEvidenceCap`: one signal
   * cannot put a product at the top of the ranking (ADR-014). Margin does not count toward it:
   * cheap to source says nothing about selling (ADR-016).
   */
  minEvidenceWeight: 0.25,
  thinEvidenceCap: 50,
};

export type SubScoreName = keyof typeof SCORING_CONFIG.weights;

/** Display order of the sub-scores (jsonb does not preserve key order). */
export const SUB_SCORE_ORDER: SubScoreName[] = [
  "longevity",
  "scaling",
  "marketReach",
  "momentum",
  "demandTrend",
  "marketplace",
  "margin",
];

export type ConfidenceLabel = "low" | "medium" | "high";

/** High needs nearly every signal present and three sources; v0 tops out at medium. */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  return confidence >= 0.8 ? "high" : confidence >= 0.45 ? "medium" : "low";
}

export interface SubScore {
  /** 0–1, or null when the product has no data for this signal. */
  value: number | null;
  weight: number;
  /** The un-normalized input, shown to users as evidence. */
  raw: number | null;
  /** Plain-language note on how the value was derived (English; kept for older scores). */
  basis: string;
  /** The same note as a translatable code and its numbers (scores computed since v1.1+i18n). */
  explain?: { key: ExplainKey; params?: Record<string, string | number> };
}

export type ExplainKey =
  | "longevity"
  | "scaling"
  | "marketReach"
  | "momentum"
  | "momentumNeedsHistory"
  | "demandTrend"
  | "marketplace"
  | "marketplaceCjOrders"
  | "margin"
  | "marginSamePhoto"
  | "landedMargin"
  | "landedMarginSamePhoto"
  | "marginNeedsShipping"
  | "marginNeedsRetail"
  | "marginNeedsSupplier";

export interface ScoreBreakdown {
  version: string;
  subScores: Record<SubScoreName, SubScore>;
  base: number;
  corroboration: number;
  saturation: {
    value: number;
    penalty: number;
    activeAdvertisers: number;
    ageDays: number;
    sellingStores?: number | null;
  };
  sources: string[];
  capped: boolean;
  /** The cap applied, when `capped` (absent before v1.2: 70). */
  capLimit?: number;
  /** Why: "single_source" or "thin_evidence" (absent before v1.2). */
  capReason?: "single_source" | "thin_evidence";
}

export interface ProductScore {
  score: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  breakdown: ScoreBreakdown;
}

/** Rank-normalizes a feature across products, keeping nulls as null. */
function rankNullable(values: Array<number | null>): Array<number | null> {
  const present = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
  const ranks = percentileRanks(present.map((p) => p.v));
  const out: Array<number | null> = values.map(() => null);
  present.forEach((p, k) => (out[p.i] = ranks[k]));
  return out;
}

/**
 * Landed margin (ADR-017): (retail − CJ variant price − shipping to the US) / retail. Retail is
 * the advertiser's own price, else the median of stores selling the same photo (ADR-016). Any
 * missing input leaves the sub-score empty: nothing is estimated.
 */
function marginSubScore(f: ProductFeatures, weight: number): SubScore {
  const missing =
    f.retailUsdCents === null || f.retailUsdCents <= 0
      ? ({
          key: "marginNeedsRetail",
          basis:
            "Needs the advertiser's own store price, or stores selling the same photo (Shopify Global Catalog).",
        } as const)
      : f.supplierPriceCents === null
        ? ({
            key: "marginNeedsSupplier",
            basis: "Needs a supplier cost (CJ Dropshipping).",
          } as const)
        : f.freightUsdCents === null
          ? ({
              key: "marginNeedsShipping",
              basis: "Needs a CJ shipping quote to the US (within 15 days).",
            } as const)
          : null;
  if (missing) {
    return { value: null, weight, raw: null, basis: missing.basis, explain: { key: missing.key } };
  }
  const retailCents = f.retailUsdCents!;
  const margin = (retailCents - f.supplierPriceCents! - f.freightUsdCents!) / retailCents;
  const retail = (retailCents / 100).toFixed(2);
  const supplier = (f.supplierPriceCents! / 100).toFixed(2);
  const shipping = (f.freightUsdCents! / 100).toFixed(2);
  const samePhoto = f.retailBasis === "same_photo";
  return {
    value: clamp(margin / SCORING_CONFIG.fullMargin),
    weight,
    raw: Math.round(margin * 1000) / 1000,
    basis: samePhoto
      ? `Landed margin: median price ${retail} USD of ${f.retailStores} stores selling the same photo − supplier ${supplier} USD − shipping ${shipping} USD.`
      : `Landed margin: advertiser's price ${retail} USD − supplier ${supplier} USD − shipping ${shipping} USD.`,
    explain: samePhoto
      ? {
          key: "landedMarginSamePhoto",
          params: { retail, supplier, shipping, stores: f.retailStores },
        }
      : { key: "landedMargin", params: { retail, supplier, shipping } },
  };
}

/**
 * Scores a batch of products. Relative signals (scaling, trend, marketplace, saturation) are
 * percentile ranks within the batch, so scores compare products against each other.
 */
export function scoreProducts(features: ProductFeatures[]): ProductScore[] {
  const w = SCORING_CONFIG.weights;
  const scaling = rankNullable(features.map((f) => f.newAdActivity14d));
  const momentum = rankNullable(features.map((f) => f.adMomentum));
  const trend = rankNullable(features.map((f) => f.trendSlope));
  const market = rankNullable(
    features.map((f) => (f.marketplaceOrders === null ? null : Math.log1p(f.marketplaceOrders))),
  );
  const advertisers = percentileRanks(features.map((f) => f.activeAdvertisers));
  const ages = percentileRanks(features.map((f) => f.ageDays));
  const stores = rankNullable(features.map((f) => f.sellingStores));

  return features.map((f, i) => {
    const subScores: Record<SubScoreName, SubScore> = {
      longevity: {
        value: f.longevity,
        weight: w.longevity,
        raw: f.longevity,
        basis: "Average survival of the 3 longest-running ads (stopped ads count half).",
        explain: { key: "longevity" },
      },
      scaling: {
        value: scaling[i],
        weight: w.scaling,
        raw: f.newAdActivity14d,
        basis:
          "New ads + new advertisers in the last 14 days, plus reused creatives, ranked against other products.",
        explain: { key: "scaling" },
      },
      marketReach: {
        value: f.marketReach,
        weight: w.marketReach,
        raw: f.marketReach,
        basis: "Share of the five priority markets (US, CA, UK, AU, NZ) with active ads.",
        explain: { key: "marketReach" },
      },
      momentum: {
        value: momentum[i],
        weight: w.momentum,
        raw: f.adMomentum === null ? null : Math.round(f.adMomentum * 100) / 100,
        basis:
          f.adMomentum === null
            ? `Needs ${MOMENTUM_MIN_BASELINE_DAYS + 1}+ days of daily ad history (have ${f.adHistoryDays}).`
            : "Today's observed ads vs the previous days (robust z-score), ranked.",
        explain:
          f.adMomentum === null
            ? {
                key: "momentumNeedsHistory",
                params: { need: MOMENTUM_MIN_BASELINE_DAYS + 1, have: f.adHistoryDays },
              }
            : { key: "momentum" },
      },
      demandTrend: {
        value: trend[i],
        weight: w.demandTrend,
        raw: f.trendSlope,
        basis: "Search interest slope per week relative to its median, ranked.",
        explain: { key: "demandTrend" },
      },
      marketplace: {
        value: market[i],
        weight: w.marketplace,
        raw: f.marketplaceOrders,
        basis:
          f.marketplaceBasis === "cj_orders"
            ? "Orders on CJ (CJ platform count; CJ does not publish the period), ranked against other products."
            : "Units sold by the supplier (CJ) in the last 90 days, ranked.",
        explain: {
          key: f.marketplaceBasis === "cj_orders" ? "marketplaceCjOrders" : "marketplace",
        },
      },
      margin: marginSubScore(f, w.margin),
    };

    let weighted = 0;
    let available = 0;
    let demand = 0;
    for (const [name, s] of Object.entries(subScores)) {
      if (s.value === null) continue;
      weighted += s.weight * s.value;
      available += s.weight;
      if (name !== "margin") demand += s.weight;
    }
    const base = available > 0 ? weighted / available : 0;

    const corroboration = Math.min(
      SCORING_CONFIG.corroborationMax,
      1 + SCORING_CONFIG.corroborationPerSource * Math.max(0, f.sources.length - 1),
    );
    // Crowdedness: active advertisers, product age and (when known) how many stores sell it.
    const satParts = [advertisers[i], ages[i], stores[i]].filter((v): v is number => v !== null);
    const sat = satParts.reduce((a, b) => a + b, 0) / satParts.length;
    const penalty = SCORING_CONFIG.saturationMaxPenalty * sat;

    let score = clamp(100 * base * corroboration * (1 - penalty), 0, 100);
    let cap: { limit: number; reason: "single_source" | "thin_evidence" } | null = null;
    if (demand < SCORING_CONFIG.minEvidenceWeight) {
      cap = { limit: SCORING_CONFIG.thinEvidenceCap, reason: "thin_evidence" };
    } else if (f.sources.length < 2) {
      cap = { limit: SCORING_CONFIG.singleSourceCap, reason: "single_source" };
    }
    const capped = cap !== null && score > cap.limit;
    if (capped) score = cap!.limit;

    const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
    const confidence = (available / totalWeight) * Math.min(1, f.sources.length / 3);

    return {
      score: Math.round(score * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      confidenceLabel: confidenceLabel(confidence),
      breakdown: {
        version: SCORING_VERSION,
        subScores,
        base,
        corroboration,
        saturation: {
          value: sat,
          penalty,
          activeAdvertisers: f.activeAdvertisers,
          ageDays: Math.round(f.ageDays),
          sellingStores: f.sellingStores,
        },
        sources: f.sources,
        capped,
        ...(capped ? { capLimit: cap!.limit, capReason: cap!.reason } : {}),
      },
    };
  });
}
