# Meta Ad Library 公開網站蒐集（2026-10-10，ADR-006）

## 實測結果

- 搜尋頁 `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=<關鍵字>&search_type=keyword_unordered&media_type=all` **不需登入**即可瀏覽，預設依 `total_impressions` 由高到低排序。
- 頁面的初始 HTML 內嵌 `<script type="application/json">`，其中有 `search_results_connection`（`count`、`edges[].node.collated_results[]`、`page_info`）與 `xfb_ad_library_is_captcha_required` 旗標。
- **用一般 HTTP GET（不需瀏覽器）就能取得同樣內容**，User-Agent 誠實標示為 `WinningProductHunter/0.1 (personal research)`。每頁約 27–30 筆。
- 每筆廣告的重要欄位：`ad_archive_id`、`collation_count`（共用同一創意的廣告數）、`is_active`、`page_id` / `page_name`、`start_date` / `end_date`（Unix 秒；`end_date` 是預定結束日）、`publisher_platform`、`snapshot.link_url`（landing page）、`snapshot.caption`（網域）、`snapshot.display_format`（VIDEO / IMAGE / DPA / DCO）、`snapshot.page_like_count`。`spend`、`reach_estimate` 對一般商業廣告為 null。

## 實作（`src/ingestion/sources/meta-ad-library-web.ts`）

- 三種查詢都只抓第一頁（曝光最高的廣告）：產品探索的品類關鍵字 × 國家（`npm run discover`）、追蹤廣告主的粉專 × 國家（見下方）、手動的產品名稱 × 國家（`npm run collect -- meta_ad_library`）。請求間隔 5 秒，每次執行最多 50 頁。
- 遇到 CAPTCHA 旗標、登入頁或頁面沒有結果資料就丟出 `AdLibraryBlockedError`，整次執行停止並記錄在 `ingestion_runs`，不嘗試繞過。
- 每支廣告存成 `ad`（provider `ad_library_web`，國家為搜尋國家），landing page 存在 `raw.landing_url`（用來把廣告掛到產品、查詢廣告主的 Shopify 商品頁）；另存一筆關鍵字層級的 `active_ads`（該國刊登中的廣告數）。

## 實測數據

5 個產品 × 5 個主要市場 = 25 個請求，抓到 443 筆，沒有被擋。例：「Adjustable Posture Corrector Brace」刊登中廣告數 US ~238、CA ~198、GB ~246、AU ~194、NZ ~131；最久的美國廣告已投放 188 天。

## 風險

依 ADR-006，這違反 Meta 條款中的自動化蒐集限制，現階段由使用者個人研究使用。若出現 CAPTCHA 或 403/429，應停止並降低頻率；若長期被擋，再評估付費服務。HTML 結構可能隨時變動，解析失敗時同樣會停止並記錄。

## 廣告主（粉專）頁面：追蹤廣告主（2026-10-10 實測，Phase 4C）

- 網址：`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=<國家>&view_all_page_id=<粉專 ID>&search_type=page&media_type=all`，**不需登入**。
- 實測（誠實 User-Agent、單一請求）：HTTP 200、約 650 KB，內嵌的 `search_results_connection` 與關鍵字搜尋相同，現有解析器可直接使用；`xfb_ad_library_is_captcha_required` 為 false。
- 例：Paw Guardian（US）共 691 則投放中廣告，第一頁 28 則、4 個不同商品頁，其中至少 1 個不在關鍵字掃描的結果裡。
- 用途：dropshipping 店家同時測很多產品，追蹤已知店家的其他廣告可補到關鍵字找不到的產品，也補強既有產品的廣告證據。
- 限制：只取第一頁（約 30 則，依曝光排序）；`count` 是該粉專在該國投放中的廣告總數，不是需求訊號，所以不存成關鍵字層級的統計。
- 成效（本機示範資料庫，各 10 個請求）：修正挑選邏輯後，245 則廣告 → 28 個有潛力產品（15 個新產品、13 個既有產品補強證據）；同樣 10 個請求的關鍵字掃描過去紀錄為 299 則廣告 → 29 個新產品。追蹤廣告主每個請求帶來的新產品較少，但能補強既有產品；「是否更早發現新品」需每日資料累積後才能量測。

