# 供應商平台研究（2026-10-10）

目的：決定 Winning Product Hunter 要接哪些**供應商／履約平台**，用來計算每個商品的「供貨成本 + 運費 + 到貨時間」（毛利子分數），並評估能否順便當**需求訊號**。
前提：老闆明確要求**不使用 AliExpress**（因此 DSers 這類以 AliExpress 為核心的工具也排除）。
目標市場：第一波 US、CA、UK、AU、NZ；第二波 DE、FR、SE、BE、ES、NO。

可信度標記：🟢 官方文件／官方說明中心、🟡 第三方文件、廠商部落格、聯盟行銷評測（實作前需再對照官方確認）、⚪ 未找到資料／推論。

> 註：本文件取代 `data-sources.md` 中「CJ 無熱門端點、第二批」的舊判斷（見下方 CJ 段落，官方文件其實有 `productFlag=Trending` 與 90 天銷量欄位）。`data-sources.md` 本身未修改。

---

## 總結表

| 平台 | 程式化存取 | 認證 | 限速 | 熱門／銷量訊號 | 運費試算 API | 本地倉（對我們市場） | API 成本 | 適合度 |
|---|---|---|---|---|---|---|---|---|
| **CJ Dropshipping** | 官方 REST API v2 + 官方 MCP server 🟢 | API Key → Access Token（180 天）🟢 | 依等級 1–6 QPS；2026-06/07 起改點數制：每日 50,000 點 🟢 | `productFlag=0`（Trending）、`listedNum`、商品詳情的 `soldOut`（90 天銷量）/`orderCount` 🟢 | `freightCalculate`（每家物流的運費 USD + 時效）🟢 | US、EU（DE 等）、部分 AU；以 API `getInventoryByPid` 查實際倉別 🟢/🟡 | 免費（帳號即可）🟢 | ★★★★★ |
| **Zendrop** | 官方 **MCP server**（`https://app.zendrop.com/mcp/v1`）🟢；**無公開 REST API 參考文件** ⚪ | OAuth 2.0（PKCE）或 Access Token，scope 制 🟢 | 讀 120/分、寫 30/分、履約 10/分 🟢 | `get_catalog_trending_products` 工具 🟢 | 有：依國家回傳運送方式、運費、到貨區間 🟢 | US 倉（只能寄美國）；其餘從中國出貨 🟢 | 可免費開始，部分功能需付費方案 🟢；Pro 約 $49–59/月 🟡 | ★★★★ |
| AutoDS | 未找到公開 API／MCP ⚪ | — | — | 有內建 product research（僅 UI）🟡 | — | 本身不是供應商，串接 25+ 供應來源 🟡 | $26.90/月起 🟡 | ★★（非供應商） |
| Spocket | 無官方公開 API 文件；`developers.spocket.co` 無法解析 ⚪；第三方稱 Empire 方案含 API 🟡 | 不明 | 不明 | 無 | 不明 | 約 80% 供應商在 US/EU，2–7 天 🟡 | $39.99–57+/月；帳單爭議多 🟡 | ★★ |
| Syncee | 未找到公開 API ⚪ | — | — | — | — | 全球供應商（含 EU/AU）🟡 | 訂閱制 | ★ |
| DSers | 未找到公開 API ⚪；且以 AliExpress 為核心 | — | — | — | — | — | — | ✗（排除） |
| HyperSKU | 官網宣稱「open API available」，但無公開文件；第三方稱無公開 API 🟡 | 需洽業務 | 不明 | 無 | 不明 | 中國出貨 5–12 天 🟡 | 無月費、成交計價 🟡 | ★★ |
| Doba | 第三方稱有 API，無公開文件 🟡 | 不明 | 不明 | 無 | 不明 | 美國供應商為主 🟡 | 訂閱制 | ★ |
| Wholesale2B | 無公開 API；只有 CSV/XML datafeed 🟡 | — | — | 無 | 無 | 美國供應商 🟡 | Datafeed 方案 | ★ |
| BrandsGateway | 無公開文件；Flxpoint 以帳密連接（Get Inventory、送單）🟡 | 帳號密碼 | 不明 | 無 | 無 | EU 精品服飾 🟡 | 約 $295/月 🟡 | ★（品類太窄） |
| Inventory Source | 供應商 feed URL + API token，需人工開通 🟡 | API token | 不明 | 無 | 無 | 美國品牌批發商 🟡 | 目錄免費，整合付費 🟡 | ★★ |
| **BigBuy**（西班牙） | 官方 API（商品、庫存、**運費與時效**、訂單），有 sandbox 🟢/🟡 | API token | 不明 | 無 | 有 🟡 | 西班牙倉，主攻 EU 🟡 | 需付費方案 🟡 | ★★★（第二波 EU） |
| **vidaXL**（荷蘭） | B2B API（token，有 sandbox）🟡 | Email + API token | 不明 | 無 | 出貨後回傳運費 🟡 | EU 多國倉、亦有 US/UK/AU 🟡 | 約 €30/月 🟡 | ★★（家具/居家品類） |
| Dropshipzone（澳洲） | 只有**供應商端** API；零售商端為 Shopify app + feed 🟡 | — | — | 無 | 無 | 澳洲本地 🟡；需澳洲 ABN/ACN | — | ★（受限） |
| Avasam（英國） | Supplier/Seller API，OAuth2 client credentials 🟡 | OAuth2 | 不明 | 無 | 不明 | 英國供應商 🟡 | 訂閱制 | ★★ |
| EPROLO | API 需向客服申請文件 🟡 | 不明 | 不明 | 無 | 不明 | 中國 + 少量海外倉 🟡 | 免費 | ★ |
| Shopify Collective | 無對外第三方 API；僅限 Shopify 商家之間 🟡 | — | — | — | — | 美國/加拿大商家 🟡 | — | ✗ |
| Printful / Printify | 官方 API 完整（含運費試算）🟢/🟡 | Bearer token | Printful 約 120 次/分 🟢 | 無 | 有 | 全球 POD 印刷廠 | 免費 | ✗（POD，非熱門現貨商品） |
| TikTok Shop | Partner API 是賣家店務 API，不提供供應商目錄搜尋 ⚪ | — | — | — | — | — | — | ✗（當需求訊號另案處理） |
| Modalyst / Sell The Trend | 未找到公開 API；仍在營運但評價普通 🟡 | — | — | STT 有 UI 版熱門工具 🟡 | — | — | 訂閱制 | ✗ |

---

## 一、Zendrop（重點確認）

### 結論：**有官方 MCP server，沒有公開的 REST API 參考文件**

- **官方 MCP server 存在** 🟢：Zendrop 產品頁自稱是「第一個推出 MCP server 的 dropshipping 平台」，支援 Claude、ChatGPT、OpenClaw、Cursor、Gemini 等任何 MCP client。
- **端點** 🟢：`POST https://app.zendrop.com/mcp/v1`（Streamable HTTP，不需本機安裝）。開發者文件範例為 `Authorization: Bearer <token>`、JSON body 帶 action，例如 `get_catalog_product`。開發者文件頁日期為 2026-06-03。
- **認證** 🟢：
  - Access Token（「透過 Zendrop APIs 建立，依 scope 限定動作」）——但文件**沒有說明在哪裡產生 token** ⚪。
  - OAuth 2.0 Authorization Code + PKCE（官方建議應用程式使用）。給 Claude/ChatGPT 用時是加入 custom connector → 跳出 Zendrop 登入授權視窗。
- **Scopes** 🟢：`catalog:read`、`orders:read`、`orders:write`、`stores:read`、`stores:write`、`my_products:write`、`billing:read`。
- **限速** 🟢：讀取 120 次/分、寫入 30 次/分、履約動作 10 次/分。
- **公開的能力**（官方未列完整 tool 清單）🟢：
  - 商品目錄：依關鍵字／分類／價格搜尋、商品詳情（`get_catalog_product`）、**熱門商品（`get_catalog_trending_products`）**。
  - **運費試算：依目的國回傳運送方式、運費、到貨時間區間**（正是毛利子分數需要的）。
  - 訂單、追蹤號碼、營收／利潤／退款分析（依日期與目的國篩選）、觸發履約（需確認步驟）、加入 import list。
- **方案** 🟢/🟡：官方說「可免費開始，部分功能可能需付費方案」。第三方：Free（約 50 單/月）、Pro $49/月、Plus $79/月，另有說法 Pro $59、Select $199 🟡。
- **MCP 的限制（對 SaaS 很關鍵）**：
  1. MCP server「只回傳屬於你帳號的資料」——它是**以單一商家帳號身分**存取。我們若用老闆自己的帳號查目錄，等於在 SaaS 後端以一個商家身分代查；目錄、價格是否可以展示給第三方使用者，ToS 並未明文允許 ⚪（Terms of Use 頁面本次無法讀取，需人工閱讀）。
  2. 沒有公開的 rate limit 以外的配額說明，也沒有 SDK、OpenAPI spec。
  3. 若要讓**每個 SaaS 使用者用自己的 Zendrop 帳號** OAuth 授權（較合規的做法），需要向 Zendrop 申請 OAuth client，文件未說明申請流程 ⚪。
- **出貨範圍** 🟢：中國倉可寄全球；**美國供應商商品只能寄美國**。官方各國平均到貨（工作天，2026-05-21 更新）：US 8.5（US 倉 3–5、中國→美 10–15）、CA 11.1（限重 3kg）、UK 9.2、AU 11.3、DE 9.5、FR 10.2；未列國家約 10–15 天。另有加 1–3 天處理期。
- **口碑** 🟡：被視為介面好、適合新手、US 倉快；但 Reddit 轉述「非 US 倉商品基本上是加價版 AliExpress」，產品成本較直接採購略高。

### 取得方式
1. 註冊 Zendrop 帳號（免費），建議升級 Pro 以確認 MCP 工具在付費方案下是否完整。
2. 在 Claude/ChatGPT 加 custom connector `https://app.zendrop.com/mcp/v1` 先手動試用 `get_catalog_trending_products` 與運費工具，確認回傳欄位。
3. 寫信給 Zendrop support 詢問：(a) 伺服器對伺服器用的 Access Token 如何產生；(b) 是否能註冊 OAuth client 給第三方 SaaS；(c) 是否允許在第三方 SaaS 顯示目錄價格與運費。

---

## 二、CJ Dropshipping（官方 API v2 + MCP）

> 注意：CJ 本身是中國的採購代理商，商品多數仍從中國出貨；但它**不是 AliExpress**，有自營 US/EU 倉與 sourcing 服務，業界普遍視為 AliExpress 的替代品。是否符合老闆「不要 AliExpress 式供應」的要求，需要老闆確認 ⚪。

### API 概況 🟢
- 文件：`developers.cjdropshipping.com`（英／中），Base：`https://developers.cjdropshipping.com/api2.0/v1/`。
- **取得 API Key**：CJ 後台 Apps → 安裝「API」app → 個人中心 API 分頁 → Add API（Type: API Key）→ 在「API Key & MCP Token」欄位複製。
- **Token**：`POST /authentication/getAccessToken`（body: `apiKey`）→ access token 與 refresh token 各 180 天；`getAccessToken` 每 5 分鐘最多 1 次。
- **限速**：依等級 Free/銷售等級 0–1 = 1 QPS、Plus = 2、Prime = 4、Advanced = 6；每 IP 10 req/s。`/setting/get` 回傳帳號的 `qpsLimit`。
- **點數制（取代每日次數上限）**：2026-06-01 後註冊者 6/1 生效，舊帳號 7/1 生效。每日 50,000 點（UTC 0 點重置，每分鐘回補 1/1440），近 3 個月最大交易額每 1 USD 再加 100 點。單價：商品列表 50 點、商品查詢 10 點、運費試算 10 點、庫存 10 點、未列出的端點 0 點。→ 免費帳號每天約可 1,000 次 listV2（每頁最多 100 筆）**或** 5,000 次運費試算。

### 我們會用到的端點 🟢
| 用途 | 端點 | 重點欄位 |
|---|---|---|
| 商品搜尋 | `GET /product/listV2` | `keyWord`、`categoryId`、`countryCode`（有庫存國家）、`verifiedWarehouse`、價格區間、**`productFlag`（0=Trending、1=New、2=Video、3=Slow-moving）**、`orderBy`（0 相關度、1 上架數 `listedNum`、2 售價、3 建立時間、4 庫存）；每頁 ≤100，總數上限 6,000 |
| 商品詳情 | `GET /product/query` | 變體、`sellPrice`、`listedNum`、各倉庫存 |
| 銷量訊號 | `POST /product/productDetail/query` | **`soldOut`（90 天銷量）、`orderCount`、`totalQuantity`** |
| 以圖搜品 | `POST /product/queryProductsByImage` | 需帳號等級 Level 3+ |
| 庫存／倉別 | `GET /product/stock/getInventoryByPid`、`queryByVid`、`queryBySku` | 每倉 `countryCode`、`areaEn`、`totalInventory`、`cjInventory`、`factoryInventory` |
| 倉庫清單 | `GET /product/globalWarehouseList` | `areaId`、`countryCode` |
| 運費 | `POST /logistic/freightCalculate` | 輸入 `startCountryCode`、`endCountryCode`、`products[{vid, quantity}]`；回傳每家物流 `logisticName`、`logisticAging`（如 "2-5" 天）、`logisticPrice`（USD）、`taxesFee`、`totalPostageFee` |
| 精準運費 | `POST /logistic/freightCalculateTip` | 需重量、尺寸、商品屬性 |
| 評論 | `GET /product/productComments` | 評分、評論國家 |

- **MCP server** 🟢：官方 GitHub `CJ-dropshipping/api-mcp`（本機 stdio，Node 20+），或遠端 `https://developers.cjdropshipping.com/mcp/<MCP_TOKEN>`。17 個工具含 `search_products`、`query_sku_details`、`calculate_freight`、`get_logistics_timeliness`、`get_warehouses`、`create_order` 等。對 SaaS 後端來說，**直接打 REST API 比 MCP 更合適**（MCP 只是包裝）。
- **倉庫與時效** 🟡：US 倉 2–7 天（官方部落格稱部分 3 天）、中國→US 7–15（至 22）天、中國→EU 8–16 天；有 DE 等 EU 倉與 AU 倉，UK 倉未確認。只有部分商品有本地庫存，要用 `getInventoryByPid` 逐一確認。
- **成本**：API 免費，無月費（只付商品與運費）🟡。
- **口碑** 🟡：目錄最大、價格最實惠、提供 sourcing；缺點是介面複雜、品質需挑選。很多老手用「CJ 當供應商 + 其他工具自動化」。
- **ToS** ⚪：CJ 主站 Terms of Service 頁面有反爬驗證頁，本次無法讀取；Store Authorization Agreement 只涉及 CJ 存取商家店鋪資料。**需人工閱讀 ToS 中關於 API 資料轉用/展示給第三方的條款**，或寄信 `developer@cjdropshipping.com` 確認。

---

## 三、其他平台細節

### AutoDS 🟡
- 不是供應商，是自動化工具（匯入、改價、自動下單），串接 25+ 供應來源（多數仍是 AliExpress/CJ 等）。$26.90/月起。
- 找不到公開 API 或 MCP ⚪。有 UI 版熱門商品研究，但無法程式化取得。→ 不整合。

### Spocket 🟡
- 主打 US/EU 供應商（約 80%），2–7 天到貨，品類偏服飾、美妝、居家。
- API：第三方教學稱 Empire 方案（約 $57/月）以上有 API，但沒有官方公開文件，`developers.spocket.co` 已無法解析 ⚪。
- 口碑：產品不錯，但**自動升級、取消後扣款、拒絕退款**的抱怨很多（Hack'celeration 3.0/5、Software Advice 2.6/5）。
- → 若老闆想要 EU/US 本地供應商可再洽 Spocket 業務，目前不列為第一批。

### Syncee / Doba / Wholesale2B / Inventory Source / BrandsGateway 🟡
- 皆以「Shopify/WooCommerce app 或 CSV/XML feed」為主，沒有可自助申請的公開 API 文件。
- Inventory Source：需經 Flxpoint 或客服人工開通 feed URL + API token。
- BrandsGateway：僅精品服飾，約 $295/月，不符合「熱門商品」定位。

### HyperSKU 🟡
- 官網兩個 landing page 都寫「open API available」，但無公開文件；Spocket（競品）評測說沒有公開 API。中國工廠直供，5–12 天，無月費。需洽業務才知道。

### EU / UK / AU 在地平台（第二波市場備案）
- **BigBuy**（西班牙）🟡：官方 API 頁說明有商品同步（24 語）、即時庫存、**運費與時效 API**、訂單 API、sandbox。官方頁面本次回 403，需人工確認方案費用。適合 DE/FR/ES/BE 的 EU 本地履約。
- **vidaXL**（荷蘭）🟡：B2B API（email + token，有 sandbox），約 €30/月含 API。品類偏家具居家、大件，與「病毒式熱門小物」重疊不高。
- **Avasam**（英國）🟡：有 Seller/Supplier API（OAuth2 client credentials），文件在 `help.avasam.com/docs`。可作為 UK 本地供應備案。
- **Dropshipzone**（澳洲）🟡：零售商端無 API，只有 Shopify app 與 feed，且需澳洲 ABN/ACN。不適合。

### 不適合的類型
- **Printful / Printify**：API 很完整（Printful v2 約 120 次/分、有 `shipping-rates`；Printify 有 catalog/shipping OpenAPI），但是 POD，與「現在爆紅的現貨商品」不同。
- **Shopify Collective**：只在 Shopify 商家之間運作（2025 年底據稱取消 $50K 營收門檻 🟡），沒有第三方可用的目錄 API。
- **TikTok Shop**：Partner API 是賣家店務 API，不是供應商目錄；TikTok Shop 的熱門資料屬「需求訊號」，應在 `data-sources.md` 的脈絡處理。
- **DSers**：AliExpress 核心，依老闆要求排除。

---

## 四、ToS 與合規風險（給 SaaS 使用）

| 平台 | 風險 | 狀態 |
|---|---|---|
| CJ | 以我們的帳號查詢、在 SaaS 顯示供貨價與運費給其他使用者——未確認是否允許 | ⚪ 需讀 ToS／寄信確認 |
| Zendrop | MCP 為「單一商家帳號」設計；Help Center 說商品圖片供商家在自己店鋪/行銷使用、不保證版權 🟢 | ⚪ Terms of Use 需人工閱讀；理想做法是讓使用者各自 OAuth 連自己的帳號 |
| 全部 | 不得繞過反爬（CJ ToS 頁就有反爬驗證） | 遵守既有合規規則：只用官方 API |

建議設計：
1. **顯示「估算值」而非原始目錄**：SaaS 介面只顯示「預估供貨成本區間、預估運費、預估到貨天數、資料來源 + 時間戳」，並附「到供應商查看」連結，避免被視為轉載目錄。
2. **adapter 介面**：`SupplierQuote { supplier, productRef, unitCostUsd, shippingUsd, deliveryDays: [min,max], originCountry, destCountry, fetchedAt }`，讓 CJ/Zendrop/未來 EU 平台可互換。
3. **快取**：運費依「商品 × 目的國」快取 24–72 小時，控制 CJ 點數消耗（11 個目標國 × 1 次試算 = 110 點/商品）。

---

## 五、推薦排名與要申請的帳號

### 第 1 名：CJ Dropshipping 官方 API v2 —— **立刻整合**
- 理由：唯一一個**公開、自助申請、免費、有完整文件**的供應商 API；一次涵蓋商品搜尋、價格、各倉庫存、**依國家的運費與時效**，而且有**需求訊號**（`productFlag=Trending`、`listedNum`、90 天 `soldOut`／`orderCount`）。
- 用途：毛利子分數的主要來源 + 次要需求訊號（`listedNum` 代表多少店家上架、`soldOut` 代表真實出貨量）。
- 要申請：
  1. CJdropshipping 帳號（免費，cjdropshipping.com）。
  2. 後台 Apps 安裝「API」app → 個人中心 API → Add API（API Key）。把 key 放進 `.env`（`CJ_API_KEY`），不要寫進程式或 commit。
  3. （選用）寄信 `developer@cjdropshipping.com` 確認 SaaS 展示資料的授權與更高額度。

### 第 2 名：Zendrop MCP —— **先手動驗證，再決定整合**
- 理由：老闆指定、US 倉對美國市場有優勢，且 MCP 有 `get_catalog_trending_products` 與依國家運費工具；但缺少伺服器對伺服器的 token 產生說明與 ToS 確認。
- 用途：美國市場的第二報價來源（US 倉 3–5 天）+ Zendrop 熱門清單作為需求訊號。
- 要申請：
  1. Zendrop 帳號（免費開始；建議 Pro 方案以確保完整功能，約 $49–59/月 🟡）。
  2. 用 Claude custom connector 接 `https://app.zendrop.com/mcp/v1` 驗證工具輸出。
  3. 向 Zendrop support 申請：伺服器用 Access Token（scope 只要 `catalog:read`）或 OAuth client，並確認第三方 SaaS 顯示資料的許可。

### 第 3 名（第二波 EU 市場）：BigBuy API
- 理由：EU 本地倉、有官方運費/時效 API 與 sandbox，對 DE/FR/ES/BE 有意義。等第一波市場上線、且確認方案費用後再接。
- 要申請：BigBuy 帳號 + 含 API 的付費方案（費用待確認）。

### 不建議第一批整合
AutoDS、Spocket、Syncee、DSers、Doba、Wholesale2B、BrandsGateway、Inventory Source、HyperSKU、EPROLO、Modalyst、Sell The Trend、Shopify Collective、Printful/Printify、Dropshipzone——原因：無公開 API、只有 feed、需人工開通、品類不符，或以 AliExpress 為核心。

### 待人工確認（建議加入 HUMAN_TODO）
- [ ] 老闆確認 CJ（中國代理商 + 自營海外倉）是否符合「不要 AliExpress」的要求。
- [ ] 閱讀 CJ Terms of Service 與 Zendrop Terms of Use 中關於 API 資料轉用/展示的條款。
- [ ] 向 Zendrop 詢問伺服器用 token / OAuth client 申請方式。
- [ ] 確認 BigBuy API 所需方案與費用。

---

## 來源

### 官方 🟢
- [Zendrop — Introducing Zendrop MCP server](https://www.zendrop.com/mcp-server/)
- [Zendrop Help — Zendrop MCP server（開發者文件）](https://support.zendrop.com/en/articles/14461568-zendrop-mcp-server)
- [Zendrop Help — Connect Zendrop MCP to your AI assistant](https://support.zendrop.com/en/articles/15349416-connect-zendrop-mcp-to-your-ai-assistant)
- [Zendrop Help — Use Claude with Zendrop](https://support.zendrop.com/en/articles/14489015-use-claude-with-zendrop)
- [Zendrop Help — Use ChatGPT with Zendrop](https://support.zendrop.com/en/articles/14486839-use-chatgpt-with-zendrop)
- [Zendrop Help — Shipping times by country](https://support.zendrop.com/en/articles/8487356-zendrop-shipping-times-by-country)
- [Zendrop Help — Where Zendrop ships from and international delivery times](https://support.zendrop.com/en/articles/12118720-where-zendrop-ships-from-and-international-delivery-times)
- [Zendrop Help — Can Zendrop ship globally including Canada](https://support.zendrop.com/en/articles/12063264-can-zendrop-ship-products-globally-including-canada-and-other-countries)
- [Zendrop Help — Can I use Zendrop product images for marketing](https://support.zendrop.com/en/articles/11101560-can-i-use-zendrop-product-images-for-marketing-and-social-media-campaigns)
- [CJ Developers — Authentication](https://developers.cjdropshipping.com/en/api/api2/api/auth.html)
- [CJ Developers — Product](https://developers.cjdropshipping.com/en/api/api2/api/product.html)
- [CJ Developers — Logistics](https://developers.cjdropshipping.com/en/api/api2/api/logistic.html)
- [CJ Developers — MCP Integration Guide](https://developers.cjdropshipping.com/en/api/api2/mcp.html)
- [CJ Developers — Access Frequency Restrictions](https://developers.cjdropshipping.com/en/api/start/limit.html)
- [CJ Developers — API Points Resource Rules](https://developers.cjdropshipping.com/en/api/api2/standard/points.html)
- [CJ Developers — Products Synchronization Processing](https://developers.cjdropshipping.cn/en/api/start/Products-Synchronization-Processing.html)
- [CJ — Store Authorization Agreement](https://cjdropshipping.com/storeAuthorizationAgreement)
- [BigBuy — API](https://bigbuy.eu/en/api_bigbuy.html)
- [Printful API v2 docs](https://developers.printful.com/docs/v2-api)
- [Printify OpenAPI spec](https://developers.printify.com/openapi.json)
- [Dropshipzone — Integrate with APIs（供應商端）](https://web.dropshipzone.com.au/user-guide/integrate-with-apis)
- [HyperSKU — campaign page（宣稱 open API）](https://www.hypersku.com/campaign/optimize-dropshipping/)
- [EPROLO — API 申請說明](https://eprolo.com/pt/eprolo-api)
- [Shopify Collective（App Store）](https://apps.shopify.com/collective)

### 第三方／廠商部落格／聯盟評測 🟡
- [letsdatascience — Zendrop Launches MCP Server](https://letsdatascience.com/news/zendrop-launches-mcp-server-enabling-ai-store-management-fa0a0354)
- [toolsforhumans — Zendrop Review 2026](https://www.toolsforhumans.ai/ai-tools/zendrop)
- [UniLink — Zendrop Guide 2026](https://www.unilink.us/blog/zendrop-guide-2026)
- [CJ 官方部落格 — US Warehouses 3-Day Delivery](https://blog.cjdropshipping.cn/detail/Unlock-3-Day-Delivery-with-CJ-s-New-US-Warehouses)
- [Dropshipping Champions — CJ Dropshipping Review 2026](https://dropshippingchampions.com/blog/cj-dropshipping-review)
- [hustlegotreal — CJ Dropshipping Review](https://hustlegotreal.com/blog/cj-dropshipping-review/)
- [Winning Hunter — Best dropshipping suppliers](https://winninghunter.com/blog/best-dropshipping-suppliers)
- [Branvas — Zendrop alternatives](https://branvas.com/blogs/news/zendrop-alternatives)
- [Branvas — AutoDS alternatives](https://branvas.com/blogs/news/autods-alternatives)
- [Hack'celeration — Spocket Review 2026](https://hackceleration.com/labs/review/spocket)
- [Dupple — Spocket review](https://dupple.com/reviews/spocket)
- [Software Advice — Spocket](https://www.softwareadvice.com/scm/spocket-profile/)
- [RapidDev — Spocket API integration（非官方）](https://www.rapidevelopers.com/md/bolt-ai-integrations/spocket)
- [Spocket blog — HyperSKU review 2026（競品撰寫）](https://www.spocket.co/de/blogs/hypersku-bewertung)
- [Flxpoint — BrandsGateway as a source](https://flxpoint-help-center.onrender.com/kb/general-supplier-integrations/brandsgateway-as-a-source)
- [Flxpoint — Inventory Source](https://help.flxpoint.com/hc/en-us/articles/18587268122125-Inventory-Source)
- [Flxpoint — vidaXL as a source](https://help.flxpoint.com/kb/general-supplier-integrations/vidaxl-as-a-source)
- [Woosa — How does my vidaXL dropshipping account work](https://help.woosa.com/en/articles/75685-how-does-my-vidaxl-dropshipping-account-work)
- [Patchworks — Avasam prebuilt connector](https://doc.wearepatchworks.com/product-documentation/connectors-and-instances/patchworks-connectors/avasam-prebuilt-connector)
- [xpay Agent-Ready Index — Wholesale2B](https://www.xpay.sh/agent-ready-index/wholesale2b/)
- [cropink — Shopify Collective](https://cropink.com/shopify-collective)
- [dodropshipping — Best dropshipping suppliers for TikTok Shop](https://dodropshipping.com/best-dropshipping-suppliers-for-tiktok-shop/)
- [ecommerce-platforms — Modalyst review](https://ecommerce-platforms.com/articles/modalyst-review)
