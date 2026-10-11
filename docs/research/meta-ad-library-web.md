# Meta Ad Library 公開網站蒐集（2026-10-10，ADR-006）

## 實測結果

- 搜尋頁 `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=<關鍵字>&search_type=keyword_unordered&media_type=all` **不需登入**即可瀏覽，預設依 `total_impressions` 由高到低排序。
- 頁面的初始 HTML 內嵌 `<script type="application/json">`，其中有 `search_results_connection`（`count`、`edges[].node.collated_results[]`、`page_info`）與 `xfb_ad_library_is_captcha_required` 旗標。
- **用一般 HTTP GET（不需瀏覽器）就能取得同樣內容**，User-Agent 誠實標示為 `WinningProductHunter/0.1 (personal research)`。每頁約 27–30 筆。
- 每筆廣告的重要欄位：`ad_archive_id`、`collation_count`（共用同一創意的廣告數）、`is_active`、`page_id` / `page_name`、`start_date` / `end_date`（Unix 秒；`end_date` 是預定結束日）、`publisher_platform`、`snapshot.link_url`（landing page）、`snapshot.caption`（網域）、`snapshot.display_format`（VIDEO / IMAGE / DPA / DCO）、`snapshot.page_like_count`。`spend`、`reach_estimate` 對一般商業廣告為 null。

## 實作（`src/ingestion/sources/meta-ad-library-web.ts`）

- 三種查詢都只抓第一頁（曝光最高的廣告）：產品探索的品類關鍵字 × 國家（`npm run discover`）、追蹤廣告主的粉專 × 國家（見下方）、手動的產品名稱 × 國家（`npm run collect -- meta_ad_library`）。請求間隔 5 秒，每次執行最多 50 頁。
- 無法使用的回應分成 6 種（2026-10-11 起，見下方「回應診斷」）：CAPTCHA、要求登入、HTTP 403、HTTP 429 是**被擋**（停止並依出口退避）；頁面沒有內嵌結果、結果讀不出來**不算被擋**（這次執行停止 Meta，不退避）。都不嘗試繞過。
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

## Vercel 上被擋與回應診斷（2026-10-11）

- **觀察**：部署到 Vercel 後按「開始探索」，探索頁顯示「Meta 擋下了這台伺服器」，退避到 08:56 UTC（第 1 次，6 小時）。當時的程式只要頁面沒有 `search_results_connection` 就一律當成被擋，而且「登入頁」的判斷是「HTML 前 5000 字含 login 或 checkpoint」，太粗：**我們不知道 Meta 實際回了什麼**（登入頁、驗證碼、403，或只是沒有內嵌結果的頁面）。
- **本機對照（住宅 IP，2026-10-11，誠實 User-Agent，2 個請求、間隔 6 秒）**：US「posture corrector」、GB「pet hair remover」都是 HTTP 200、沒有轉址、最終網址 `https://www.facebook.com/ads/library/`、約 655 KB、`<title>` 為 `Ad Library`；`search_results_connection` 1 次、`xfb_ad_library_is_captcha_required` 為 false、`ad_library_main` 2 次、`AdLibraryFoundationRootQuery` 17 次、沒有 `id="login_form"`。正常頁面全文本來就有 11 個 `login` 與 2 個 `checkpoint`（路由表裡的 `/checkpoint/block/`），所以舊的字串判斷在正常頁面上也可能誤判（剛好不在前 5000 字）。
- **現在記錄的診斷**（`src/ingestion/sources/meta-ad-library-failure.ts`；不存頁面 HTML、cookie、查詢字串或任何個人資料）：HTTP 狀態、轉址後的最終網址（只留 origin + path）、是否轉址、回應大小（UTF-8 位元組）、`<title>`（最多 120 字）、標記：`captcha`（旗標為 true）、`login_form`（`id="login_form"`）、`login_title`（標題是「Log in…」）、`login_url` / `checkpoint_url`（最終網址是 `/login`、`/checkpoint`）、`results_json`（有 `search_results_connection`）、`ad_library_app`（有 `ad_library_main` 或 `AdLibraryFoundationRootQuery`，代表 Ad Library 的頁面殼層有送出）。
- **分類與處理**：

| 分類 | 判斷（依序） | 處理 |
| --- | --- | --- |
| `captcha` | 驗證碼旗標為 true | 被擋：停止，依出口退避 6 → 12 → 24 小時…最多 7 天 |
| `http_429` | HTTP 429 | 被擋：同上（不重試） |
| `http_403` | HTTP 403 | 被擋：同上（不重試） |
| `login_wall` | 最終網址是 `/login`、`/checkpoint`，或有登入表單、登入標題 | 被擋：同上 |
| `parse_error` | 有 `search_results_connection` 但讀不出來 | 不算被擋：這次執行不再送 Meta 請求，不退避 |
| `results_not_embedded` | 以上皆非（頁面送出了但沒有內嵌結果） | 不算被擋：同上 |

- **為什麼 `results_not_embedded` 不退避**：這種頁面不一定是 Meta 拒絕我們（可能是 Meta 改成用戶端載入結果、或對機房 IP 只送頁面殼層），當成被擋會把「做不到」誤報成「被封鎖」，也會讓 6 小時起跳的退避擋掉下一次真正能成功的嘗試。代價受控：每次執行遇到第一個這種頁面就停止 Meta（含追蹤廣告主），每個 UTC 日最多 3 次掃描，所以最多每天 3 個請求；而且診斷會留下來，下次部署後就知道原因。若之後確認某種頁面其實是封鎖，再把它改成被擋並記錄 ADR。
- **記錄位置**：`ingestion_runs.error`、執行狀態的步驟錯誤、`source_backoff.reason`（只有被擋才有），格式例如 `Meta Ad Library [login_wall] Meta asks to log in (status=200; final=https://www.facebook.com/login/; redirected=yes; bytes=…; title="Log into Facebook"; markers=login_form,login_title,login_url)`。探索頁用白話說明是哪一種情況（「Meta 要求登入」「Meta 要求驗證碼」「Meta 回 HTTP 403」「頁面沒有內嵌廣告資料」等），原始診斷放在「技術細節」。舊格式的訊息也看得懂（但舊的「login or checkpoint page」本身是粗略判斷）。
- **下一步**：等使用者在 Vercel 再跑一次後貼上「技術細節」，依實際分類決定：真的被擋 → 美國等市場改在自己電腦跑（DEPLOY 第 7 節）或評估付費資料商；UK + EU 可改用官方 API（見下節）。

## 官方 Ad Library API 的現況（2026-10-11 查官方文件）

- 文件：[ads_archive](https://developers.facebook.com/docs/graph-api/reference/ads_archive/)、[ArchivedAd](https://developers.facebook.com/docs/graph-api/reference/archived-ad/)、[Ad Library API](https://www.facebook.com/ads/library/api/)。文件頁顯示的 Graph API 版本是 **v26.0**。
- 範圍：「過去 1 年在英國或歐盟投放的任何類型廣告」，其他地區只有社會議題、選舉、政治廣告。所以美國、加拿大、澳洲、紐西蘭的商業廣告**只能**靠公開網站。挪威不在範圍內。
- 參數：`ad_reached_countries`（必填）、`ad_type`（預設 `ALL`）、`ad_active_status`、`search_terms`（≤100 字）、`search_type`、`search_page_ids`（≤10 個）、`ad_delivery_date_min/max`、`publisher_platforms`、`media_type`、`languages`。錯誤碼 613 = 超過速率限制、190 = token 無效。
- 商業廣告可用欄位：`id`（與網站的 `ad_archive_id` 相同）、`page_id`、`page_name`、`ad_creation_time`、`ad_delivery_start_time`、`ad_delivery_stop_time`、`ad_snapshot_url`（**網址含 access token，不可儲存**）、`ad_creative_bodies`、`ad_creative_link_titles` / `_captions` / `_descriptions`、`publisher_platforms`、`languages`、`total_reach_by_location`；只限 EU：`eu_total_reach`、`beneficiary_payers`；只限 UK + EU：`target_ages`、`target_gender`、`target_locations`、`age_country_gender_reach_breakdown`。`spend`、`impressions` 只有政治廣告才有。
- **關鍵缺口**：官方 API **沒有 landing page 網址欄位**（網站版有 `snapshot.link_url`），也沒有 `collation_count`（創意變體數）。探索是用 landing page 把廣告分組成產品，所以官方 API 不能直接取代網站版做 UK / EU 的探索；`ad_creative_link_captions` 通常只有網域（同一家店的所有產品會混在一起）。
- 已實作（`src/ingestion/sources/meta-ads.ts`）：`createMetaAdsApiAdapter`（provider `ad_library_api`，只查 UK + EU 國家、關鍵字或粉專 ID、游標分頁、請求上限、Graph 錯誤不帶 token 與網址）、`parseMetaAd` 改用公開 Library 連結並丟掉 `ad_snapshot_url`、`eu_total_reach` 與 `total_reach_by_location` 的 UK 值（`uk_total_reach`；欄位文件有寫，但 JSON 形狀 `{key, value}` 要拿到 token 後實測確認）。全部是 fixture 測試，沒有真實請求。
- **未接進 runner 的原因**：`source_items` 以 (source, externalId) 唯一，API 與網站版的同一則廣告會寫進同一筆並覆蓋 `raw`（失去 `landing_url`）與 provider，會破壞廣告掛產品、追蹤廣告主與 repair。正確的接法是「補強」而不是「取代」：拿到 token 後，對已由網站版找到、投放到 UK / EU 的廣告，用 `search_page_ids` 查官方 API，把 `eu_total_reach` / UK 觸及寫成新的 metric（不覆蓋 `raw`），作為真實觸及人數的訊號；這需要在 ingestion 加「只補 metric」的寫入路徑，已寫進 ROADMAP。
