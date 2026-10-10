/**
 * Broad category keywords swept in the Meta Ad Library to discover products (ADR-007).
 * Chosen for dropshipping-friendly categories; edit freely. A run covers a rotating slice so
 * every keyword is revisited every few days without exceeding the per-run request cap.
 */
export const DISCOVERY_KEYWORDS = [
  "posture corrector",
  "pet hair remover",
  "dog paw cleaner",
  "cat toy",
  "kitchen gadget",
  "vegetable chopper",
  "led face mask",
  "neck massager",
  "back massager",
  "portable blender",
  "car phone holder",
  "magnetic phone mount",
  "sunset lamp",
  "galaxy projector",
  "baby sleep",
  "toddler toy",
  "hair removal",
  "teeth whitening",
  "acupressure mat",
  "knee brace",
  "plantar fasciitis",
  "cleaning brush",
  "mini vacuum",
  "camping gadget",
] as const;

/** Keywords for a given day: a window that advances daily and wraps around the list. */
export function keywordsForDay(
  day: Date,
  count: number,
  keywords: readonly string[] = DISCOVERY_KEYWORDS,
) {
  const n = Math.min(count, keywords.length);
  const dayNumber = Math.floor(day.getTime() / 86_400_000);
  const start = (dayNumber * n) % keywords.length;
  return Array.from({ length: n }, (_, i) => keywords[(start + i) % keywords.length]);
}
