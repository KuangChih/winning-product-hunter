import type { Locale } from "@/i18n/locales";

/** Human-readable names for data sources, shown next to every piece of evidence. */
export const SOURCE_LABELS: Record<string, string> = {
  // Covers both the official API (EU/UK only) and the public Ad Library website (all countries).
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads (EU)",
  tiktok_creative_center: "TikTok Creative Center",
  google_ads: "Google Ads",
  google_trends: "Google Trends",
  aliexpress: "AliExpress",
  amazon: "Amazon",
  cj: "CJ Dropshipping",
  shopify: "Shopify stores",
};

/** Overrides for names that are descriptions rather than brands; brand names stay as they are. */
const LOCALIZED_LABELS: Partial<Record<Locale, Record<string, string>>> = {
  "zh-TW": {
    tiktok_ads: "TikTok Ads（歐盟）",
    shopify: "Shopify 店家",
  },
};

export function sourceLabel(source: string, locale: Locale = "en"): string {
  return LOCALIZED_LABELS[locale]?.[source] ?? SOURCE_LABELS[source] ?? source;
}
