# 第一手（first-party）資料來源研究（2026-10-10）

目的：找出 SerpApi、Apify actors、Keepa 這類中間商**實際從哪裡抓資料**，以及我們能否**更接近源頭**取得同樣的訊號。
目標市場優先序：**US、CA、UK、AU、NZ**；其次 DE、FR、SE、BE、ES、NO。

可信度標記：
- 【官方】＝平台自家文件、條款、changelog、newsroom、OpenAPI spec。
- 【次級】＝廠商部落格、第三方整理、新聞報導；實作前要再對照官方。
- 【未證實】＝搜尋不到官方說法，或來源互相矛盾，需要登入後台或實測確認。

> **現況（2026-10-10）**：本研究是 ADR-005 的依據。之後使用者決定蒐集 Meta / TikTok 公開廣告網站（ADR-006），所以下文「不自建爬蟲」的建議已被取代：Meta Ad Library 公開網站已自建蒐集器（見 [`meta-ad-library-web.md`](meta-ad-library-web.md)），TikTok Creative Center 實測後暫緩（見 [`tiktok-creative-center.md`](tiktok-creative-center.md)）；Shopify 改用官方 Global Catalog（見 [`store-signals.md`](store-signals.md)）。其餘官方 API 都在等使用者申請（見 `docs/loop/HUMAN_TODO.md`）。

---

## 0. 一頁總結

| 來源 | 第一手程度 | 我們的國家 | 存取門檻 | 成本 | ToS/法律風險 | 建議 |
|---|---|---|---|---|---|---|
| Google Merchant API：Best sellers（Market insights） | 高（Google 自家排名） | **11 國全部** | Merchant Center 帳號 + 達到最低資格 | 免費 | 低～中（資料再散布需看 Merchant Center 條款） | **第一優先** |
| Meta Ad Library API `/ads_archive` | 高 | **UK** + DE/FR/SE/BE/ES（NO 待確認） | 身分驗證 + Meta 開發者 app | 免費 | 低 | **第一批**（UK/EU） |
| Pinterest Trends API | 高 | US、CA、GB+IE、AU+NZ、DE+AT+CH、FR、ES、SE+DK+FI+NO、NL+BE+LU | Pinterest 商業帳號 + app 審核 | 免費 | 低～中 | **第一批** |
| Google Ads API Keyword Planner | 高 | 11 國全部 | Ads 帳號 + developer token（**Basic** 以上） | 免費（需 Ads 帳號） | 低～中 | **第一批** |
| Google Trends API（alpha） | 高 | 全球 | 申請 alpha，名額有限 | 未公布 | 低 | 立即申請 |
| TikTok Commercial Content API | 高 | **UK** + EU/EEA（含 NO） | TikTok for Developers 申請 | 免費 | 低 | **第一批**（UK/EU） |
| Google Ads Transparency BigQuery dataset | 高 | 僅 **EEA + 土耳其**（**不含 UK**） | GCP 帳號 | BigQuery 查詢費 | 低 | 第二批（只有 metadata） |
| Shopify Global Catalog（官方 MCP） | 高（Shopify 官方） | 全部（`ships_to`） | 不需金鑰 | 免費 | 低～中 | **已串接**（取代逐店讀取 storefront JSON） |
| eBay Marketplace Insights API | 高（成交紀錄） | 依 eBay 站點 | **Limited Release**，需 eBay 業務審核 | 免費 | 低 | 申請看看 |
| Meta Ad Library **網站**（美國商業廣告） | 高，但只能蒐集公開頁 | US/CA/AU/NZ | 無官方存取 | 自建免費；Apify 約 $3.4–5.8/千則 | **高** | **已自建**（ADR-006，限個人研究） |
| TikTok Creative Center（Top Ads/Products） | 高，但只能蒐集公開頁 | 多國（清單待確認） | 無官方 API；API 需頁面簽章；Top Products 需登入 | Apify 計次 | **中～高** | 實測後暫緩，待使用者決定 |
| TikTok Shop Partner/Affiliate API | 高 | US、UK、部分 EU | Partner Center 開發者 + 賣家/創作者授權 | 免費 | 中 | 不適合當市場排名來源 |
| Amazon SP-API / Creators API | 高 | 多國 | 賣家帳號 / Associates 銷售門檻 | 免費 | **高**（條款明文禁止我們的用途） | 不走官方；Keepa 視為轉售商 |
| Reddit Data API | 高 | 不分國 | 2025-11 起須申請核准 | 商用需另談 | 中～高 | 暫緩 |

**核心結論**
1. **美國（及 CA/AU/NZ）的商業廣告，沒有任何官方 API。** Meta、TikTok、Google 的官方廣告資料都只因歐盟 DSA（以及英國）才開放。UK 是我們唯一能用官方 API 拿到「商業廣告」的優先市場。
2. **最有價值、最被低估的第一手來源是 Google Merchant API 的 Best sellers 報表**：Google 官方的「熱門商品排名 + 相對需求 + 週/月變化」，涵蓋我們全部 11 國，免費，但必須是 Merchant Center 帳號。
3. **需求面訊號**（Pinterest Trends、Keyword Planner、Google Trends alpha）在美國有完整官方管道，可以補廣告資料在美國的缺口。
4. **Amazon 官方 API 的條款明文禁止「市場研究工具」的用途**，這就是 Keepa 自己爬 Amazon 的原因。我們無法在 Amazon 做到「更接近源頭又合規」。

---

## 1. Meta 廣告（Facebook / Instagram）

### 1.1 官方 Ad Library API（`/ads_archive`）
- **涵蓋範圍【官方】**：API 涵蓋「過去 7 年全球的社會議題、選舉、政治廣告」，以及「**過去 1 年曾在英國或歐盟投放的任何類型廣告**」。沒有觸及 EU 的廣告「只有在屬於社會議題、選舉或政治時才會回傳」。
  → **UK 確認涵蓋商業廣告。** 美國、CA、AU、NZ 的純商業廣告**拿不到**。
- **Norway 待確認【未證實】**：官方寫的是「UK or EU」，Norway 屬 EEA 而非 EU。實作時要用 `ad_reached_countries=NO` 實測。
- **欄位【官方，archived-ad reference v26.0】**：
  - 所有廣告都有：`id`、`ad_creation_time`、`ad_creative_bodies`、`ad_creative_link_titles/captions/descriptions`、`ad_delivery_start_time`、`ad_delivery_stop_time`、`ad_snapshot_url`、`languages`、`page_id`、`page_name`、`publisher_platforms`、`total_reach_by_location`（支援 EU、BR、UK）。
  - UK & EU 才有：`age_country_gender_reach_breakdown`、`target_ages`、`target_gender`、`target_locations`。
  - EU 才有：`eu_total_reach`、`beneficiary_payers`。
  - `spend`、`impressions`、`demographic_distribution` 等**只有政治廣告**才有。
- **查詢參數【官方】**：`ad_reached_countries`（`ALL` 或國碼，如 `GB`）、`ad_type`（預設 `ALL`）、`ad_active_status`（預設 `ACTIVE`）、`ad_delivery_date_min/max`、`publisher_platforms`（篩選用）。
- **存取門檻【官方】**：完成身分與所在地確認（與刊登政治廣告相同的流程，可能需要幾天），建立 Meta 開發者帳號並同意 Platform Policy。
- **使用限制【官方】**：從 snapshot URL 下載創意素材時，「必須是為了分析，並遵守服務條款的資料儲存規定」。
- **成本**：免費。
- **風險**：**低**，前提是遵守 Platform Terms（實作前仍要請律師看 Platform Terms 對「轉售／衍生資料」的限制）。
- **建議**：**第一批整合**，用於 UK + DE/FR/SE/BE/ES。可用 `total_reach_by_location` 和 `eu_total_reach` 當「投放規模」代理指標。這是官方 API 唯一能給的「觸及人數」，美國版連爬蟲也拿不到。

### 1.2 公開網站 facebook.com/ads/library（美國商業廣告）
- **顯示內容【官方，transparency.meta.com】**：網站可搜尋「所有在 Meta 產品上**投放中**的廣告」。政治廣告不論是否投放中都保留 7 年；EU 投放的廣告在最後一次曝光後保留 1 年。
  → **美國商業廣告只顯示 active 的**，停播後就從 UI 消失，沒有 spend 或 reach。
- **每張廣告卡顯示的欄位【次級，交叉比對 Apify 輸出欄位】**：
  - Library ID、Active/Inactive 狀態、「Started running on <日期>」（開始投放日）。
  - Platforms 圖示（Facebook/Instagram/Messenger/Audience Network/Threads）。
  - 「N ads use this creative and text」（同素材的廣告數，Apify 欄位 `collationCount`）、「This ad has multiple versions」（多版本 / dynamic creative）。
  - 粉專名稱、文案、圖片／影片、CTA、落地頁連結。
- **Apify actor 怎麼拿到美國資料**：
  - `apify/facebook-ads-scraper` 的輸入是「Ad Library URL（含 `country` 參數）或粉專 URL」。輸出包括 `adArchiveID`、`collationId`、`collationCount`、`startDate`、`endDate`、`isActive`、`publisherPlatform`、`snapshot.*`、`pageLikeCount`；`spend`、`reachEstimate` 只在「有提供時」才出現（實際上就是 EU/UK 或政治廣告）。
  - 該頁沒有明說技術手段【官方頁未說明】。這些欄位名稱（`collationCount`、`adArchiveID`、`snapshot`）跟 Ad Library 網頁前端 internal GraphQL 回應的命名一致，所以可以合理推定它是**模擬瀏覽器呼叫網站內部 GraphQL／直接解析 UI**，不是官方 API【次級推論】。
  - 價格：$3.40–5.80 / 1,000 則（依方案）【次級，Apify 頁】。
- **條款【官方】**：
  - Meta Terms of Service（2025-01-01 生效）§3.2(3)：未經事先同意，不得以自動化方式存取或蒐集我們產品的資料，**不論是否登入 Facebook 帳號**。
  - Automated Data Collection Terms（2024-10-07 生效）：未取得 Meta「明示書面許可」不得自動化蒐集；接受條款本身不構成許可；蒐集的資料只能用於「為你的搜尋引擎提供結果」等用途，且**禁止轉讓、出售、授權**蒐集到的資料及衍生資料。
- **判例背景【次級】**：*Meta v. Bright Data*（N.D. Cal., 2024-01）認定「未登入時爬取公開資料」不構成違反 Meta 條款。不過 Meta 之後把條款改成「無論是否登入」都適用（見上），這個判例的保護範圍可能已經縮小。
- **風險**：**高**。自己爬，同時違反 ToS 與 Automated Data Collection Terms；用 Apify 只是把執行風險轉給第三方，我們「轉售衍生資料」的部分仍在條款射程內。
- **原建議**：不自建爬蟲。**使用者已決定蒐集**（ADR-006）：低頻率、不繞過任何防護、被擋就停止，限個人研究使用；對外開放或收費前必須重新評估。

### 1.3 其他官方管道（美國商業廣告）
- **Meta Content Library / API【官方】**：申請者必須隸屬於以科學或公益研究為主要目的的**非營利**學術或研究機構。營利公司**不符資格**，而且官方頁面描述的內容是公開貼文、Marketplace 等，沒有提到商業廣告。
- **Ad Targeting dataset【官方】**：僅限核准研究者，且只涵蓋政治廣告。
- **結論**：**美國商業廣告沒有任何官方途徑。**

---

## 2. TikTok

### 2.1 TikTok Creative Center（Top Ads / Top Products / Trends）
- **內容【官方 help center + 次級】**：
  - Top Ads：只收錄廣告主在 Ads Manager 勾選授權的廣告【官方】。可依 Region、Industry、Objective 篩選，有逐秒互動曲線。排序有 For You / Reach / CTR，可篩選 likes。CTR/CVR 為 0–100 的指數，不是絕對值【次級】。
  - Top Products：依地區、類別、近 1/7/30 天排名「在廣告中出現的商品」，可按 Popularity、Popularity change 排序【官方 help】；詳情頁有 CTR、CPA、曝光趨勢【次級】。**僅桌機版，且需登入**【次級】。
- **國家涵蓋【未證實】**：官方 help 頁沒有列出國家清單。第三方說 Top Ads 約 28 國【次級】。要登入後在 Region 篩選器實際確認 US/CA/UK/AU/NZ。
- **官方 API**：**無**。Creative Center 不在 TikTok API for Business 或 Commercial Content API 的範圍內（官方文件查無對應端點）。
- **條款【官方，TikTok US ToS，2026-07-15 更新】**：§3.4 禁止「以任何自動化系統或軟體（包括 bots）擷取、爬取、匯出或以其他方式提取任何資料」，除非經 TikTok USDS Joint Venture 書面核准。Creative Center 本身另有 TikTok Business 條款（登入頁，無法公開讀取）。
- **風險**：**中～高**。Top Ads 不需登入，風險較低；Top Products 需登入，屬於「登入後自動化」，違約風險明顯較高。
- **現況**：依 ADR-006 評估自建，但 Top Ads 的 API 需要頁面簽章（不偽造），且回應沒有商品網址，暫緩；改由使用者決定是否用官方 Commercial Content API 或付費 Apify。

### 2.2 TikTok Commercial Content API
- **涵蓋【官方】**：產品頁寫「這個階段**只**包含 EU 國家的資料」，但「Supported Countries」頁列出 EU + EEA（**含 NO**）+ **GB、CH**（不含 TR）。→ **UK 有涵蓋**，美國、CA、AU、NZ 沒有。
- **欄位【官方】**：`ad.id`、`ad.first_shown_date`、`ad.last_shown_date`、`ad.status`、`ad.videos`、`ad.image_urls`、`ad.reach.unique_users_seen`、`advertiser.business_id/business_name/paid_for_by`。資料保留到最後一次曝光後 1 年。
- **門檻【官方】**：TikTok for Developers 帳號（需官方 email）+ 填表審核。產品頁說服務對象是「公眾與研究者」，沒有明文排除商業公司。
- **成本**：免費。**風險**：低。
- **建議**：**第一批申請**（UK + EU 市場）。

### 2.3 TikTok Shop Partner / Affiliate API
- **內容【官方，TikTok for Developers blog】**：Affiliate APIs 可建立／管理 open 與 targeted collaboration、依 GMV／關鍵字搜尋創作者、**依類別／佣金率／關鍵字搜尋有 open collaboration 的商品**、產生推廣連結、查詢聯盟訂單。官方說明**沒有提到商品層級的銷量或 GMV 排名**。
- **門檻**：在 Partner Center 註冊為 Affiliate app developer；資料需要賣家或創作者 OAuth 授權（只看得到被授權帳號的資料）【次級：Celigo、Truto 端點清單】。
- **結論**：可以拿到「哪些商品正在招募聯盟（佣金率）」，算是弱訊號；**拿不到全站 top-selling 排名**。市面上 Kalodata、FastMoss 等的銷量數字並非來自官方 API【次級推論】。
- **風險**：中（用途需符合 Partner 條款，且必須有真實賣家／創作者授權）。
- **建議**：暫不整合；等我們有創作者使用者時再評估。

### 2.4 TikTok Shop 營運國家（截至 2026-10）
- **確認營運**：US、UK【多個次級來源一致】；**FR、DE、IE、IT、ES**【官方 newsroom 2026-05-28 稱已營運】；**NL、BE、AT、PL** 自 2026-06-15 上線【官方 newsroom】。另有東南亞、JP、MX、BR 等【次級】。
- **我們的市場**：US、UK、DE、FR、ES、**BE** 有 TikTok Shop。
- **尚未上線**：**AU**（2026-08 Pattern 報導 TikTok 未確認上線日期；ANZ 主管曾表示不知道有上線計畫）【次級】；**CA**（2026 年初報導尚未上線）【次級】；**NZ、SE、NO** 查無上線資訊【未證實】。

---

## 3. Google

### 3.1 SerpApi 的來源與法律現況
- SerpApi 直接爬 Google Search、Trends、Shopping、Ads Transparency 頁面。
- **訴訟【次級，多家媒體】**：Google 在 2025-12-19 依 DMCA §1201（規避 SearchGuard）起訴 SerpApi。2026-07 法院以「搜尋結果本身不是受著作權保護的作品」駁回大部分請求，Knowledge Panel 相關部分准許修正。Google 在 2026-08-10 提出修正起訴狀，案件仍在進行（Case No. 4:25-cv-10826-YGR）。
- **含意**：使用 SerpApi 的直接法律風險在買方身上不大，但**供應商有被斷供的風險**，所以要有官方替代來源。

### 3.2 Google Trends API（alpha）
- **【官方】** 目前是 alpha，接受 alpha tester 申請，名額有限。提供**近 5 年滾動資料**，可按日／週／月／年彙總，可比較國家與子區域。數值是**一致縮放**（不是 0–100 正規化），所以可以跨請求拼接，也能比較超過 8 個詞。
- 優先審核「有具體用例、能很快開始、願意回饋」的開發者。
- **成本**：未公布。**風險**：低。
- **建議**：**立刻申請**；拿到之前沒有 Google Trends 資料（SerpApi 屬中間商，依 ADR-005 不用）。

### 3.3 Google Ads Transparency Center → BigQuery public dataset
- **【官方 README】** 有兩個資料集：`creative_stats` 與 `removed_creative_stats`，提供 JSON 下載，也可在 BigQuery 公開資料集 `bigquery-public-data.google_ads_transparency_center` 查詢。
- **涵蓋**：`creative_stats` 的 region_stats 僅限「**EEA 與土耳其**」；`removed_creative_stats` 僅 EEA。→ **不含 UK、US、CA、AU、NZ。** NO 屬 EEA，有涵蓋。
- **欄位**：advertiser_id、creative_id、creative_page_url、ad_format_type、廣告主名稱／所在地／驗證狀態、topic、region_stats（region_code、first_shown、last_shown、times_shown 上下限）。**沒有文案或圖片**，要另外開 creative_page_url 才看得到。
- **商業 vs 政治**：README 沒有限定政治廣告，而且欄位設計（topic、advertiser verification、DSA 移除原因）顯示**涵蓋所有廣告**。另有獨立的 `google_political_ads` 資料集【次級】。論壇使用者回報資料集筆數少於網站顯示【次級】。
- **成本**：BigQuery 依查詢量計費（每月有免費額度）。**風險**：低。
- **建議**：第二批。可用來算「某廣告主在 EEA 的投放時長與曝光區間」，但無法反映英語市場。

### 3.4 Google Merchant Center：Best sellers / Popular products（重點）
- **內容【官方】**：Best sellers 報表依 Shopping ads 與免費商品資訊的資料，列出熱門**商品叢集**（同一商品的不同賣家與變體）與熱門品牌。不含二手商品。
  - Merchant API 的 `BestSellersProductClusterView` 欄位：`report_date`、`report_granularity`（WEEKLY/MONTHLY）、`report_country_code`（必填）、`report_category_id`、`title`、`brand`、`category_l1–l5`、`variant_gtins`、`rank`、`previous_rank`、`relative_demand`、`previous_relative_demand`、`relative_demand_change`、`inventory_status`、`brand_inventory_status`。另有 `BestSellersBrandView`。
  - `relative_demand` 是相對於同類別、同國家第一名的需求等級；`relative_demand_change` 表示上升、下降或持平 → **正好是我們要的「動能」訊號。**
- **國家【官方】**：Popular products 資料涵蓋 36 國，**US、CA、GB、AU、NZ、DE、FR、SE、BE、ES、NO 全部都在**。
- **門檻【官方】**：「你的帳號必須符合最低資格要求」（官方沒有公開具體門檻）。從你的 Merchant Center 帳號匯出的 Market Insights 資料，其使用（包括第三方使用）必須符合 Merchant Center 條款。可以用 Merchant API `reports.search`，或用 BigQuery Data Transfer 匯出。
  → **需要一個 Merchant Center 帳號**，最好附上真實商店網域與商品 feed，才可能達到資格。
- **API 版本【官方】**：Content API for Shopping 已在 2026-08-18 sunset，2026-09-01 起間歇性回 410，2027 年初完全關閉 → **只能用 Merchant API v1**。
- **成本**：免費。
- **風險**：**低～中**。資料來源合規，但把 Market Insights 資料給我們的 SaaS 使用者看，是否符合 Merchant Center 條款，需要律師確認（官方只寫「必須符合條款」）。
- **建議**：**第一優先**。在我們的 11 個國家裡，這是**唯一由平台官方直接給出「熱門商品排名 + 趨勢」的來源**。

### 3.5 Keyword Planner（Google Ads API）
- **內容【官方】**：`GenerateKeywordHistoricalMetrics` 回傳 `avg_monthly_searches`、`monthly_search_volumes`（最多過去 4 年）、`competition`、`competition_index`（0–100）、出價區間。`GenerateKeywordIdeas` 可做關鍵字延伸。可指定國家，11 國都支援。
- **門檻【官方】**：需要 Google Ads 帳號（manager account）+ developer token。**Explorer 等級不能用 Planning（KeywordPlanIdeaService）**，必須申請 **Basic**（每日 15,000 operations）或 Standard。
- **政策【官方】**：token 只能用於申請時描述的用途。RMF（Required Minimum Functionality）只適用 Standard access。
- **成本**：API 免費。實務上帳號沒有投放時，搜尋量可能被給成區間【次級，未在官方 API 頁確認】。
- **風險**：低～中（申請 Basic 時要誠實描述「關鍵字研究／需求分析」的用途）。
- **建議**：**第一批**，作為商品關鍵字的絕對搜尋量。

### 3.6 Google Shopping 搜尋結果
- 沒有官方 API（SerpApi 是爬的）。上面 3.4 的 Best sellers 就是官方等價物，而且資料更好。

---

## 4. Amazon

### 4.1 Keepa 的來源
- Keepa 自己持續爬 Amazon 商品頁與 Best Sellers 清單，再以 token 計價販售。
- 價格【次級】：€49/月（20 tokens/min）起；product 每個 ASIN 1 token，best sellers 每份清單 50 tokens【次級，摘自 Keepa docs 摘要】。
- 涵蓋：約 11 個 Amazon 站（.com 到 .com.br），**AU 可能不支援**【次級，來源矛盾】，SE、BE 不支援。

### 4.2 Creators API（PA-API 5 的後繼）
- **【官方】** PA-API 5 已於 2026-05-15 停用，改用 Creators API（REST）。操作有 SearchItems、GetItems、GetVariations、GetBrowseNodes。
- **市場【官方】**：22 個站點，包括 US、CA、UK、AU、DE、FR、ES、SE、BE（**沒有 NZ、NO**）。
- **門檻【官方】**：加入目標站點的 Associates，**過去 30 天至少 10 筆合格銷售**。
- **Sales rank**：`BrowseNodeInfo.WebsiteSalesRank`（根類別 BSR）與 `BrowseNodes.SalesRank`（各類別排名）【官方 PA-API 文件，Creators API 沿用同名 resource】。**沒有 Best Sellers 或 Movers & Shakers 清單端點。**
- **條款【官方，Associates Program Policies 2026-04-14】**：
  - IP License §2(e)：未經事先書面核准，不得「為了**彙總、分析、擷取或再利用**任何 Product Advertising Content」而使用 API。
  - §2(h)：非圖片內容最多快取 24 小時，圖片不得快取，ASIN 可無限期保存。
  - §1(a)：Program Content 只能用來把終端使用者與銷售導向 Amazon。
- **風險**：**高**（BSR 歷史分析正是被禁止的用途）。

### 4.3 Selling Partner API（SP-API）
- **Catalog Items API【官方】**：`getCatalogItem` / `searchCatalogItems` 加上 `includedData=salesRanks`，可取得 `classificationRanks` 與 `displayGroupRanks`（即 BSR），速率 5 rps。
- **Brand Analytics Search Terms report【官方】**：`GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT`（searchTerm、searchFrequencyRank、clickedAsin、clickShare、conversionShare）。需要 Brand Analytics role，**且必須在 Amazon Brand Registry 註冊並是品牌代表**。
- **Acceptable Use Policy【官方】**：
  - 用途限於協助授權賣家經營他們在 Amazon 的業務。
  - §4.3：不得使用或提供「販售從 Amazon 網站取得資料」的外部資料服務。
  - §4.4：不得跨授權使用者彙總資料。
  - §4.5：不得發布或分享關於 Amazon 業務的洞察。
- **費用【次級】**：Amazon 原訂 2026 年起向第三方開發者收 $1,400/年與 GET 呼叫費，**2026-05 宣布「目前不推行」**。
- **風險**：**高**（「熱門商品發掘 SaaS」直接落在 §4.3、§4.5 的禁止範圍）。

### 4.4 Movers & Shakers / Best Sellers 頁
- 沒有任何官方 API，只能爬。Amazon Conditions of Use 禁止 data mining 與 robots（本次抓取官方頁面時遇到 503，未能逐字引用）。

### 4.5 結論
- 官方 API 條款都明文禁止我們的用途。**Amazon 沒有「更接近源頭又合規」的路。**
- 建議：Amazon 訊號維持**低權重**，若保留就用 Keepa（明確標為第三方資料）；長期以 Google Merchant Best sellers 取代「電商熱銷排名」的角色。

---

## 5. 其他第一手需求訊號

### 5.1 Pinterest Trends API（推薦）
- **【官方 OpenAPI spec】** `GET /v5/trends/keywords/{region}/top/{trend_type}`
  - `trend_type`：`growing`（上一季搜尋量高成長）、`monthly`、`yearly`、`seasonal`。
  - `region`：`US`、`CA`、`GB+IE`、`AU+NZ`、`DE+AT+CH`、`FR`、`ES`、`IT`、`SE+DK+FI+NO`、`NL+BE+LU` 等 → **涵蓋我們全部市場**（部分為區域合併）。
  - 可依興趣、性別、年齡篩選；回傳週／月／年成長率，以及過去一年的每週相對搜尋量 time_series。只能拿「今天」的排名，不能查歷史日期（所以要每天存快照）。
- **門檻【官方】**：OAuth scope `user_accounts:read`。Trends API 的定位是給「agencies、Enterprise clients、partner platforms」，可能需要額外核准【官方文件措辭，實際門檻未證實】。
- **成本**：免費。**風險**：低～中（要遵守 Pinterest Developer Guidelines 的資料使用規定，實作前要讀）。
- **建議**：**第一批**。Pinterest 是家居、美妝、禮品類 dropshipping 的早期需求指標。

### 5.2 eBay
- **Marketplace Insights API【官方】**：`/item_sales/search` 可依關鍵字、GTIN、ePID、類別查詢**過去 90 天成交紀錄**。這是 eBay 版的 Terapeak 資料。屬 **Limited Release**，只開放給 eBay 業務單位核准的開發者，類別也需要逐一白名單。
- **Browse API**：只有在售商品（價格、賣家、`itemCreationDate` 等），**沒有成交量**。watchCount 在 Browse API 是否可得，本次無法讀取官方型別頁（403）【未證實】。
- **Terapeak**：只在 Seller Hub UI 裡，**沒有 API**。
- **建議**：申請 Marketplace Insights（核准機會不高，但成本低）；不要爬 Terapeak。

### 5.3 Shopify 店家
- 原本規劃逐店讀取 `/products.json`、`/products/{handle}.js`。後來發現官方 **Shopify Global Catalog** 可依國家搜尋跨店商品、也能直接用商品網址查詢，已改用（見 [`store-signals.md`](store-signals.md)）。

### 5.4 Reddit
- 【次級】2025-11 起 Responsible Builder Policy 關閉 self-service，存取 API 前**必須申請並取得明確核准**；Data API 條款限制商業用途。
- **建議**：暫緩；如果之後需要，走官方商業授權。

### 5.5 Etsy
- Open API v3 有 `num_favorers`、`quantity` 等欄位，但沒有商品層級銷量【次級】。Etsy 與 dropshipping 的品類重疊有限。
- **建議**：不優先。

---

## 6. 建議整合順序（US/CA/UK/AU/NZ 優先）

| 排名 | 來源 | 理由 | 主要涵蓋 |
|---|---|---|---|
| 1 | **Google Merchant API — Best sellers（Market insights）** | 唯一的官方「熱門商品排名 + 需求變化」，11 國全涵蓋，免費 | 全部 |
| 2 | **Pinterest Trends API** | 官方趨勢關鍵字＋成長率，涵蓋 US/CA/GB/AU+NZ | 全部（區域合併） |
| 3 | **Google Ads API — Keyword Planner** | 絕對搜尋量與 4 年月度歷史，用來驗證需求 | 全部 |
| 4 | **Meta Ad Library API** | UK 是唯一能合法拿到商業廣告投放日與觸及人數的優先市場 | UK + EU |
| 5 | **TikTok Commercial Content API** | 同上，TikTok 版（含首／末次曝光日、觸及人數） | UK + EU/EEA |
| 6 | **Google Trends API（alpha）** | 一致縮放的長期趨勢；先申請，期間用 SerpApi | 全部 |
| 7 | **Shopify Global Catalog**（已串接） | 官方跨店商品搜尋，提供廣告主售價與同類商品數 | 全部 |

暫不列入但可以另外申請：eBay Marketplace Insights、Google Ads Transparency BigQuery（只有 EEA）。
已自建：Meta Ad Library 網站（美國等市場，ADR-006）。暫緩：TikTok Creative Center、Keepa（Amazon，中間商）。

---

## 7. 帳號申請

要申請的帳號與金鑰、優先順序與能換到的成果，統一維護在 `docs/loop/HUMAN_TODO.md`。
不建議申請：Amazon SP-API、Amazon Creators API（條款禁止我們的用途）、Meta Content Library（營利公司不符資格）。

---

## 8. 尚未確認的事項（接上對應來源時實測）
- [ ] Meta Ad Library API 是否涵蓋 **Norway**（用 `ad_reached_countries=NO` 實測）。
- [ ] Merchant Center **Market insights 的最低資格**，以及 Best sellers 資料能否在 SaaS 中展示給第三方（請律師看 Merchant Center 條款）。
- [ ] TikTok Creative Center Top Ads/Top Products 的 **Region 清單**（登入後確認 CA/AU/NZ）。
- [ ] Pinterest Trends API 的實際核准門檻與 Developer Guidelines 的資料使用限制。
- [ ] Meta Platform Terms 對 Ad Library API 資料「商業再散布」的限制（律師）。

---

## 來源

### Meta
- [Ad Library API 說明頁（facebook.com/ads/library/api）](https://www.facebook.com/ads/library/api/)【官方】
- [Graph API `ads_archive` reference](https://developers.facebook.com/docs/graph-api/reference/ads_archive/)【官方】
- [Graph API ArchivedAd reference](https://developers.facebook.com/docs/graph-api/reference/archived-ad/)【官方】
- [Meta Ad Library tools（Transparency Center）](https://transparency.meta.com/researchtools/ad-library-tools)【官方】
- [Meta Content Library 資格](https://transparency.meta.com/researchtools/meta-content-library)【官方】
- [Meta Terms of Service](https://www.facebook.com/terms.php)【官方】
- [Automated Data Collection Terms](https://www.facebook.com/apps/site_scraping_tos_terms.php)【官方】
- [Apify `apify/facebook-ads-scraper`](https://apify.com/apify/facebook-ads-scraper)【次級】
- [Meta v. Bright Data 判決分析（Farella Braun + Martel）](https://www.fbm.com/post/102kqw7/)【次級】
- [TechCrunch：Court rules in favor of Bright Data](https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued)【次級】

### TikTok
- [Commercial Content API 產品頁](https://developers.tiktok.com/products/commercial-content-api)【官方】
- [Commercial Content API Supported Countries](https://developers.tiktok.com/doc/commercial-content-api-supported-countries)【官方】
- [Commercial Content API Query Ads](https://developers.tiktok.com/doc/commercial-content-api-query-ads)【官方】
- [TikTok Shop Affiliate APIs 發布](https://developers.tiktok.com/blog/2024-tiktok-shop-affiliate-apis-launch-developer-opportunity)【官方】
- [Creative Center Top Ads help](https://ads.tiktok.com/help/article/top-ads?lang=en)【官方】
- [Creative Center Top Products help](https://ads.tiktok.com/help/article/top-products?lang=en)【官方】
- [How to use Top Products](https://ads.tiktok.com/help/article/how-to-use-top-products)【官方】
- [TikTok Terms of Service（US）](https://www.tiktok.com/legal/page/us/terms-of-service/en)【官方】
- [TikTok Newsroom：TikTok Shop 在荷蘭等國上線（2026-05-28）](https://newsroom.tiktok.com/tiktok-introduceert-tiktok-shop-in-nederland?lang=nl-NL)【官方】
- [Social Media Today：Top Products 功能](https://www.socialmediatoday.com/news/TikTok-Adds-Top-Products-info-to-Creative-Center/643190/)【次級】
- [Pattern AU：TikTok Shop 尚未在澳洲上線](https://au.pattern.com/blog/tiktok-shops-is-coming-to-australia-everything-you-need-to-know/)【次級】
- [ContentGrip：Australia is still waiting](https://www.contentgrip.com/tiktok-shop-australia-delay/)【次級】
- [Ontario Business Central：TikTok Shop Canada 狀態](https://www.ontariobusinesscentral.ca/blog/?p=10930)【次級】
- [Celigo TikTok Shop connector 端點清單](https://docs.celigo.com/hc/en-us/articles/18704697472667)【次級】

### Google
- [Google Trends API（alpha）](https://developers.google.com/search/apis/trends)【官方】
- [Ads Transparency Center 資料集 README](https://storage.googleapis.com/ads-transparency-center/api-data/README.txt)【官方】
- [Google Developer forum：BigQuery 資料集只有 EEA/Turkey](https://www.googlecloudcommunity.com/gc/Data-Analytics/Querying-public-google-ads-transparency-center-table-doesn-t/m-p/855879)【次級】
- [Merchant Center Popular products（36 國）](https://support.google.com/merchants/answer/9488679?hl=en)【官方】
- [Merchant Center Best sellers 說明](https://support.google.com/merchants/answer/6288242?hl=en)【官方】
- [Best selling products 報表指南](https://developers.google.com/shopping-content/guides/reports/best-selling-products)【官方】
- [Merchant Reports v1 `BestSellersProductClusterView`](https://docs.cloud.google.com/php/docs/reference/shopping-merchant-reports/latest/V1.BestSellersProductClusterView)【官方】
- [Content API for Shopping sunset](https://developers.google.com/shopping-content/guides/sunset)【官方】
- [Google Ads API：Generate historical metrics](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics)【官方】
- [Google Ads API access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)【官方】
- [Google Ads API policies](https://support.google.com/adspolicy/answer/6169371)【官方】
- [IPWatchdog：Google sues SerpApi](https://ipwatchdog.com/2025/12/26/google-sues-serpapi-parasitic-scraping-circumvention-protection-measures/)【次級】
- [Search Engine Roundtable：Google v. SerpApi 駁回](https://seroundtable.com/google-lawsuit-serpapi-dismissed-41731.html)【次級】
- [Search Engine Journal：Google 修正起訴狀](https://www.searchenginejournal.com/google-amends-serpapi-suit-with-content-licensing-terms/585505/)【次級】

### Amazon
- [Creators API Introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)【官方】
- [Creators API Locale Reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference)【官方】
- [Creators API BrowseNodeInfo](https://affiliate-program.amazon.com.au/creatorsapi/docs/en-us/api-reference/resources/browse-node-info)【官方】
- [PA-API 5 停用公告](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation)【官方】
- [Associates Program Policies（含 IP License）](https://affiliate-program.amazon.com/help/operating/policies)【官方】
- [SP-API Analytics report types（Brand Analytics）](https://developer-docs.amazon/sp-api/docs/report-type-values-analytics)【官方】
- [SP-API Catalog Items v2022-04-01](https://developer-docs.amazon/sp-api/docs/catalog-items-api-v2022-04-01-reference)【官方】
- [SP-API Acceptable Use Policy](https://sellercentral.amazon.com/mws/static/policy?documentType=AUP&locale=en_US)【官方】
- [SP-API 費用公告頁](https://developer.amazonservices.com/spp-announcement)【官方】
- [PPC Land：Amazon 撤回 SP-API 費用](https://ppc.land/amazon-drops-sp-api-fees-after-developer-pushback)【次級】
- [Keepa API Plans & Tokens](https://keepa.com/api-docs/plans-tokens.html)【官方（Keepa）】
- [RevenueGeeks：Keepa 價格](https://revenuegeeks.com/keepa-pricing/)【次級】

### 其他
- [Pinterest API v5 OpenAPI spec（GitHub）](https://github.com/pinterest/api-description)【官方】
- [Pinterest Trends 文件](https://developers.pinterest.com/docs/analytics-and-reports/trends/)【官方】
- [eBay Marketplace Insights API overview](https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html)【官方】
- [eBay Research APIs](https://developer.ebay.com/develop/buying-apps/research-apis)【官方】
- [r/redditdev：Responsible Builder Policy 公告（鏡像）](https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/noh6fun)【次級】
