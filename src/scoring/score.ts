import type { ProductFeatures } from "./features";
import { clamp, percentileRanks } from "./stats";

export const SCORING_VERSION = "v0";

/** Weights and parameters from docs/research/scoring.md. Tunable after back-testing. */
export const SCORING_CONFIG = {
  weights: {
    longevity: 0.2,
    scaling: 0.2,
    engagementVelocity: 0.15,
    demandTrend: 0.15,
    marketplace: 0.15,
    margin: 0.15,
  },
  corroborationPerSource: 0.1,
  corroborationMax: 1.3,
  saturationMaxPenalty: 0.5,
  singleSourceCap: 70,
};

export type SubScoreName = keyof typeof SCORING_CONFIG.weights;

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
  /** Plain-language note on how the value was derived. */
  basis: string;
}

export interface ScoreBreakdown {
  version: string;
  subScores: Record<SubScoreName, SubScore>;
  base: number;
  corroboration: number;
  saturation: { value: number; penalty: number; activeAdvertisers: number; ageDays: number };
  sources: string[];
  capped: boolean;
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
 * Scores a batch of products. Relative signals (scaling, trend, marketplace, saturation) are
 * percentile ranks within the batch, so scores compare products against each other.
 */
export function scoreProducts(features: ProductFeatures[]): ProductScore[] {
  const w = SCORING_CONFIG.weights;
  const scaling = rankNullable(features.map((f) => f.newAdActivity14d));
  const trend = rankNullable(features.map((f) => f.trendSlope));
  const market = rankNullable(
    features.map((f) => (f.marketplaceOrders === null ? null : Math.log1p(f.marketplaceOrders))),
  );
  const advertisers = percentileRanks(features.map((f) => f.activeAdvertisers));
  const ages = percentileRanks(features.map((f) => f.ageDays));

  return features.map((f, i) => {
    const subScores: Record<SubScoreName, SubScore> = {
      longevity: {
        value: f.longevity,
        weight: w.longevity,
        raw: f.longevity,
        basis: "Average survival of the 3 longest-running ads (stopped ads count half).",
      },
      scaling: {
        value: scaling[i],
        weight: w.scaling,
        raw: f.newAdActivity14d,
        basis: "New ads + new advertisers in the last 14 days, ranked against other products.",
      },
      engagementVelocity: {
        value: null,
        weight: w.engagementVelocity,
        raw: null,
        basis: "No social engagement data yet (TikTok source not connected).",
      },
      demandTrend: {
        value: trend[i],
        weight: w.demandTrend,
        raw: f.trendSlope,
        basis: "Search interest slope per week relative to its median, ranked.",
      },
      marketplace: {
        value: market[i],
        weight: w.marketplace,
        raw: f.marketplaceOrders,
        basis: "Recent marketplace orders (level, not growth yet), ranked.",
      },
      margin: {
        value: null,
        weight: w.margin,
        raw: f.supplierPriceCents,
        basis: "Needs a retail price to compare with the supplier price; not available yet.",
      },
    };

    let weighted = 0;
    let available = 0;
    for (const s of Object.values(subScores)) {
      if (s.value === null) continue;
      weighted += s.weight * s.value;
      available += s.weight;
    }
    const base = available > 0 ? weighted / available : 0;

    const corroboration = Math.min(
      SCORING_CONFIG.corroborationMax,
      1 + SCORING_CONFIG.corroborationPerSource * Math.max(0, f.sources.length - 1),
    );
    const sat = (advertisers[i] + ages[i]) / 2;
    const penalty = SCORING_CONFIG.saturationMaxPenalty * sat;

    let score = clamp(100 * base * corroboration * (1 - penalty), 0, 100);
    const capped = f.sources.length < 2 && score > SCORING_CONFIG.singleSourceCap;
    if (capped) score = SCORING_CONFIG.singleSourceCap;

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
        },
        sources: f.sources,
        capped,
      },
    };
  });
}
