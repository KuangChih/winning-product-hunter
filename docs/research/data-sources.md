# 資料來源研究（2026-10-09）

目的：決定 Winning Product Hunter 能**合法、穩定**取得哪些訊號，以及第一版要先接哪些來源。
可信度標記：🟢 官方文件、🟡 第三方文件/廠商部落格（需在實作前再對照官方確認）。

## 總結

| 來源 | 官方管道 | 覆蓋範圍 | 成本 | 適合度 | 決定 |
|---|---|---|---|---|---|
| Meta Ad Library | Graph API `/ads_archive` | 商業廣告**僅限投放到 EU/UK 的廣告**（保留 1 年）；其他地區只有政治/議題廣告 🟡 | 免費，需身分驗證 | 中：EU 資料可當「全球廣告熱度」的代理指標 | **第一批**，EU 國家查詢 |
| TikTok 廣告 | Commercial Content API（`research.adlib.basic`） | 僅 EEA/UK/CH 的廣告 🟡；需申請審核 🟢 | 免費，需審核 | 中 | 申請中先做 fixture |
| TikTok Creative Center | 無官方 API | Top Ads / Top Products / 熱門 hashtag | Apify actor 約 $1.5–2 / 1,000 筆 🟡 | 高（業界常用訊號） | 透過授權第三方資料商（Apify），需確認 ToS |
| Google Ads Transparency | 無官方 API | 依廣告主或文字查詢廣告創意 | SerpApi（有免費額度）🟡 | 中 | **第一批**（SerpApi） |
| Google Trends | 官方 Trends API 仍為 alpha、需申請、無時程 🟡 | 5 年滾動資料，非 0–100 標準化 | 未公開 | 高（需求斜率） | 申請 alpha；先用 SerpApi `google_trends` 引擎 |
| Amazon | PA-API 5 已於 2026-04/05 停用，改為 Creators API（OAuth 2.0）🟡；需 Associates 資格 | BSR（`WebsiteSalesRank`、browse node rank） | 免費但需聯盟資格 | 中 | Keepa API（約 $19/月起，含 BSR 歷史與 best sellers 清單）🟡 |
| AliExpress | Affiliate API `aliexpress.affiliate.hotproduct.query`、`product.query`（可 `LAST_VOLUME_DESC` 排序）🟡；hot product 需申請 Advanced API | 訂單量、價格 | 免費 | 高（供貨價 + 銷量） | **第一批** |
| CJ Dropshipping | 官方 API v2（Product List v2）🟡 | 商品、價格、庫存；無「熱門」端點 | 免費（需帳號） | 中（供應/毛利） | 第二批 |
| Shopify 店家 | 公開 `/products.json` | 店家商品、上架時間 | 免費 | 中（跨店重複販售） | 第二批，限速、遵守 robots.txt |

## 關鍵發現

1. **沒有任何官方 API 能提供美國市場的商業廣告資料**（Meta、TikTok 皆只開放 EU 範圍，這是 DSA 法規的結果）。競品（Minea、PiPiADS 等）多半自建爬蟲。我們的合規規則禁止繞過反爬機制，因此：
   - 用 **EU 廣告資料當全球熱度的代理指標**（Dropshipping 產品多半跨區投放）。
   - 美國市場訊號改由 **TikTok Creative Center（經 Apify）、Google Trends、Amazon BSR、AliExpress 銷量** 補足。
2. **Meta 的 Ad Library API 條款限制把資料用於轉售型產品** 🟡——這直接關係到商業模式，必須由使用者/律師確認（已加入 HUMAN_TODO）。
3. **廣告持久度** 這個核心訊號可以從 Meta `ad_delivery_start_time` / `ad_delivery_stop_time` 取得（欄位待對照官方 reference 確認）。
4. Meta API 細節：每次呼叫都必須帶 `ad_reached_countries` 與 `search_terms` 或 `search_page_ids`；不適用的欄位會直接從 JSON 中省略，解析器要容忍缺欄位；Graph API 需 v22.0 以上 🟡。
5. 第三方資料商（Apify actor）多為個人維護、使用者少，**adapter 必須能切換供應商**，且要監控資料品質。

## 對架構的影響

- 每個來源一個 adapter，分成「來源（Meta/TikTok/…）」與「供應商（official/apify/serpapi）」兩層，供應商可替換。
- 所有 adapter 先有 fixture 模式；拿到金鑰後只換供應商設定。
- 每筆訊號都記錄 `source`、`provider`、`region`、`fetchedAt`、原始連結，讓前端能顯示證據與覆蓋範圍（例如「此廣告資料僅含 EU 投放」）。

## 參考來源

- Meta Ad Library API：[adsuploader 指南](https://adsuploader.com/blog/facebook-ad-library-api)、[AdMapix](https://www.admapix.com/blog/ad-intelligence/meta-ads-library-api-developers)、[Meta archived-ad reference](https://developers.facebook.com/docs/graph-api/reference/archived-ad/)、[Radlibrary NEWS](https://github.com/facebookresearch/Radlibrary/blob/HEAD/NEWS.md)
- TikTok：[Commercial Content API 產品頁](https://developers.tiktok.com/products/commercial-content-api)、[query 端點文件](https://developers.tiktok.com/docs/en/commercial-content-api-query-commercial-content)、[Datashake 2026 覆蓋分析](https://www.datashake.com/blog/tiktok-data-coverage-in-2026-what-social-intelligence-teams-need-to-know)
- TikTok Creative Center（Apify）：[datapeak](https://apify.com/datapeak/tiktok-creative-center)、[dltik](https://apify.com/dltik/tiktok-creative-center)
- Google Ads Transparency：[SerpApi 公告](https://serpapi.com/blog/serpapi-unveils-google-ads-transparency-api-empowering-developers-to-harness-ads-insights/)、[教學](https://serpapi.com/blog/scrape-competitors-google-ads-data-using-python)
- Google Trends API：[PPC Land alpha 報導](https://ppc.land/google-opens-alpha-testing-for-new-trends-api-targeting-developers-and-journalists/)、[2026 選項比較](https://konabayev.com/blog/google-trends-api-landscape-2026/)
- Amazon：[PA-API 5 停用公告](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation)、[DEV 遷移說明](https://dev.to/th3nate/amazon-pa-api-v5-is-shutting-down-april-30-2026-here-is-what-changes-at-the-auth-layer-22ek)、[Keepa API](https://keepa.com/api-docs/)
- AliExpress / CJ：[python-aliexpress-api](https://github.com/sergioteula/python-aliexpress-api)、[Jentic AliExpress](https://jentic.com/apis/aliexpress.com/aliexpress.md)、[CJ Products Sync](https://developers.cjdropshipping.cn/en/api/start/Products-Synchronization-Processing.html)
