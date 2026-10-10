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

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
