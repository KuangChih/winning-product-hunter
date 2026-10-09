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
