export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Robust slope estimate: median of all pairwise slopes. `x` in any unit, e.g. weeks. */
export function theilSenSlope(points: Array<{ x: number; y: number }>): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length ? median(slopes) : NaN;
}

/**
 * Percentile rank in [0, 1] for each value among `values` (ties share the average rank).
 * A single value ranks 0.5 since there is nothing to compare against.
 */
export function percentileRanks(values: number[]): number[] {
  if (values.length === 1) return [0.5];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].v === order[start].v) end++;
    const avg = (start + end) / 2;
    for (let k = start; k <= end; k++) ranks[order[k].i] = avg / (values.length - 1);
    start = end + 1;
  }
  return ranks;
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Median absolute deviation scaled to match the standard deviation of normal data. */
export function mad(values: number[]): number {
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score of `latest` against a baseline (median / MAD), so a single past spike does not
 * hide a new one. When the baseline is flat (MAD = 0) a scale of 10% of the median (at least 1)
 * is used instead, so a jump from a flat line still registers.
 */
export function robustZ(latest: number, baseline: number[]): number {
  const m = median(baseline);
  const scale = mad(baseline) || Math.max(1, 0.1 * Math.abs(m));
  return (latest - m) / scale;
}
