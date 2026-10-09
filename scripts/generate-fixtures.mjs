// Generates deterministic SAMPLE fixtures in real API response shapes. Not real data.
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

// Each product tells a different story so scoring has something to discriminate.
const products = [
  {
    key: "posture",
    title: "Adjustable Posture Corrector Brace",
    trend: "rising",
    ads: 9,
    advertisers: 4,
    days: 75,
    price: "8.42",
    vol: 5400,
  },
  {
    key: "ledmask",
    title: "LED Light Therapy Face Mask",
    trend: "flat_high",
    ads: 22,
    advertisers: 14,
    days: 210,
    price: "21.90",
    vol: 18000,
  },
  {
    key: "blender",
    title: "Portable USB Rechargeable Blender",
    trend: "declining",
    ads: 6,
    advertisers: 5,
    days: 300,
    price: "9.15",
    vol: 2100,
  },
  {
    key: "pawcleaner",
    title: "Silicone Dog Paw Cleaner Cup",
    trend: "rising_fast",
    ads: 5,
    advertisers: 2,
    days: 18,
    price: "3.80",
    vol: 1300,
  },
  {
    key: "cloudslides",
    title: "Cloud Pillow Slides Sandals",
    trend: "flat_low",
    ads: 2,
    advertisers: 2,
    days: 40,
    price: "5.60",
    vol: 900,
  },
];

const NOW = Date.UTC(2026, 9, 9); // 2026-10-09
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().replace(".000Z", "+0000");

// --- Meta /ads_archive ---
let adId = 1200000000000000;
const metaData = [];
for (const p of products) {
  for (let i = 0; i < p.ads; i++) {
    const startDaysAgo = Math.max(1, Math.round(p.days * (1 - i / p.ads)));
    const stopped = p.trend === "declining" && i % 2 === 0;
    const ad = {
      id: String(adId++),
      page_id: String(100000000000 + products.indexOf(p) * 100 + (i % p.advertisers)),
      page_name: `${p.key[0].toUpperCase()}${p.key.slice(1)} Store ${(i % p.advertisers) + 1}`,
      ad_creation_time: iso(NOW - startDaysAgo * DAY),
      ad_delivery_start_time: iso(NOW - startDaysAgo * DAY),
      ad_snapshot_url: `https://www.facebook.com/ads/archive/render_ad/?id=${adId - 1}`,
      ad_creative_bodies: [`${p.title} - limited stock, free shipping today only.`],
      ad_creative_link_titles: [p.title],
      publisher_platforms: ["facebook", "instagram"],
      languages: ["en"],
      eu_total_reach: Math.round((p.vol * 12) / (i + 1)),
    };
    if (stopped) ad.ad_delivery_stop_time = iso(NOW - Math.round(startDaysAgo / 3) * DAY);
    metaData.push(ad);
  }
}
fs.writeFileSync(
  path.join(out, "meta-ads.json"),
  JSON.stringify({ data: metaData, paging: { cursors: { after: "FIXTURE_END" } } }, null, 2) + "\n",
);

// --- SerpApi google_trends TIMESERIES (weekly, 12 weeks, max 5 queries per request) ---
const shapes = {
  rising: (w) => 30 + w * 4,
  rising_fast: (w) => 8 + Math.round(1.5 ** w),
  flat_high: () => 70,
  flat_low: () => 12,
  declining: (w) => 80 - w * 5,
};
const weeks = 12;
const timeline = [];
for (let w = 0; w < weeks; w++) {
  const start = NOW - (weeks - w) * 7 * DAY;
  const point = {
    date: new Date(start).toDateString(),
    timestamp: String(start / 1000),
    values: products.map((p, i) => {
      const jitter = ((w * 7 + i * 3) % 5) - 2;
      const v = Math.max(0, Math.min(100, shapes[p.trend](w) + jitter));
      return {
        query: p.title.split(" ").slice(-2).join(" ").toLowerCase(),
        value: String(v),
        extracted_value: v,
      };
    }),
  };
  if (w === weeks - 1) point.partial_data = true;
  timeline.push(point);
}
fs.writeFileSync(
  path.join(out, "google-trends.json"),
  JSON.stringify(
    {
      search_parameters: {
        engine: "google_trends",
        q: timeline[0].values.map((v) => v.query).join(","),
        geo: "US",
        date: "today 3-m",
        data_type: "TIMESERIES",
      },
      interest_over_time: { timeline_data: timeline },
    },
    null,
    2,
  ) + "\n",
);

// --- AliExpress affiliate product.query ---
const aliProducts = products.map((p, i) => ({
  product_id: 1005007000000000 + i * 1111,
  product_title: p.title,
  product_main_image_url: `https://ae01.alicdn.com/kf/fixture-${p.key}.jpg`,
  product_detail_url: `https://www.aliexpress.com/item/${1005007000000000 + i * 1111}.html`,
  target_sale_price: p.price,
  target_sale_price_currency: "USD",
  target_original_price: (Number(p.price) * 2).toFixed(2),
  lastest_volume: p.vol,
  evaluate_rate: `${(92 + i).toFixed(1)}%`,
  first_level_category_name: "Fixture Category",
}));
fs.writeFileSync(
  path.join(out, "aliexpress.json"),
  JSON.stringify(
    {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          current_page_no: 1,
          total_record_count: aliProducts.length,
          products: { product: aliProducts },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("ok", metaData.length, "ads");
