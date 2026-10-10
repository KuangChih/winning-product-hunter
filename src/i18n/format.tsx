import type { ReactNode } from "react";
import { marketName } from "@/lib/markets";
import type { Locale } from "./locales";

/** Country name in the UI language (`GB` → "United Kingdom" / "英國"). */
export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? marketName(code);
  } catch {
    return marketName(code); // not an ISO region code
  }
}

/** Fills `{name}` placeholders: `fill("{n} products", { n: 3 })` → "3 products". */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Renders `backticked` parts of a dictionary string as <code>, the rest as plain text. */
export function RichText({ text }: { text: string }): ReactNode {
  return text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}
