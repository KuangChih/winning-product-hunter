# 店家層級訊號研究：Shopify 與類似電商店家（2026-10-10）

目的：釐清 Dropship.io、TrendTrack、Koala Inspector、PPSPY、ShopHunter、Commerce Inspector、StoreLeads 這類工具用的「店家訊號」從哪裡來、哪些是我們能**合法且穩定**取得的第一手（first-party）資料，並決定 v1 要做什麼。

可信度標記（沿用 `data-sources.md`）：🟢 官方文件／本次實測、🟡 第三方或廠商／聯盟部落格（次要來源，實作前需再確認）。
「實測」指 2026-10-10 以少量請求（< 20 次，間隔正常）對一家大型 Shopify 店（allbirds.com）做的抽查，只代表單一店家當天的行為。

> 本文件不是法律意見。標示「高風險」的項目在上線前應請律師確認。

---

## 總結

| # | 方法 | 訊號 | 覆蓋（我們的國家） | 取得條件 | 成本 | ToS／法律風險 | 可靠度 | 建議 |
|---|---|---|---|---|---|---|---|---|
| A | Shopify **Global Catalog**（UCP / Catalog MCP） | 跨商家商品搜尋、零售價、商家網域、庫存狀態（available / running low）、評分；可用 `ships_to` 依國家篩選 | 全部 Shopify 商家；`ships_to` 可涵蓋全部 11 國 🟢 | 在 Developer Dashboard 註冊 agent profile（Spring '26 起免審核）🟡 | 免費 🟡 | **低～中**：官方開放管道，但用途條款（UCP／Catalog）尚未找到明文，需確認是否允許「分析／轉售洞察」 | 高（結構化、官方） | **v1 第一優先**：零售價與「多少店在賣」 |
| B | 單店公開 JSON：`/products.json`、`/products/<handle>.js`、`/meta.json`、`sitemap_products_*.xml` | 上架時間（`created_at`/`published_at`）、價格、`compare_at_price`、變體、`available`；`meta.json` 有店家國家、幣別、`ships_to_countries` | 全部 Shopify 店（需逐店抓） | 無需帳號；必須低速、帶身分的 User-Agent | 免費 | **中**：robots.txt 預設**未**禁止這些路徑，但 Shopify 2026-05-30 起對未簽章 bot 嚴格限速；若營運者本身持有 Shopify 帳號，Shopify ToS §1(9) 禁止用 robot/scraper 存取「Services」 | 中高（欄位穩定，但會被 429/430 擋） | **v1 採用，但只限少量**：只抓從廣告／Catalog 找到的店，不做全網爬 |
| C | 店家自己的 UCP 端點（`/.well-known/ucp`、`/api/ucp/mcp` 的 `search_catalog`） | 單店結構化商品／價格 | 有實作 UCP 的 Shopify 店（實測 allbirds 有）🟢 | 無需帳號（discovery）；需遵守 agent 規則 | 免費 | 低～中：Shopify 主動為 agent 開放的管道 | 中（新協定，版本變動快） | v1.5：作為方法 B 的「官方替代」 |
| D | 庫存數量差分（inventory_quantity tracking） | 推估銷量 | 只有 2017-12-05 前建立的店，或主題外洩欄位的店 | 需高頻輪詢 | 免費但耗資源 | **中～高**：Shopify 刻意移除此欄位以防 bot；高頻輪詢違反限速精神 | **低**：dropshipping 店多設「無限庫存」 | **不做** |
| E | `updated_at` 變動計數（PPSPY 類） | 推估「有在賣」 | 全部 | 輪詢 | 免費 | 中 | **低**：`updated_at` 會因非銷售原因變動 🟡 | 不做；最多當「店家活躍度」 |
| F | 訂單編號差分（自己下單兩次） | 期間訂單數 | 個別店 | 真實購買 | 每店每次一筆訂單 | **高**：需真實付款、退款；結帳頁現在常只顯示隨機 Confirmation # 🟡 | 低～中 | **不做** |
| G | `collections/all?sort_by=best-selling` 排名變化 | 店內暢銷排序 | 全部 | 無 | 免費 | **中～高**：Shopify 預設 robots.txt 明確 `Disallow: /collections/*sort_by*` 🟢 | 中（只有相對排名） | **不做**（違反 robots.txt） |
| H | `/cart.js` 加購探測庫存 | 庫存上限 | 全部 | 需操作購物車 | 免費 | **高**：`/cart` 被 robots.txt 禁止；屬於操弄店家系統 | 中 | **不做** |
| I | 流量 × 轉換率 × 客單價（Similarweb 類） | 營收量級 | 大店才準 | 第三方 API | 高 | 低（買資料） | 低（小店幾乎無資料）🟡 | 不做 |
| J | Meta Ad Library（EU/UK 商業廣告）→ 落地頁網域 | 「誰在打廣告賣這個」、店家網域 | 只有投放到 EU/UK 的廣告（德、法、瑞典、比利時、西班牙、英國；挪威屬 EEA 需確認）🟢 | 身分驗證 | 免費 | 低（官方 API；但轉售用途條款待確認，見 `data-sources.md`） | 中：`ad_creative_link_captions` 通常是顯示網域，不保證是完整 URL 🟢 | **v1 採用**：店家發現的主管道 |
| K | TikTok Commercial Content API → 落地頁 | 同上 | EU/EEA（+UK、CH，第三方說法不一）🟡 | 申請審核 | 免費 | 低 | 中 | 已在申請流程（見 `data-sources.md`） |
| L | StoreLeads 資料集 | 店家清單、`country_code`、`estimated_sales`、商品數、價位、最近上架商品 | 全球、含 11 國；1,370 萬店 🟡 | 付費帳號；API 需 Pro 以上 🟢 | Pro **$250/月**；商品搜尋與歷史資料只有 Enterprise **$950/月** 🟢 | 低（買授權資料；需看授權是否允許在我們產品中再呈現） | 中（`estimated_sales` 為模型推估） | **暫不買**；條件達成再買 Pro 一個月 |
| M | BuiltWith / Wappalyzer | 技術堆疊、店家清單 | 全球 | 付費 | BuiltWith Basic $295/月起 🟡；Wappalyzer Pro 約 $250/月 🟡 | 低 | 中（無商品層級資料） | **不買**（對選品幫助小） |
| N | Common Crawl CDX、憑證透明度（CT）日誌 | 找出 Shopify 店網域、商品 URL | 全球，但偏大站 | 無 | 免費（運算成本） | 低（Common Crawl 本身遵守 robots.txt）🟡 | 低～中：自訂網域不會顯示 Shopify，需再驗證 | v2 再考慮 |
| O | Shopify 官方趨勢報告、BFCM 數據、Shopify Collective | 品類層級趨勢、季節性 | 全球 | 公開 | 免費 | 低 | 只能當背景，不是產品層級訊號 | 只當季節性先驗 |

---

## 1. Shopify 公開店面端點

### 1.1 各端點暴露哪些資料（2026-10-10 實測 🟢）

| 端點 | 主要欄位 | 備註 |
|---|---|---|
| `/products.json?limit=250&page=N` | product：`id`、`title`、`handle`、`body_html`、`vendor`、`product_type`、`tags`、`created_at`、`published_at`、`updated_at`、`images`、`options`；variant：`price`、`compare_at_price`、`available`、`sku`、`grams`、`created_at`、`updated_at` | **沒有** `inventory_quantity`。`limit` 上限 250、`page` 參數實測仍可用。 |
| `/products/<handle>.js` | 價格以「分」為單位（`price`、`price_min/max`、`compare_at_price_*`）、`published_at`、`created_at`、`variants[].available`；部分店仍出現 `inventory_quantity`、`inventory_policy`、`inventory_management` | allbirds（2017 年前建立）實測回傳真實庫存數字（例如 5、37）。這是例外，不是通則。連續請求時部分回應不是 JSON（疑似被節流）。 |
| `/meta.json` | 店名、`country`、`province`、`city`、`currency`、`ships_to_countries`、`published_products_count`、`myshopify_domain` | **判斷店家國家最直接的第一手訊號**。 |
| `/sitemap.xml` → `sitemap_products_1.xml?from=…&to=…` | 每個商品 URL + `lastmod` + 主圖 | 適合找出新上架商品；新版 sitemap 另含 `sitemap_agentic_discovery.xml` → `agents.md`。 |
| `/collections/all?sort_by=best-selling` | HTML 的店內暢銷排序 | 預設 robots.txt **禁止**。 |
| `/cart.js` | 目前購物車（含幣別） | 預設 robots.txt **禁止** `/cart`、`/carts`。 |

### 1.2 庫存欄位的歷史

- 2017 年 12 月 Shopify 讓 Liquid `json` filter 不再輸出 `inventory_quantity` 與 `inventory_policy`，明講目的是防止未經授權的 bot／爬蟲知道庫存水位；2017-12-05 之後建立的店不再回傳這兩個值 🟢。
- 結論：絕大多數 dropshipping 新店拿不到庫存；能拿到的多半是老牌品牌店（不是我們要找的對象）。再加上 dropshipping 店常用「無限庫存」，庫存差分法對我們幾乎沒有價值。

### 1.3 限速與 bot 防護（2025–2026 的關鍵變化）

- **2025 年 8 月**：Shopify 推出 Web Bot Auth，讓商家在後台（Online Store > Preferences > Crawler access）為「自己的」爬蟲產生簽章；簽章綁定單一網域、最長 3 個月、不能用於結帳 🟢（help center）。
- **2026-05-07 公告、2026-05-30 生效**：Storefront API 與 Shopify 託管的店面頁面對 bot／agent 收緊限速，**未簽章的流量最嚴格**；簽 Web Bot Auth 可拿較高額度，再更高需填表向 Shopify 申請 🟢。
- 店面前面是 Cloudflare（實測回應標頭 `Server: cloudflare`、`powered-by: Shopify`）🟢。被判定為惡意會回 `430 Shopify Security Rejection`；一般超量回 429 🟢。
- 社群回報：第三方爬蟲即使簽了 Web Bot Auth，從雲端 IP（如 OCI）出去仍立刻 429，需向 Shopify 註冊才會被視為已驗證 🟡。實測 gymshark.com 的 `/products.json` 對我們的抓取工具回 403 🟢——大店可能另有額外防護。
- **結論**：v1 不能假設能大量輪詢任意店。必須（1）只抓少量目標店；（2）每店每天最多一次；（3）User-Agent 寫明產品名與聯絡信箱；（4）遇 429/430/403 立即退避且**不**用代理池或住宅 IP 繞過（我們的合規規則已禁止繞過反爬）。長期若需要量，應向 Shopify 申請已驗證 bot 身分。

### 1.4 Storefront API（官方 GraphQL）

- **免 token**（tokenless）即可查商品、系列、搜尋、購物車；查詢複雜度上限 1,000 🟢。
- 公開／私有 token 是**店家**發給 app 的，不能拿來查別人的店；而且 API Terms 規定 API 只能用來為商家提供 app，並禁止為 benchmarking 監控 API 🟢。→ 不適合用來做競品情報。
- 對我們有用的只有 tokenless 端點，但它同樣受 bot 限速，與方法 B 的風險相同。

### 1.5 ToS 與 robots.txt

- **Shopify Terms of Service §1(9)**：同意「不使用 robot、spider、scraper 或其他自動化方式存取 Services 或監控其中資訊」；§1(8) 禁止繞過技術限制 🟢。這份條款約束的是 **Shopify 帳號持有人**。若老闆本人或公司有 Shopify 店（dropshipper 通常有），就受此條款拘束——這是我們最實際的 ToS 風險。
- **個別店家的 robots.txt**（Shopify 預設，實測 🟢）：禁止 `/cart`、`/carts`、`/checkout`、`/checkouts/`、`/collections/*sort_by*`；**沒有**禁止 `/products.json`、`/products/*.js`、`/meta.json`、sitemap。店家可透過 `robots.txt.liquid` 自訂，因此每店都要讀一次 robots.txt。
- 店家自己的 `agents.md`（新出現）會引導 agent 改用 UCP／Shop app 而非 screen-scraping 🟢——這是 Shopify 生態明確偏好的方向。
- 美國 hiQ v. LinkedIn 一案讓「抓取公開資料」本身在 CFAA 下風險較低，但違約（ToS）與 EU 資料庫權（Database Directive，影響德、法、瑞典、比、西）仍是風險；只抓商品資料、不抓個資可壓低 GDPR 風險。🟡（一般法律常識，需律師確認）

---

## 2. 店家情報工具如何推估營收／銷量

| 方法 | 使用者（推測） | 現況 | 可靠度 | 法律／ToS 風險 |
|---|---|---|---|---|
| 庫存差分（100 → 99 = 賣一件） | PPSPY「Live Sales」、早期 Koala/Commerce Inspector 🟡 | 2017 年起新店拿不到庫存；無限庫存店無效 | 低 | 中～高（Shopify 刻意防堵的資料） |
| `updated_at` 變動次數 | PPSPY（第三方評測描述）🟡 | `updated_at` 也會因系統內部更新而變動，且庫存變化不一定更新它 🟡 | 低 | 中 |
| 訂單編號差分（月初、月底各買一單） | 早期 ShopHunter 類、教學文 🟡 | 結帳流程改為先顯示隨機「Confirmation #」再建立訂單 🟡；需真實購買 | 低～中 | 高（需真實付款；以購物探測屬不當使用） |
| best-selling 排序位置變化 | 多數 spy 工具 🟡 | 預設 robots.txt 禁止 `sort_by` | 中（只有相對排名） | 中～高 |
| 流量 × 轉換率 × 客單價 | StoreLeads `estimated_sales`、Similarweb 系 🟡 | 小店流量資料稀少 | 低 | 低 |
| 評論數推算銷量 | 部分 Apify actor 🟡 | 評論 app 各異 | 低 | 中 |
| 「AI 預測」 | PPSPY 官網行銷用語 🟡 | 方法未公開、無法驗證 | 未知 | 未知 |

**結論**：沒有一種店家層級的「銷量」訊號同時可靠又低風險。Shopify 這幾年的方向（移除庫存、隨機確認碼、bot 限速、Web Bot Auth）都在**削弱**這類推估。我們的評分應該**不依賴店家銷量**，改用可驗證的代理訊號：
1. **跨店重複度**：同一商品在多少家店上架（Global Catalog 或廣告落地頁計數）——「多店同時賣」本身就是 winning 的強訊號，也是飽和度訊號。
2. **上架新鮮度**：`published_at` / `created_at` 距今天數（新店新品 + 正在打廣告 = 正在測品）。
3. **廣告持續度**：見 `data-sources.md`（Meta `ad_delivery_start_time`）。
4. **折扣行為**：`compare_at_price` 與 `price` 的差距（典型 dropshipping 定價手法，也可當商品定位訊號）。

---

## 3. 店家發現：找出「賣某商品的 Shopify 店」及其國家

| 管道 | 做法 | 國家判斷 | 覆蓋 | 成本 | 風險 |
|---|---|---|---|---|---|
| **Shopify Global Catalog** | `search_catalog` 以文字或圖片查詢；結果依 UPID 聚合多商家 offer，含商家網域；`ships_to` 篩選國家 🟢 | `ships_to` 篩選 + 再查 `/meta.json` | 全部 Shopify 商家（每次查詢最多翻到 1,000 筆、每頁 50 筆）🟢 | 免費 | 低～中 |
| **Meta Ad Library API** | `search_terms` + `ad_reached_countries`；`ad_creative_link_captions` 通常是落地頁顯示網域；`ad_snapshot_url` 可看完整廣告 🟢 | `ad_reached_countries` / `total_reach_by_location`（EU、UK）🟢 + `/meta.json` | 只有投放到 EU/UK 的商業廣告；美、加、澳、紐拿不到 🟢 | 免費 | 低 |
| **TikTok Commercial Content API** | 同上 | 投放國 | EU/EEA（+UK/CH 待確認）🟡 | 免費，需審核 | 低 |
| **StoreLeads** | 依技術、國家、類別篩店；`most_recently_published_product`；Enterprise 才有商品搜尋 🟢 | `country_code` 🟢 | 1,370 萬店 🟡 | $250–$950/月 🟢 | 低 |
| **BuiltWith** | 依「Shopify」技術列出網站清單 | 有國家欄位 🟡 | 大 | Basic $295/月、Pro $495/月、Team $995/月（2026 第三方報價，官方 KB 數字較舊）🟡 | 低 |
| **Wappalyzer** | 同上 | 有 | 大 | Pro 約 $250/月，各來源不一致 🟡 | 低 |
| **Common Crawl CDX** | 查 `*.myshopify.com/*`、或以 `cdn.shopify.com` 特徵找網域；每月一個新索引 🟡 | 需再查 `/meta.json` | 偏大站；遵守 robots.txt | 免費（需自建處理） | 低 |
| **憑證透明度（crt.sh）** | 列出 `*.myshopify.com` 憑證 | 無 | 只看到 myshopify 子網域；Shopify 使用多家 CA、萬用憑證，效果有限 🟡 | 免費 | 低 |

**國家判斷優先序**：`/meta.json` 的 `country` 與 `ships_to_countries`（第一手）→ 廣告投放國 → 幣別／網域 TLD（`.co.uk`、`.de`、`.com.au`、`.co.nz`、`.se`、`.no`、`.be`、`.es`、`.fr`、`.ca`）→ StoreLeads `country_code`。注意：「店家所在國」與「銷售目標國」常常不同（許多 dropshipper 店家地址在別國），評分應以**銷售目標國**（ships_to、幣別、廣告投放國）為主。

---

## 4. 零售價訊號（margin 子分數）

公式：`margin = (retail − supplierCost − shipping) / retail`。

| 來源 | 欄位 | 優點 | 注意 |
|---|---|---|---|
| **Global Catalog** | variant `price`（minor units + 幣別）、`price range`、`price tier` 🟢 | 一次拿到多店價格，可取**中位數**，抗單店極端值；可依 `ships_to` 取各國價格 | 需處理變體（不同尺寸／數量包） |
| 單店 `/products/<handle>.js` | `price`（分）、`compare_at_price`、`price_min/max` 🟢 | 第一手、精確到變體 | 逐店請求，受限速 |
| `/products.json` | `price`（字串，元）、`compare_at_price` 🟢 | 一次 250 個商品 | 同上 |
| 廣告落地頁 | Meta 只給 caption/title，不給價格 🟢 | — | 需再抓落地頁，即回到方法 B |
| 店家 `/meta.json` | `currency`、`money_format` 🟢 | 確認幣別 | — |

建議做法：
1. 以 Catalog 取同一商品（UPID 或我們自己的 entity resolution）在目標國的所有 offer，取**中位數**為 `retail`，同時記錄 min/max 與 offer 數。
2. 幣別統一換算成 USD（每日匯率），但子分數以**同一國家內**比較為主。
3. 忽略 `compare_at_price`（多為虛構的原價），只當「折扣行為」訊號。
4. 澳、紐、英、EU 的店面價通常含稅（GST/VAT），美、加不含；計算 margin 前要扣除稅率，否則歐洲與澳紐的 margin 會被高估。

---

## 5. Shopify 官方、第一手且允許使用的資料

| 資料 | 內容 | 用途 | 風險 |
|---|---|---|---|
| **Global Catalog / Catalog MCP（UCP）** | 跨商家商品、價格、庫存狀態、評分、商家網域 🟢 | 本研究最重要的發現：Shopify 自己開放的跨店商品搜尋，Winter '26 開放給開發者、Spring '26（2026-06-17）取消審核 🟡 | 低～中（需讀 UCP／Catalog 條款確認分析用途） |
| 店家 UCP 端點（`/.well-known/ucp`、`/api/ucp/mcp`） | 單店 `search_catalog` 🟢 | 取代 scraping 的官方管道 | 低～中 |
| 店家 `agents.md` | 店家對 agent 的規則 🟢 | 合規判斷依據 | — |
| Shopify 趨勢與 BFCM 公開報告 | 品類／通路層級統計（例如 AI 搜尋導流成長、BFCM 營收）🟢🟡 | 季節性先驗，不是產品訊號 | 低 |
| Shopify Collective | 同國供應商與零售商的商品探索 🟢 | 只有持有 Shopify 店的商家可用、限同國同幣別；不提供銷量 | 低，但用途不符 |
| Shop app | 消費者端 app；無公開資料 API；`shop.app/SKILL.md` 是為購物 agent 設計 🟢 | 不適合當資料來源 | — |

---

## 6. v1 建議做法

### 先做（依順序）

1. **Shopify Global Catalog adapter**（免費）
   - 用我們候選商品的標題／圖片查 `search_catalog`，帶 `ships_to` = 各優先國家。
   - 產出：每國 `offerCount`（跨店重複度）、`retailMedian`、`retailMin/Max`、商家網域清單。
   - 先寫 fixture 模式；拿到 agent profile 後切換。
2. **店家 enrich adapter（低頻、單店）**
   - 輸入：Catalog 或 Meta 廣告拿到的網域。
   - 依序：讀 `robots.txt` → `/meta.json`（國家、幣別、ships_to、商品數）→ 該商品的 `/products/<handle>.js`（價格、`published_at`）。
   - 每店每日最多 1 輪；全域速率上限（例如每秒 ≤ 1 個請求）；遇 403/429/430 記錄並跳過 24 小時。
3. **Meta Ad Library → 網域**：從 `ad_creative_link_captions` 抽網域，接上第 2 步。這解決 EU/UK 市場的「誰在打廣告賣這個」。
4. 評分層：把「跨店重複度」「上架新鮮度」「零售價中位數」接進 `scoring.md` 的子分數（margin 可以開始計算，信心度上限可提高）。

### 不要做

- 不做庫存差分、`updated_at` 計數、訂單編號差分、`sort_by=best-selling` 抓取、`/cart.js` 探測。
- 不用代理池／住宅 IP／偽裝瀏覽器繞過 Shopify 或 Cloudflare 的阻擋。
- 不全網爬 Shopify 店（成本高、會被限速、ToS 風險最大）。
- 不在產品中宣稱「某店月營收 $X」——無法驗證，且容易誤導使用者。

### 需要老闆申請／購買的項目

| 項目 | 費用 | 何時做 | 具體效益 |
|---|---|---|---|
| Shopify Partner／Developer Dashboard 帳號 + 註冊 UCP agent profile | 免費 | **現在** | 啟用 Global Catalog：全部 11 國的零售價與跨店重複度，直接補上 margin 子分數 |
| （先閱讀）Shopify UCP／Catalog 使用條款、API Terms | 免費 | 現在 | 確認「分析後呈現給付費用戶」是否被允許；若不允許，Catalog 改為只做內部比對 |
| Meta 身分驗證（Ad Library API） | 免費 | 已列在 HUMAN_TODO | EU/UK 廣告 → 店家網域 |
| Web Bot Auth 已驗證 bot 申請（向 Shopify 填表） | 免費 | 單店 enrich 每日超過數千請求時 | 避免 429，合法提高額度 |
| **StoreLeads Pro**（$250/月，年繳 85 折） | 付費 | **暫不買**。觸發條件：v1 上線後，Catalog + 廣告找到的店不足以覆蓋美、加、澳、紐（這 4 國沒有官方廣告資料） | 依國家＋類別批量列出新開的 Shopify 店與 `most_recently_published_product`，補足非 EU 市場的「新店新品」訊號；建議只買 1 個月做一次性回填，評估命中率後再決定 |
| StoreLeads Enterprise（$950/月） | 付費 | 不建議 | 商品搜尋與歷史資料，但 Catalog 已免費提供商品搜尋 |
| BuiltWith / Wappalyzer / Similarweb | 付費 | 不建議 | 只有技術堆疊或流量，對選品沒有額外價值 |

---

## 參考來源

### 官方（🟢）
- [Shopify 開發者 changelog：JSON Liquid filter 不再輸出 inventory_quantity 與 inventory_policy](https://shopify.dev/changelog/the-json-liquid-filter-will-no-longer-output-the-inventory_quantity-and-inventory_policy-fields)
- [Shopify 開發者 changelog：Bots and agents should identify themselves via Web Bot Auth（2026-05）](https://shopify.dev/changelog/bots-and-agents-should-identify-themselves-via-web-bot-auth)
- [Shopify Storefront API 2026-10（驗證、限速、430、buyer IP）](https://shopify.dev/docs/api/storefront/2026-10)
- [Shopify API limits](https://shopify.dev/docs/api/usage/limits)
- [Shopify Help Center：Crawling your store（Web Bot Auth 簽章）](https://help.shopify.com/en/manual/promoting-marketing/seo/crawling-your-store)
- [Shopify Help Center：Bot protection](https://help.shopify.com/en/manual/checkout-settings/bot-protection)
- [Shopify Help Center：Bot types and intents](https://help.shopify.com/en/manual/intro-to-shopify/bots/types-and-intents)
- [Shopify Help Center：Agentic storefronts](https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts/products)
- [Shopify Terms of Service](https://www.shopify.com/legal/terms)
- [Shopify API License and Terms of Use](https://www.shopify.com/legal/api-terms)
- [Shopify Global Catalog（Catalog MCP）](https://shopify.dev/docs/agents/catalog/global-catalog)
- [Shopify Catalog MCP](https://shopify.dev/docs/agents/catalog/catalog-mcp)
- [Shopify Editions Winter '26（開發者）](https://www.shopify.com/news/winter-26-edition-dev)
- [Shopify Editions Spring '26（開發者）](https://www.shopify.com/news/spring-26-edition-dev)
- [Universal Commerce Protocol](https://ucp.dev)
- [Shopify Help Center：Shopify Collective](https://help.shopify.com/en/manual/online-sales-channels/shopify-collective)
- [Shopify Help Center：Collective 零售商探索](https://help.shopify.com/en/manual/online-sales-channels/shopify-collective/retailers/discovery)
- [Shopify：Global Ecommerce Statistics and Trends (2026)](https://www.shopify.com/enterprise/blog/global-ecommerce-statistics)
- [Shopify：Consumer Behavior Trends 2026](https://www.shopify.com/enterprise/blog/consumer-behavior-trends)
- [Shopify Partners：Relative pagination](https://www.shopify.com/partners/blog/relative-pagination)
- [Meta ArchivedAd reference（Ad Library API 欄位）](https://developers.facebook.com/docs/marketing-api/reference/archived-ad/)
- [Meta Ad Library tools](https://transparency.meta.com/en-us/researchtools/ad-library-tools)
- [TikTok Commercial Content API](https://developers.tiktok.com/products/commercial-content-api)
- [Store Leads 官網（含方案價格）](https://www.storeleads.app)
- [Store Leads API 文件](https://storeleads.app/api)
- [BuiltWith KB：Plans and Pricing Explained](https://kb.builtwith.com/general-questions/plans-and-pricing-explained)
- [Common Crawl Index 公告](https://commoncrawl.org/blog/announcing-the-common-crawl-index)
- 實測（2026-10-10）：`https://www.allbirds.com/robots.txt`、`/products.json`、`/products/<handle>.js`、`/meta.json`、`/sitemap.xml`、`/agents.md`

### 次要來源（🟡 廠商／聯盟／社群）
- [Shopify 社群：Third-party Web Bot Auth request still receives 429](https://community.shopify.dev/t/third-party-web-bot-auth-request-still-receives-429-across-shopify-storefronts/38215)
- [Shopify 社群：Signed Web Bot Auth crawler gets 429 from OCI](https://community.shopify.dev/t/signed-web-bot-auth-crawler-gets-429-on-every-request-from-oci-since-2026-09-29/38441)
- [Shopify 社群：How does Shophunter.io access accurate revenue](https://community.shopify.com/t/how-does-shophunter-io-access-accurate-revenue-of-online-stores/132414)
- [Shopify 社群：結帳頁顯示隨機字元而非訂單編號](https://community.shopify.com/t/shopify-checkout-order-confirmation-show-random-characters-instead-of-the-order-id/149181)
- [Shopify 社群：Price change does not change product updatedAt](https://community.shopify.dev/t/price-change-does-not-change-product-updatedat/20802)
- [PowerCommerce：Shopify Tightens Storefront Rate Limits](https://powercommerce.com/blogs/shopify-updates/shopify-tightens-storefront-rate-limits-sign-requests-with-web-bot-auth-to-avoid-throttling)
- [Visionary Marketing：Shopify robots.txt deep-dive](https://visionary-marketing.co.uk/blog/shopify-robots-txt)
- [Usecart：銷量追蹤技術說明](https://usecart.com/tech)
- [Nudgify：How to see someone else's Shopify sales](https://www.nudgify.com/how-to-see-someone-elses-shopify-sales/)
- [Closo：PPSPY Review 2026](https://closo.co/blogs/blog/ppspy-review-2026-is-this-the-ultimate-shopify-spy-tool)
- [Koala Apps：PPSPY everything you need to know](https://koala-apps.io/blog/ppspy-everything-you-need-to-know/)
- [DZBuild：PPSpy 能與不能告訴你什麼](https://dzbuild.com/blog/ppspy-product-spy-tools-algeria)
- [Koala Inspector 介紹](https://koala-apps.io/koala-inspector-for-shopify/)
- [Notify-me：Shopify store revenue checker tools 2026](https://notify-me.io/post/best-shopify-store-revenue-checker-tools)
- [ColdIQ：StoreLeads pricing](https://coldiq.com/blog/storeleads-pricing)
- [SyncGTM：Store Leads Review 2026](https://syncgtm.com/blog/store-leads-review-2026)
- [PricingSaaS：BuiltWith 價格歷史](https://pricingsaas.com/companies/builtwith)
- [Prospeo：BuiltWith pricing](https://prospeo.io/s/builtwith-pricing-reviews-pros-and-cons)
- [SyncGTM：Wappalyzer Review 2026](https://syncgtm.com/blog/wappalyzer-review-2026)
- [Stellagent：Spring '26 開放 Catalog API 與 UCP](https://stellagent.ai/insights/shopify-spring-26-agentic-commerce-developers)
- [Let's Data Science：Shopify product clustering](https://letsdatascience.com/news/shopify-details-product-clustering-for-agentic-commerce-ee7e2f62)
- [AdLibrary：EU DSA Ad Repositories](https://adlibrary.com/posts/eu-dsa-ad-repositories-developers)
- [cdx_toolkit（Common Crawl 索引工具）](https://pypi.org/project/cdx-toolkit/0.9.13/)
- [Ringly：Shopify BFCM statistics](https://www.ringly.io/blog/shopify-bfcm-statistics-2026)

## 實測紀錄（2026-10-10）

- `POST https://catalog.shopify.com/api/ucp/mcp`（JSON-RPC `tools/call` → `search_catalog`），只帶 `meta["ucp-agent"].profile`（Shopify 官方範例 profile），**不需要 API key 或帳號**即回傳 200。
- 回應：`structuredContent.products[]`（`id` 為 `gid://shopify/p/{upid}`、`title`、`media`、`rating`、`price_range.min/max`（minor units + currency）、`variants[].seller{name,domain,url}`），`pagination.total_count`（估計值）。
- 同一個 `ships_to` 國家的結果可能混合幣別（例如英國結果中有 USD 標價的商品），計算毛利前需要處理。
- 以 5 個產品 × 5 個主要市場實測，共 525 筆，每個請求間隔 1.5 秒，沒有遇到限流。
