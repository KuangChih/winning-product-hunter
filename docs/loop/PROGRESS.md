# Progress Log

每輪追加一筆，最新的放最下面。格式：

```
## <YYYY-MM-DD HH:mm> — <任務>
- 完成：
- 驗證：lint ✅/❌ typecheck ✅/❌ test ✅/❌ build ✅/❌
- commit：<hash>
- 下一步：
```

## 2026-10-09 — 輪 1：資料來源研究
- 完成：`docs/research/data-sources.md`、ADR-001（官方 API + 授權第三方資料商；EU 廣告資料當代理指標）；HUMAN_TODO 新增 API 申請清單與 Meta 條款法律確認。
- 驗證：尚無程式碼（Phase 1 才建專案），品質閘門不適用。
- commit：初始 commit（含 loop 狀態檔）
- 下一步：競品研究 `docs/research/competitors.md`

## 2026-10-09 — 輪 2：競品研究
- 完成：`docs/research/competitors.md`。結論：競品評分全是黑盒子、資料新鮮度與準確度常被抱怨、多為單一來源；我們以「透明評分 + 新鮮度標示 + 跨來源佐證 + 早期訊號 + 公開回測」差異化。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：評分方法與產品實體對應研究 `docs/research/scoring.md`

## 2026-10-09 — 輪 3：評分方法研究
- 完成：`docs/research/scoring.md`（Winning Score v0 規格、robust 趨勢偵測、三層實體對應、回測計畫）、ADR-002。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：架構 ADR（資料庫、排程/抓取執行位置、驗證方案）

## 2026-10-09 — 輪 4：架構 ADR
- 完成：ADR-003（Next.js on Vercel + Neon/pgvector + Drizzle；ingestion/評分為 Node CLI jobs 由 GitHub Actions 排程；Better Auth）；CLAUDE.md 技術棧同步更新。Phase 0 完成。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：Phase 1 建立 Next.js 專案骨架

## 2026-10-09 — 輪 5：Next.js 專案骨架
- 完成：Next.js 16.4 + React 19.3 + Tailwind v4 + shadcn/ui；Vitest 5（jsdom + Testing Library）、Playwright（`e2e/`）、Prettier（含 Tailwind 排序）；scripts：lint/typecheck/test/build/e2e/format；首頁換成產品名稱佔位頁 + 單元測試與 e2e 測試。
- 注意：vitest 3 與 @vitejs/plugin-react 6（vite 8/rolldown）型別衝突 → 改用 vitest 5 + @types/node 22。Next 16 有 `AGENTS.md` 要求先讀 `node_modules/next/dist/docs/`，已寫入 CLAUDE.md。
- 驗證：lint ✅ typecheck ✅ test ✅ build ✅；e2e 尚未執行（Playwright 瀏覽器未安裝，CI 項目會處理）
- commit：見 git log
- 下一步：Drizzle + Postgres schema 初版

## 2026-10-09 — 輪 6：資料庫 schema
- 完成：Drizzle schema（products、source_items、append-only signal_snapshots、product_scores 含 breakdown、ingestion_runs）、`drizzle/0000_init.sql`、Neon client（lazy，build 不需 DATABASE_URL）、PGlite 測試 harness、`.env.example`、db:* scripts。
- 決定：pgvector embedding 欄位延到實體對應項目（PGlite 0.5 不含 vector 擴充）；users/watchlists 延到 auth 與收藏功能。
- 驗證：lint ✅ typecheck ✅ test ✅（4 tests）build ✅
- commit：見 git log
- 下一步：README（本地開發步驟）

## 2026-10-09 — 輪 7：README + CI
- 完成：README（本地開發、資料庫、品質閘門）、`.github/workflows/ci.yml`（format/lint/typecheck/test/build，e2e 另一個 job）、format:check 納入 CLAUDE.md 品質閘門。Phase 1 完成。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅ build ✅ e2e ✅（本機 Chromium 首次執行通過）；CI workflow 尚未在 GitHub 上跑過（未 push）
- commit：見 git log
- 下一步：Phase 2 `SourceAdapter` 介面 + fixture 模式

## 2026-10-09 — 輪 8：SourceAdapter 層
- 完成：`src/ingestion/`：`SourceAdapter`/`FetchedItem` 型別（來源 × 供應商兩層）、`fetchWithRetry`（408/429/5xx 指數退避、Retry-After、網路錯誤重試）、`createRateLimiter`、fixture adapter、`runIngestion`（upsert source items、保留 first_seen_at、append snapshots、ingestion_runs 記錄成功/失敗）。`AnyDatabase` 型別讓同一份程式碼跑 Neon 與 PGlite。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（14 tests）build ✅
- commit：見 git log
- 下一步：第一批 fixture 資料集 + ingest CLI job

## 2026-10-09 — 輪 9：Fixture 資料集 + 解析器 + ingest CLI
- 完成：依官方/SerpApi 文件的回應格式寫解析器（`src/ingestion/sources/`：Meta ArchivedAd、SerpApi google_trends TIMESERIES、AliExpress product.query），fixture 與 live 共用同一套解析器；`scripts/generate-fixtures.mjs` 產生 5 個情境各異的樣本產品（上升、高原、下滑、爆發、冷門）；`npm run ingest -- all --fixture [--dry-run]`；`ObservedMetric.observedAt` 讓 trends 歷史序列帶正確日期，未完成的週期會被略過。
- 待確認：AliExpress 回應欄位名（`lastest_volume` 拼字）需以真實回應驗證，解析器兩種拼法都接受。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（25 tests）build ✅；CLI dry-run 正常（44 ads / 5 trends / 5 listings）
- commit：見 git log
- 下一步：live adapters（mock fetch 測試）或先做正規化/實體對應——下一輪依 ROADMAP 順序

## 2026-10-09 — 輪 10：回顧輪
- 回顧結論：
  1. 優先順序調整為「端到端垂直切片」先行（ADR-004，ROADMAP 新增 Phase 2A），因為沒有金鑰時 live adapter 無法驗證，而對應/評分/頁面尚未驗證 schema 設計。
  2. 技術債：Windows CRLF 警告 → 新增 `.gitattributes`（統一 LF）。
  3. 風險：Meta 條款法律確認仍待使用者處理（HUMAN_TODO）；AliExpress 欄位名待真實回應確認。
  4. Fixture 的 trend 查詢詞（如 "corrector brace"）與產品標題不同，實體對應需支援關鍵字 → 產品的部分比對。
- 驗證：僅文件與設定變更；test ✅
- commit：見 git log
- 下一步：Phase 2A 正規化 + 實體對應 v0

## 2026-10-09 — 輪 11：實體對應 v0
- 完成：`src/matching/`：標題正規化（去行銷字、數字、複數）、Jaccard（廣告/商品 ≥ 0.6 合併，否則建新產品）、trend 關鍵字以「所有 token 都包含」連到最具體的產品、無法判斷的項目保留未對應不亂猜；純函式 `planMatches` + DB 套用 `runMatching`（冪等）；`npm run match`。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（35 tests；fixture 端到端：54 筆全對應到 5 個產品，每個產品都有 Meta/AliExpress/Trends 三個來源）build ✅
- 已知限制：純文字比對，對不同語言或改寫幅度大的標題會失敗 → v1 加圖片雜湊與向量。
- commit：見 git log
- 下一步：評分 v0

## 2026-10-09 — 輪 12：評分 v0
- 完成：`src/scoring/`：stats（median、Theil-Sen、百分位排名）、features（longevity 依格式 τ、停投廣告半權重、14 天新廣告+新廣告主、trend 相對斜率、市集訂單、產品年齡取最早廣告）、score（可解釋 breakdown、缺資料不計分、佐證乘數、飽和懲罰、單一來源上限 70、信心度）、run（寫入 product_scores）；`npm run score`。
- Fixture 排名：Paw Cleaner 73.4 > Posture 59.4 > LED Mask 52.8 > Blender 29.5 > Cloud Slides 24.4（符合樣本故事），寫入 scoring.md。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅ build ✅
- 注意：package.json 非 ESM，tsx 腳本不能用 top-level await（jobs 已用 main().catch）。
- commit：見 git log
- 下一步：產品探索頁 v0

## 2026-10-09 — 輪 13：產品探索頁 v0
- 完成：`/products` 排名頁（Suspense + `connection()`，部分預渲染）、`getRankedProducts`（每個產品最新分數、來源清單、全為 fixture 時標示「Sample data」）、ProductTable 元件、首頁按鈕連結；`DATABASE_URL=pglite:./.data/dev` 本機示範資料庫（不需 Neon）；`getDb()` 改為 async + `closeDb()`，jobs 統一用 `runJob` 結束連線。
- 修正：PGlite 需 `serverExternalPackages`（否則 wasm 路徑壞掉）；shadcn init 產生的 `--font-sans: var(--font-sans)` 自我參照導致字型退回 Times；信心度標籤門檻提高（high ≥ 0.8），v0 缺 2 個子分數時顯示 Medium，避免誤導。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（46）build ✅ e2e ✅（2）；瀏覽器實際檢查排名頁顯示正確。
- commit：見 git log
- 下一步：產品詳情頁 v0

## 2026-10-10 — 使用者回報：Vercel 上 `relation "product_scores" does not exist`
- 原因：Neon 資料庫從未執行 migration；頁面沒有處理資料表不存在的情況，直接 crash。
- 修正：新增 `vercel-build`（每次部署先 `tsx src/jobs/migrate.ts --if-configured` 再 `next build`）；`migrateDb()` 支援 Neon（neon-http migrator）與 PGlite；`npm run db:migrate` 改用自己的 job（也支援 `pglite:` URL）；`/products` 遇到資料表不存在會顯示「Database is not set up yet」說明。
- 修正：CLI jobs 與 drizzle.config 改用 `@next/env` 讀取 `.env*`（含 `.env.local`），與 Next.js 一致；移除 dotenv。
- 新增：`npm run seed`（ingest 所有 fixture → match → score）、`docs/DEPLOY.md`。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（48）build ✅；本機 `vercel-build` 成功套用 migration；`db:migrate`、`seed` 都能從 `.env.local` 讀到設定；未設定時 migration 會略過；瀏覽器檢查 `/products` 正常。

## 2026-10-10 — 產品詳情頁 v0
- 完成：`/products/[slug]`（Suspense + `connection()`）：分數、信心度、分數歷史 sparkline、分數拆解表（固定順序，缺資料顯示 No data）、佐證加成 / 飽和懲罰 / 單一來源上限、證據清單（廣告：廣告主、格式、開始日、投放天數、是否仍在投放、連結；搜尋趨勢 sparkline；供應商價格與訂單數）；找不到產品顯示 404 畫面；`getProductDetail` 資料層。
- 修正（瀏覽器實測發現）：重複抓取歷史序列（Google Trends）會重複寫入 snapshot → `signal_snapshots` 改為 (item, metric, observed_at) 唯一索引 + `onConflictDoNothing`；migration `0001` 先刪除既有重複資料再建索引（已在本機示範資料庫的複本上驗證）。
- 注意：串流頁面中的 `notFound()` 回傳 200 + 404 畫面（Next 串流行為），e2e 改檢查畫面。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（53）build ✅ e2e ✅（4）；瀏覽器實測詳情頁。
- 下一步：Phase 2B 資料模型加入國家維度

## 2026-10-10 — 國家維度資料模型
- 完成：`src/lib/markets.ts`（目標市場清單：英語系五國 tier 1、歐洲六國 tier 2；`toCountries` 把 UK/EU/EEA 等代碼正規化成 ISO 國家；市場權重與排序）；`source_items.countries`（text[] + GIN 索引），ingestion 自動由 `countries` 或 `region` 推導；migration `0002` 會依既有 `region` 回填；排名頁新增 Markets 欄（tier 1 市場深色標示）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（57）build ✅ e2e ✅；回填在本機示範資料庫複本上驗證（EU→5 國、US→US）；瀏覽器實測排名頁與詳情頁（趨勢已正確顯示 11 週）。
- 下一步：移除 AliExpress，改用 CJ Dropshipping 樣本資料

## 2026-10-10 — 移除 AliExpress，改用 CJ Dropshipping 樣本資料
- 完成：刪除 AliExpress 解析器與 fixture；新增 `src/ingestion/sources/cj.ts`（依 CJ 官方文件：`product/listV2` 列表、`product/productDetail/query` 的 90 天銷量 `soldOut` / `orderCount`、`logistic/freightCalculate` 運費），價格區間取最低價；fixture 產生器改產生 CJ 回應格式；評分 marketplace 子分數改用 `units_sold_90d`；詳情頁顯示「90 天銷量、上架店家數」；migration `0003` 刪除既有 AliExpress 樣本資料（enum 值因 Postgres 無法刪除而保留並標註 deprecated）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（58）build ✅ e2e ✅；本機示範資料庫重新 seed，瀏覽器實測排名頁與詳情頁。
- 發現：`get_page_text` 讀串流頁面可能只拿到 Suspense fallback，已寫入 CLAUDE.md 已知陷阱。
- 下一步：Shopify Global Catalog adapter（需確認 early access 權限，可能 blocked）→ 否則先做 CJ live adapter 或 Meta 公開網站蒐集器研究

## 2026-10-10 — Shopify Global Catalog adapter（第一個真實資料來源）
- 完成：`src/ingestion/sources/shopify-catalog.ts`（官方 MCP，JSON-RPC `search_catalog`，依 ships_to 國家查詢；每個商品存成 per-country `store_product`，另存同類商品數 `catalog_results`）；`forProducts` 以產品名稱搜尋並直接掛到該產品（略過文字比對，避免產生大量新產品）；`FetchedItem.productId`；`npm run collect -- shopify_catalog [--products] [--countries] [--dry-run]`；詳情頁新增「Stores selling it」（依市場分組、同幣別中位數、評分、店家連結）；有任何 fixture 證據的產品就標示 Sample data。
- 實測：不需金鑰；5 個產品 × 5 國抓到 525 筆真實資料，例如姿勢矯正帶美國中位數 28.95 USD、英國 30.00 GBP。
- 修正：Vitest 沒開 globals，Testing Library 不會自動 cleanup → `vitest.setup.ts` 加上 `afterEach(cleanup)`。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（67）；瀏覽器實測詳情頁。
- 下一步：CJ live adapter 需要 `CJ_API_KEY`（blocked）→ 改做 Meta Ad Library 公開網站蒐集器研究

## 2026-10-10 — 匯率與跨幣別零售價
- 完成：ECB 每日參考匯率（第一手、免費）：`src/lib/fx.ts` 解析與換算、`fx_rates` 表（migration `0004`）、`npm run fx`；`src/lib/retail-price.ts` 的 `marketRetailPrice`（換算成市場當地幣別後取中位數，沒有匯率時只用同幣別報價，不混用）；市場清單加上當地幣別；詳情頁中位數改用換算後的價格並註明匯率日期。
- 修正：測試平行執行時 PGlite 啟動偶爾超過 5 秒 → Vitest testTimeout/hookTimeout 改為 20 秒。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（77）；真實 ECB 匯率存入示範資料庫，瀏覽器實測（例：加拿大中位數 55.74 CAD，6 筆換算）。
- 下一步：CJ 需金鑰（blocked）→ Meta Ad Library 公開網站蒐集器研究

## 2026-10-10 — Meta Ad Library 公開網站蒐集器（美國等非 EU 市場的廣告）
- 研究：公開搜尋頁不需登入；HTML 內嵌 JSON 含完整結果，一般 HTTP GET 即可取得（誠實 User-Agent）。記錄於 `docs/research/meta-ad-library-web.md`。
- 完成：`src/ingestion/sources/meta-ad-library-web.ts`（解析、CAPTCHA/登入頁偵測即停止、5 秒間隔、每次最多 50 頁）；`npm run collect -- meta_ad_library`；詳情頁廣告依來源標示（「Meta Ad Library」+ 國家 + 同創意廣告數），顯示各國刊登中廣告數，最多列出 20 支投放最久的廣告。
- 實測：5 產品 × 5 國 = 25 個請求，443 筆真實資料，未被擋。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（84）；瀏覽器實測詳情頁。
- 下一步：Pinterest Trends（需金鑰，blocked）→ Google Merchant（blocked）→ Keyword Planner（blocked）→ Meta API（blocked）→ TikTok Creative Center 公開頁面研究

## 2026-10-10 — 回顧輪 20
- 現況：真實來源 3 個（Shopify Global Catalog、Meta Ad Library 公開網站、ECB 匯率），其餘 7 項等金鑰。測試 84 個、e2e 4 個全綠。
- 缺口：(1) 沒有產品探索，真實資料只能替樣本產品補證據；(2) 評分未使用真實訊號；(3) 沒有每日排程，無法累積回測所需歷史。
- 決定：ADR-007，新增 Phase 2R（探索 → 真實評分 → 真實/樣本分離 → 每日排程 → 健康度頁）放最前面；TikTok 公開頁與 Shopify 單一店家查詢順延。
- 技術債：`vite-tsconfig-paths` 已可改用 Vite 內建的 `resolve.tsconfigPaths`（測試時有警告），排入之後處理。
- 下一步：產品探索 v1

## 2026-10-10 — 產品探索 v1（第一次自己發現真實產品）
- 完成：`src/discovery/`：`landingKey`（Shopify `/products/<handle>` 為主，跨店同 handle 視為同一商品；只接受明確商品頁格式，排除首頁、分類頁、advertorial、listicle）、`groupAdsByLanding` + `isPromising`（≥2 支廣告、或同創意 ≥2、或投放 ≥14 天）、`runDiscovery`（建立或更新產品、廣告直接掛到產品、被擋時保留已抓資料並記錄失敗）；品類關鍵字清單每天輪替；`products.landing_key` / `canonical_url`（migration `0005`）；`npm run discover`。
- 實測：2 個關鍵字 × 5 國 = 298 支真實廣告 → 23 個真實產品（第一次調整前有 37 個，混入會員方案頁、listicle、模板標題，已修正規則）。排名頁出現沒有樣本標籤的真實產品。
- 修正：Meta 來源標籤改為「Meta Ads」（API 為「Meta Ads (EU API)」、公開網站為「Meta Ad Library」）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（94）；瀏覽器實測排名頁與探索產品詳情頁。
- 下一步：評分 v1 改用真實訊號（目前真實產品只有單一來源，信心度 Low）

## 2026-10-10 — 真實資料 pipeline
- 完成：`src/pipeline/run-pipeline.ts` + `npm run pipeline`：ECB 匯率 → 產品探索（Meta Ad Library）→ Shopify Catalog 蒐集 → 比對 → 評分；某一步失敗其他步驟照跑，最後以非零代碼結束。`pickProducts` 優先挑探索到的真實產品，略過 7 天內已由同一來源蒐集過的產品，讓每天的蒐集分散到不同產品。
- 實測（本機示範資料庫，2 個關鍵字）：fx 30 個匯率；discover 299 支廣告 → 29 個新產品；collect 20 個產品 2,100 筆；score 57 個產品。全部成功。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（97）build ✅ e2e ✅
- 下一步：評分 v1（真實訊號）

## 2026-10-10 — 評分 v1（真實訊號）
- 完成：`SCORING_VERSION = "v1"`：新增 marketReach（五個主要市場的廣告涵蓋，依層級加權）；scaling 加入重複使用的創意；margin 首次計算（Shopify 店家售價中位數換算 USD vs CJ 供貨價，運費前）；飽和度加入 Shopify 販售店家數；scoring 讀取最新 ECB 匯率。詳情頁顯示 Market reach 與販售店家數。
- 結果：本機示範資料庫 57 個產品，真實探索到的產品（Ear Cleaner 69.2、Noxa 頸部按摩器 61.0）與樣本產品並列排名；margin 依據顯示為「median store price 39.00 USD vs supplier 8.42 USD」。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（101）；瀏覽器實測詳情頁。
- 下一步：排名頁預設只顯示真實資料

## 2026-10-10 — 排名頁預設只顯示真實資料
- 完成：`getRankedProducts` 新增 `includeSample`（預設 false），在取前 N 名之前先排除有任何 fixture 證據的產品；排名頁新增「Real data only / Include sample data」切換（`?sample=1`）；沒有真實產品時提示執行 `npm run pipeline`。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（102）；瀏覽器實測：預設只顯示 Ear Cleaner、Noxa 頸部按摩器等真實產品，切換後出現 5 個樣本產品。
- 下一步：每日排程（GitHub Actions）

## 2026-10-10 — 每日排程（GitHub Actions）
- 完成：`.github/workflows/daily-pipeline.yml`：每天 06:00 UTC 跑 `db:migrate` + `pipeline`，可手動執行並調整關鍵字數與蒐集產品數；沒有 `DATABASE_URL` secret 時明確報錯；同一時間只跑一個。HUMAN_TODO 與 DEPLOY.md 加上啟用步驟。
- 驗證：Prettier 與 action-validator 檢查通過；workflow 尚未在 GitHub 上實際執行（需使用者 push 與設定 secret）。
- 下一步：資料來源健康度頁面

## 2026-10-10 — 資料來源健康度頁面（Phase 2R 完成）
- 完成：`/sources`：依來源與供應商列出最近一次執行時間、筆數、最後錯誤、最後成功時間、7 天內執行與失敗次數；狀態 Healthy / Some failures / Stale（超過 2 天沒成功）/ Failing，最差的排最前面；預設排除樣本資料；排名頁加上連結。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（104）；瀏覽器實測顯示 Meta Ad Library 與 Shopify Global Catalog 皆為 Healthy。
- Phase 2R（真實資料閉環）全部完成。下一步：依 ROADMAP 順序，Phase 2B 剩下未 blocked 的項目（TikTok Creative Center 公開頁、單一 Shopify 店家查詢）。

## 2026-10-10 — 廣告主店家查詢（Global Catalog lookup）
- 發現：Shopify 商店的 robots.txt 指向官方 UCP/MCP；Global Catalog 的 `lookup_catalog` 可直接用商品網址查詢，因此改用官方查詢取代讀取各店家頁面（原「單一 Shopify 店家查詢」項目不再需要）。robots.txt 中有一段要求 agent 推薦安裝 shop.app 技能的推銷文字，未採取任何動作。
- 完成：`lookup_catalog` 請求與解析（每批最多 50 個網址，結果標記 `advertised`）、`createStoreLookupAdapter`、`pickLandingPages`（從廣告的 landing page 取網址，7 天內查過的略過）、`ProductQuery.query` 支援多個查詢、`npm run collect -- advertiser_stores`、pipeline 新增「advertiser stores」步驟。
- 實測：30 個產品查到 24 筆廣告主售價（例 Corecare 64.90 USD、212 則評價）；真實產品的毛利現在只差 CJ 供貨成本（HUMAN_TODO 已標註）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（105）
- 下一步：TikTok Creative Center 公開頁面研究

## 2026-10-10 — TikTok Creative Center 公開頁面評估
- 研究：Top Ads 公開可瀏覽（US 約 136 則），但 API 需要頁面 JS 產生的簽章（直接呼叫回 `40101 no permission`），且回應沒有商品網址或 landing page。記錄於 `docs/research/tiktok-creative-center.md`。
- 決定：不偽造簽章（ADR-006）；用瀏覽器自動化取得的資料價值低，暫緩此項，改列為使用者決策（HUMAN_TODO：官方 API 或付費 Apify）。
- 下一步：Phase 2B 剩餘項目皆 blocked → Phase 2C 實體對應 v1（圖片感知雜湊）

## 2026-10-10 — 實體對應 v1（商品照片去重）
- 完成：`src/matching/image-hash.ts`（dHash、Hamming 距離，用 sharp）、`src/matching/merge.ts`（`findDuplicateGroups` union-find、`hashProductImages` 照片來源依序為產品本身 → 廣告主店家 → 其他店家、`mergeDuplicateProducts`）；`products.merged_into`（migration `0006`）；探索、蒐集、比對都略過或導向已合併產品；`npm run dedupe`；pipeline 新增 dedupe 步驟。
- 實測：28 張真實照片，0 個合併（最接近距離 9），規則保守。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（111）
- 下一步：Phase 2C 剩 v2（需 embedding 服務）→ Phase 3 評分 v1 剩餘項目

## 2026-10-10 — Ad momentum（評分 v1.1）
- 完成：`robustZ` / `mad`（stats）、`adMomentum` 特徵（每日觀察到的廣告數，最新一天對前 4–14 天的 robust z-score）、`momentum` 子分數取代一直沒有資料的 `engagementVelocity`；歷史不足時說明還需要幾天。ROADMAP：回測標為等待時間累積；實體對應 v2 降為低優先。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（113）
- 下一步：Phase 4 產品介面（Landing page、篩選）
