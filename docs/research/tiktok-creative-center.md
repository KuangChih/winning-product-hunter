# TikTok Creative Center 公開頁面評估（2026-10-10，ADR-006）

## 實測

- Top Ads 頁面（`ads.tiktok.com/business/creativecenter/inspiration/topads/...?region=US`）**不需登入**即可瀏覽，可依國家篩選（US 有約 136 則，30 天期間）。
- 資料由 `creative_radar_api/v1/top_ads/v2/list` 提供，回應欄位：`ad_title`、`ctr`、`like`、`industry_key`、`objective_key`、`cost`（等級）、`video_info`（封面、影片網址、長度）、`brand_name`（多為空）。
- **沒有 landing page、商品網址或廣告主網域**，很難對應到具體產品；標題多為通用文案（例如「Discover relaxed resort dresses…」）。
- 不帶頁面 JavaScript 產生的簽章 header 直接呼叫 API，回傳 `40101 no permission`。

## 結論

1. **不偽造簽章**：自行重現 API 簽章等同繞過存取控制，違反 ADR-006 的界線。
2. 唯一不越界的方式是用真正的瀏覽器（Playwright）載入公開頁面並讀取畫面資料，但：
   - 取得的資料缺少商品識別，對「找出熱賣產品」的價值低；
   - 機房 IP 的 headless 瀏覽器容易被擋，而被擋時依規則只能停止。
3. Top Products（商品排行）需要登入，不在可蒐集範圍內。

**決定**：暫緩自建 TikTok 公開頁面蒐集器。TikTok 訊號改由以下方式取得，由使用者決定：
- 官方 TikTok Commercial Content API（UK + EU，免費但需審核）——已在 HUMAN_TODO。
- 付費資料服務（例如 Apify 的 TikTok Creative Center / TikTok Shop actor，約 $1.5–5 / 1,000 筆）——可取得美國資料，但屬中間商；需使用者依花錢原則決定。
