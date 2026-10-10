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

// --- CJ Dropshipping API v2: product/listV2 + product/productDetail/query ---
// Shapes follow https://developers.cjdropshipping.com/en/api/api2/api/product.html
const cjId = (i) => `FIXTURE-CJ-${String(i + 1).padStart(4, "0")}`;
const cjList = products.map((p, i) => ({
  id: cjId(i),
  nameEn: p.title,
  sku: `CJFX${1000 + i}`,
  spu: `CJFX${1000 + i}`,
  bigImage: `https://cf.cjdropshipping.com/fixture-${p.key}.jpg`,
  sellPrice: p.price,
  nowPrice: p.price,
  // How many CJ stores have listed this product: a saturation hint.
  listedNum: p.advertisers * 40,
  categoryId: "FIXTURE",
  addMarkStatus: 1,
  isVideo: 1,
  productType: "ORDINARY_PRODUCT",
  supplierName: "Fixture Supplier",
  createAt: NOW - p.days * DAY,
  warehouseInventoryNum: 5000,
  verifiedWarehouse: 1,
}));
const cjDetails = products.map((p, i) => ({
  code: 200,
  result: true,
  message: "Success",
  data: {
    id: cjId(i),
    nameen: p.title,
    sellprice: p.price,
    bigimg: cjList[i].bigImage,
    listed: cjList[i].listedNum,
    // Units sold in the last 90 days.
    soldOut: p.vol,
    orderCount: Math.round(p.vol * 0.8),
    totalQuantity: p.vol,
    totalRefundQuantity: Math.round(p.vol * 0.02),
    variantInventory: [
      {
        vid: `${cjId(i)}-V1`,
        inventory: [{ countryCode: "US", totalInventory: 800, cjInventory: 800 }],
      },
    ],
  },
  requestId: `fixture-detail-${i}`,
}));
fs.writeFileSync(
  path.join(out, "cj-dropshipping.json"),
  JSON.stringify(
    {
      listV2: {
        code: 200,
        result: true,
        message: "Success",
        data: {
          pageSize: 20,
          pageNumber: 1,
          totalRecords: cjList.length,
          totalPages: 1,
          content: [{ productList: cjList, relatedCategoryList: [], keyWord: "" }],
        },
        requestId: "fixture-list",
      },
      details: cjDetails,
    },
    null,
    2,
  ) + "\n",
);
console.log("ok", metaData.length, "ads");
