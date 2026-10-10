# Roadmap

由 loop 維護。由上往下做；項目太大就拆。標記：`[ ]` 待辦、`[x]` 完成、`[blocked: human]` 需要使用者。

## Phase 0 — 研究與架構
- [x] 研究各資料來源的現況（2026 年）：官方 API 可用性、存取條件、費用、ToS 限制、可用的授權第三方資料商（Apify、SerpApi 等）→ `docs/research/data-sources.md`
- [x] 研究競品（Minea、PiPiADS、Sell The Trend、AutoDS、Kalodata 等）的功能、評分方式、價格與使用者抱怨 → `docs/research/competitors.md`
- [x] 研究 winning product 評分方法與產品實體對應做法 → `docs/research/scoring.md`
- [x] 寫 ADR：整體架構、資料庫、排程/抓取執行位置（考量 Vercel 限制）、驗證方案

## Phase 1 — 專案骨架
- [x] 建立 Next.js + TypeScript + Tailwind + shadcn/ui 專案；設定 ESLint、Prettier、Vitest、Playwright
- [x] `package.json` scripts：`lint`、`typecheck`、`test`、`build`、`e2e`
- [x] Drizzle + Postgres schema 初版（products、source_items、signal_snapshots、product_scores、ingestion_runs）與 migration；PGlite 測試環境
  - users/session 表由 Better Auth 產生（Phase 5 註冊登入項目）；watchlists 隨 Phase 4 收藏功能加入
- [x] `.env.example`、README（本地開發步驟）
- [x] GitHub Actions CI（format/lint/typecheck/test/build + e2e）— 需 push 後才會實際執行

## Phase 2A — 端到端垂直切片（回顧輪 10 決定優先，ADR-004）
用 fixture 資料先打通「蒐集 → 對應 → 評分 → 頁面」，再接 live API。
- [x] 正規化 + 實體對應 v0：標題正規化、token 相似度把 source items 歸到 products；trend 關鍵字以 token 包含關係連到產品（圖片雜湊待有真實圖片時加入）；CLI `npm run match`
- [x] 評分 v0：依 `docs/research/scoring.md` 實作可解釋子分數（longevity、scaling、demandTrend、marketplace、margin），寫入 product_scores；CLI `npm run score`
- [x] 產品探索頁 v0：讀 DB 列出最新分數排名，標示「樣本資料」；無 DATABASE_URL 時顯示設定說明
- [x] 產品詳情頁 v0：分數拆解 + 證據清單（廣告連結、趨勢序列、供應商價格）
- [x] `npm run seed`：一次跑 ingest(fixture) → match → score，方便本機與 preview 環境展示

## Phase 2R — 真實資料閉環（回顧輪 20 決定最優先，ADR-007）
目前真實資料只能「替既有的樣本產品補證據」，系統還不會自己發現新產品，評分也還沒用到真實訊號。先補齊這個閉環。
- [x] 產品探索（discovery）v1：用 Meta Ad Library 公開網站對英語系五國做「廣泛關鍵字掃描」（品類詞清單，例如 pet、posture、kitchen gadget…），依曝光排序取第一頁；廣告依 landing page 網址分組成候選產品（同一網址 = 同一商品），建立 `products`（provider 為真實來源，不是 fixture）— `npm run discover`，只接受明確的商品頁網址（Shopify `/products/<handle>` 等），跨店同 handle 合併
  - [x] 探索到的產品自動接著跑 `collect`（Shopify Catalog 零售價與店家數）：`pickProducts` 優先挑探索到的真實產品，並略過 7 天內已蒐集過的產品
- [x] 評分 v1（真實訊號）：longevity / scaling 改用真實廣告（含 `creative_variants`、各國 `active_ads`，英語系五國加權）、飽和度加入 Shopify 同類商品數與販售店家數；缺資料的子分數照舊不計分
- [x] `npm run pipeline`（fx → discover → collect → match → score）只跑真實來源；某一步失敗其他步驟照跑，最後回報
- [x] 排名頁預設只顯示真實資料（`?sample=1` 可切換顯示樣本資料）
- [x] 每日排程：`.github/workflows/daily-pipeline.yml`（每天 06:00 UTC，可手動執行）；需要使用者 push 並設定 `DATABASE_URL` secret 才會實際執行（已寫進 HUMAN_TODO）
- [x] 資料來源健康度頁面 `/sources`：每個真實來源最近一次執行、筆數、錯誤、7 天內執行與失敗次數；狀態分 Healthy / Some failures / Stale / Failing

## Phase 2B — 第一手真實資料（ADR-005，產品詳情頁之後最優先）
目標：盡早開始每天累積英語系五國（US、CA、UK、AU、NZ）的真實資料，回測需要至少 4–8 週歷史。
每個 live adapter 都先以 mock fetch 寫測試；沒有金鑰時在 HUMAN_TODO 標示並跳過，改做下一個。
- [x] 資料模型：訊號與 source item 帶「國家」維度（ISO 3166-1），支援目標市場清單設定（英語系五國優先、歐洲第二波）
- [x] 移除 AliExpress：fixture、解析器與來源 enum 改為 CJ Dropshipping 樣本（依 `docs/research/suppliers.md` 的真實回應格式）
- [x] Shopify Global Catalog adapter（MCP，agent profile 認證，不需金鑰）：依 ships_to 國家查詢 → 零售價、店家、評分、同類商品數；`npm run collect -- shopify_catalog`；詳情頁「Stores selling it」
  - [ ] [blocked: 部署] 部署後改用自己的 agent profile（`SHOPIFY_UCP_AGENT_PROFILE`，目前用 Shopify 官方範例 profile）
  - [x] 零售價跨幣別：ECB 每日匯率（`npm run fx`、`fx_rates` 表）+ `marketRetailPrice`（換算成各市場當地幣別後取中位數）
- [ ] [blocked: human — 需要 `CJ_API_KEY`] CJ Dropshipping API v2 adapter：Trending 商品、90 天銷量（soldOut / orderCount）、各國運費與運送時間、各倉庫存 → 供應成本與需求訊號
- [x] Meta Ad Library 公開網站蒐集器（ADR-006）：一般 HTTP GET 解析內嵌 JSON（不需瀏覽器），每頁曝光最高的廣告、開始日、是否刊登中、同創意廣告數、landing page、各國刊登中廣告數；5 秒間隔、每次最多 50 頁、被擋即停止；`npm run collect -- meta_ad_library`（見 `docs/research/meta-ad-library-web.md`）
  - [x] 用廣告的 landing page 找出廣告主店家：Shopify Global Catalog `lookup_catalog` 直接接受商品網址（官方、不需爬店家頁面），取得廣告主自己的售價、評分與評論數；`npm run collect -- advertiser_stores`，並加入 pipeline
- [ ] [blocked: human — 需要 `META_ACCESS_TOKEN`] Meta Ad Library API adapter（UK + EU，官方 API）：廣告持續天數、創意變體、廣告主、landing page 網域
- [ ] [blocked: human — 需要 Pinterest 開發者 app] Pinterest Trends API adapter（US、CA、GB、AU+NZ）：搜尋趨勢與成長
- [ ] [blocked: human — 需要 Merchant Center] Google Merchant API Best sellers adapter：每週/每月熱銷排名、relative_demand 與變化（11 國）；需 Merchant Center 達到資格門檻
- [ ] [blocked: human — 需要 developer token] Google Ads API Keyword Planner adapter：關鍵字月搜尋量與趨勢（需 developer token Basic access）
- [ ] [blocked: 決策] TikTok Creative Center 公開頁面蒐集器：API 需頁面簽章（不偽造），公開資料又缺少商品識別，暫緩；見 `docs/research/tiktok-creative-center.md` 與 HUMAN_TODO 的選項
- [ ] [blocked: human — 需要 TikTok API 核准] TikTok Commercial Content API adapter（UK + EU）：廣告與觸及
- [x] ~~單一 Shopify 店家查詢（合規版）~~：改用官方 Global Catalog lookup（上一項），不再讀取各店家的 `.js`/`.json`。店家所在國家（`/meta.json`）之後有需要再評估。原規劃：robots.txt → `/meta.json`（國家、可出貨國家）→ 商品 `.js`；每店每天最多一次、遇 403/429/430 退避、不用 proxy；不追蹤庫存、訂單編號、best-selling 排序與 cart

## Phase 2C — 資料品質
- [x] 實體對應 v1：商品照片 dHash（`sharp`）+ 標題重疊判斷重複產品；合併時搬移證據、刪除重複產品的分數並標記 `merged_into`（之後探索到同代號會導向存活產品）；`npm run dedupe`，並加入 pipeline
- [ ] [低優先，移到 Phase 4 之後] 實體對應 v2：向量相似度（CLIP 類 embedding，可用 transformers.js 在 GitHub Actions 本地計算，不需付費服務）+ 人工標註配對集校正門檻；v1 實測目前沒有重複，價值待資料量增加後再評估
- [ ] 評分 v2：margin 扣除 CJ 運費（到岸毛利）、demandTrend 改用 Pinterest / Google Best sellers（皆需金鑰）

## Phase 2（已完成部分，保留紀錄）
- [x] 統一的 `SourceAdapter` 介面 + fixture 模式 + 重試/限流/錯誤紀錄（`src/ingestion`）
- [x] 第一批 fixture 資料集（Meta EU 廣告、Google Trends、AliExpress）+ 解析器 + CLI job `npm run ingest -- <source|all> --fixture`（AliExpress 將於 Phase 2B 移除）

## Phase 3 — 評分引擎
- [x] Ad momentum（v1.1）：每日觀察到的廣告數，以 median/MAD robust z-score 比較最新一天與過去 4–14 天；歷史不足時不計分（取代原本沒有資料的 engagementVelocity；TikTok 互動數據接上後另加一項）
- [ ] [blocked: 時間 — 需每日 pipeline 累積 4–8 週真實歷史] 回測：用歷史資料驗證分數是否能提前抓到後來真的爆的產品，結果寫進 `docs/research/scoring.md`

## Phase 4A — 回顧輪 30 新增的優先項目（ADR-008）
- [x] **站台存取保護**：部署到 Vercel 後網站是公開的，但 ADR-006 的公開網頁資料只限使用者個人研究使用。加上簡單的密碼保護（`SITE_PASSWORD` 環境變數 + proxy/middleware + 登入頁 + HttpOnly cookie），沒有設定密碼時維持開放（本機開發）
- [x] 全站導覽列（首頁 / 排名 / 資料來源，標示目前區塊）與頁尾，取代各頁自己的返回連結
- [x] 產品詳情頁補強：毛利估算區塊（售價、供貨價、運費前毛利，資料不足時說明缺什麼）、頁面標題（metadata）、已合併產品導向存活產品

## Phase 4B — 部署前安全強化（回顧輪 40 新增，ADR-010）
使用者隨時可能部署；網站只靠一組共用密碼保護，部署前先補齊。
- [x] 登入防暴力破解：資料庫記錄登入失敗（IP 雜湊 + 時間），同一 IP 15 分鐘內失敗 10 次就暫時拒絕；DEPLOY.md 建議密碼至少 16 個隨機字元
- [x] 安全標頭：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Robots-Tag: noindex`（私人網站不被搜尋引擎收錄）＋ `robots.txt` 全部 disallow（另加 `Content-Security-Policy: frame-ancestors`、`Permissions-Policy`、HSTS、移除 `X-Powered-By`；完整 CSP 需 nonce 會讓所有頁面變動態，暫不做）
- [x] 技術債清理：移除 `vite-tsconfig-paths`（改用 Vite 內建 `resolve.tsconfigPaths`）；`shadcn` CLI 移到 devDependencies（只在 build 時 import CSS），production `npm audit` 從 7 個 high 降為 0

## Phase 4 — 產品介面
- [x] Landing page：價值主張、即時前三名真實產品（資料庫失敗時不影響頁面）、差異化重點、運作方式、資料來源
- [x] 產品探索頁：標題搜尋、市場、最低分數、排序（最高分 / 最新 / 最不擁擠），GET 表單可分享網址
  - [ ] 之後補：類別篩選（需要類別資料）、價格區間、平台篩選
- [x] 產品詳情頁：分數拆解、分數歷史、廣告證據連結、搜尋趨勢、供應商、競爭店家（各市場零售價）——毛利區塊等補強移到 Phase 4A
- [x] 廣告資料庫瀏覽頁（跨平台）：`/ads`，搜尋廣告文字 / 廣告主、市場、平台、狀態、排序（投放最久 / 最新 / 最近看到）、分頁，連到原始廣告與對應產品
  - [ ] 之後補：廣告素材縮圖（需確認 Meta 圖片網址的有效期限與熱連結限制）
- [x] 收藏 / watchlist：詳情頁 Watch 按鈕（Server Action）、`/watchlist` 頁（目前分數、與上次更新及加入時的差距）、變動 5 分以上標示為提醒；dedupe 合併時收藏移到存活產品（ADR-009）
  - [ ] [blocked: human — 需 RESEND_API_KEY，選填] 分數變動 Email 通知（每日 pipeline 結束後寄出）
- [x] RWD、深色模式、無障礙、i18n（繁中 / 英文）——拆成：
  - [x] 手機版版面（375px）：導覽列不擠壓、寬表格改在容器內橫向捲動而不是把欄位擠成很高的列、廣告卡片在手機上改直排；e2e 檢查各頁在手機寬度不會橫向捲動
  - [x] 深色模式：預設跟隨系統設定，導覽列切換按鈕（系統 → 淺色 → 深色），選擇存在 localStorage；`<head>` 內嵌小 script 在畫面繪製前套用，避免閃白
  - [x] 無障礙檢查：axe-core 自動掃描（WCAG 2.1 A/AA，6 頁 + 產品頁 × 淺色 / 深色）0 違規；加強鍵盤焦點框（2px、前景色）、「Skip to content」連結、修正導覽列在桌面出現多餘捲軸
  - [x] i18n（繁中 / 英文，ADR-011）——拆成：
    - [x] 路由基礎：頁面移到 `src/app/[lang]`（en、zh-TW 各自預渲染）、proxy 依 cookie 改寫網址（網址不變，也支援 `/zh-TW/...`）、`next/root-params` 取語言、字典型別檢查、語言切換按鈕；導覽列、頁尾、Skip link 已翻譯
    - [x] 翻譯首頁（Landing）
    - [x] 翻譯排名頁（篩選表單、表格、空狀態、metadata 標題；國家名用 `Intl.DisplayNames`）
    - [x] 翻譯產品詳情頁主體：標題列、分數拆解、毛利估算、收藏按鈕、metadata 標題（`estimateMargin` 改回傳缺少的項目代碼，由介面依語言措辭）
    - [x] 翻譯證據清單（廣告、搜尋需求、販售店家、供應商）與來源名稱（「Shopify 店家」等描述性名稱翻譯，品牌名保留）
    - [x] 分數說明結構化：評分時存「說明代碼 + 參數」而非英文句子，讓中文也能顯示即時數字（例如「需要 5 天以上，目前 1 天」）；目前中文顯示固定的計算方式說明
    - [x] 翻譯廣告頁（篩選、廣告卡片、分頁、空狀態）與收藏頁（表格、分數變動提醒、空狀態）及其 metadata 標題
    - [x] 翻譯資料來源頁、登入頁、主題切換按鈕與全站 metadata 描述（所有頁面的介面文字都已有中英文）
    - [x] ~~數字與日期依語言格式化~~：評估後不需要——日期用 ISO 格式（2026-10-10）、數字用千分位（1,300）、金額標示幣別，在台灣與英語系都是通用寫法

## Phase 5 — 帳號與商業化
- [ ] 註冊登入（多使用者；個人使用階段先用 Phase 4A 的密碼保護）
- [ ] 方案與額度限制；Stripe 訂閱（test mode）
- [ ] 管理後台：來源健康度、ingestion 狀態、手動重跑

## Phase 6 — 上線準備
- [ ] 效能（快取、ISR、DB index）、錯誤監控、log——排名頁目前載入全部產品後在記憶體篩選，真實產品超過約 2,000 筆（每日排程跑約 2 個月後）前改成資料庫端篩選與分頁
- [ ] 安全檢查（`/security-review`）、rate limiting
- [ ] 隱私權政策 / 服務條款頁草稿（標示需法律審閱）
- [x] Vercel 部署設定與部署文件 `docs/DEPLOY.md`（`vercel-build` 自動 migration；實際部署由使用者執行）
- [ ] 完整 E2E 測試通過
