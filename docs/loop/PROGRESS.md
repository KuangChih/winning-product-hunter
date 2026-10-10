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

## 2026-10-10 — Landing page
- 完成：首頁改為完整 landing page（`src/components/landing.tsx`）：定位、兩個 CTA（排名頁、資料來源頁）、即時前三名真實產品（串流載入，資料庫異常時顯示說明而不讓首頁失敗）、四個差異化重點、運作方式四步驟、資料來源清單。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（113）；瀏覽器實測桌面與手機寬度（375px 無水平捲動）。
- 下一步：產品探索頁篩選與搜尋

## 2026-10-10 — 排名頁篩選與搜尋
- 完成：`applyRankingFilters`（標題逐字搜尋、市場、最低分數、排序：最高分 / 最新 / 最不擁擠）、`parseRankingParams`（不合法參數回到預設值）、`RankingControls`（GET 表單，不需 JS、每個篩選結果都有可分享的網址，切換樣本資料時保留篩選條件）、篩選無結果時的提示。
- 修正：CLAUDE.md 已知陷阱新增「含反斜線的程式碼不要用 heredoc 寫檔」。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（118）；瀏覽器實測搜尋 neck → 10 個產品、紐西蘭 + 最不擁擠 → 34 個產品。
- 下一步：產品詳情頁補強（ROADMAP Phase 4 下一項）

## 2026-10-10 — 回顧輪 30
- 現況：37 個 commit、118 個單元測試、4 個 e2e 全綠；真實來源：Meta Ad Library（公開網站）、Shopify Global Catalog（搜尋 + 廣告主店家查詢）、ECB 匯率；頁面：首頁、排名（篩選/搜尋）、詳情、資料來源健康度。
- 最大瓶頸在使用者端：每日排程未啟用（push + `DATABASE_URL` secret）→ 動能、回測無法開始；`CJ_API_KEY` → 毛利。
- 決定：ADR-008，部署前先加站台密碼保護（公開網頁資料限個人研究使用）；新增 Phase 4A（密碼保護 → 全站導覽 → 詳情頁補強）。
- 技術債記錄：排名查詢全量載入、vite-tsconfig-paths 警告、e2e 覆蓋不足（排入 Phase 6）。

## 2026-10-10 — 站台密碼保護（ADR-008）
- 完成：`src/proxy.ts`（Next 16 proxy：設定 `SITE_PASSWORD` 時所有頁面需登入，未設定時開放）、`/login` 頁與 server action（雜湊比對、HttpOnly + SameSite=Lax cookie 30 天、改密碼即全部登出、登入後只導回站內相對路徑）、`.env.example` / DEPLOY.md / HUMAN_TODO 加入 `SITE_PASSWORD`；`.claude/launch.json` 新增 `dev-protected`（3001 port，本機測試密碼）。
- 修正：`npm run typecheck` 改為 `next typegen && tsc --noEmit`，CI 全新環境沒有路由型別時也能通過。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（124）build ✅；瀏覽器實測：未登入導向登入頁並保留原網址、錯誤密碼顯示提示、正確密碼回到原頁面。
- 下一步：全站導覽列

## 2026-10-10 — 全站導覽列與頁尾
- 完成：`SiteHeader`（logo + 導覽）、`SiteNav`（客戶端，用 `usePathname` 標示目前區塊，包在 Suspense 中；fallback 為沒有標示的連結，維持預渲染）、`SiteFooter`（說明訊號是公開資料的估計值）；登入頁不顯示導覽；移除排名頁與資料來源頁各自的連結。本機示範資料庫以 v1.1 重新評分。
- 修正：初版在 layout 直接使用 `usePathname` 觸發「blocking-prerender-client-hook」錯誤 → 改為 Suspense 包住，已寫入 CLAUDE.md 已知陷阱。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（128）；瀏覽器實測詳情頁導覽標示正確、無錯誤、Ad momentum 顯示「需要 5+ 天資料（目前 1 天）」。
- 下一步：產品詳情頁補強（毛利區塊、頁面標題、已合併產品導向）

## 2026-10-10 — 產品詳情頁補強
- 完成：`estimateMargin`（`src/lib/margin.ts`，與評分的 margin 訊號同一套輸入：美國市場店家售價中位數 vs 最便宜的供應商報價，換匯用 ECB，沒有匯率時不混幣別）與「Margin estimate」區塊（售價、供貨價、運費前毛利；資料不足時明確說明缺什麼）；`generateMetadata` 以產品名稱當頁面標題；已被 dedupe 合併的產品網址自動 `redirect` 到存活產品（最多追 5 層）。
- 修正：`generateMetadata` 沒先 `await connection()` 會觸發「blocking-prerender-current-time」，已補上並寫入 CLAUDE.md 已知陷阱。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（135）build ✅ e2e ✅（4，含標題與毛利區塊）；瀏覽器實測 Ear Cleaner：標題「Ear Cleaner · Winning Product Hunter」、美國售價中位數 $30.72（67 個店家報價）、提示需要 CJ 供貨價。
- 下一步：Phase 4 廣告資料庫瀏覽頁

## 2026-10-10 — 廣告資料庫瀏覽頁
- 完成：`/ads` 頁面與 `getAds`（`src/data/ads.ts`）：在資料庫端完成篩選、排序與分頁（每頁 50 筆）；搜尋廣告文字或廣告主（每個字都要符合，`%`、`_` 當一般字元）、市場（GIN index 的 countries）、平台、投放中 / 已停止、排序（投放最久 / 最新 / 最近看到）；預設只顯示真實資料，可切換含樣本資料；每則廣告連到原始廣告與對應的產品頁。導覽列新增「Ads」。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（141）build ✅ e2e ✅（5）；瀏覽器實測示範資料庫 351 則真實廣告、US + 最新排序第 2 頁顯示「68 ads · showing 51–68 / Page 2 of 2」。
- 下一步：收藏 / watchlist / 分數變動通知

## 2026-10-10 — Watchlist（ADR-009）
- 完成：`watchlist` 資料表（migration 0007）與 `src/data/watchlist.ts`（加入時記下分數、列表含最新與前一次分數、`scoreAlerts` 變動 ≥5 分）；詳情頁 Watch / Watching 按鈕（Server Action + `refresh()`，不需 JS 也能用）；`/watchlist` 頁（目前分數、與上次更新及加入時的差距、分數變動提醒區塊）；導覽列新增 Watchlist；dedupe 合併時收藏移到存活產品。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（144）build ✅ e2e ✅（6，含加入 / 移除收藏流程）；瀏覽器實測 Ear Cleaner 加入後在 Watchlist 顯示分數 67，移除後顯示空狀態。示範資料庫已套用 migration。
- 待使用者：Email 通知需要 `RESEND_API_KEY`（選填，已寫入 HUMAN_TODO）。
- 下一步：RWD、深色模式、無障礙、i18n

## 2026-10-10 — 手機版版面（RWD）
- 完成：375px 實測各頁並修正：導覽列在手機上換到第二行並縮小間距（4 個連結全部可見）；排名、分數拆解、資料來源、收藏的表格設定最小寬度，改在容器內橫向捲動（原本欄位被擠成一字一行、每列高約 90px）；廣告卡片在手機上改直排。桌面版不變。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（144）build ✅ e2e ✅（11，新增 5 頁手機寬度檢查：頁面不可橫向捲動、導覽連結都在畫面內）；瀏覽器實測手機與桌面寬度。
- 下一步：深色模式

## 2026-10-10 — 深色模式
- 完成：`src/lib/theme.ts`（偏好解析、循環切換、`<head>` 初始化 script）與 `ThemeToggle`（`useSyncExternalStore` 讀 localStorage，伺服器端一律渲染「system」避免 hydration 不一致；系統設定改變時即時跟著變）；`color-scheme` 讓原生表單與捲軸也變深色。沒有新增套件。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（149）build ✅ e2e ✅（13，新增：跟隨系統深色、選擇淺色後重新整理仍維持）；瀏覽器實測深色模式下排名、詳情、資料來源頁，console 無 hydration 錯誤。
- 下一步：回顧輪 40

## 2026-10-10 — 回顧輪 40（ADR-010）
- 檢視：Phase 4A 與 Phase 4 介面大致完成；價值瓶頸仍是使用者端（每日排程未啟用、CJ 金鑰、TikTok 決策）。發現部署前的安全缺口：登入沒有次數限制、沒有安全標頭與 noindex。評分在有每日歷史前不調整。
- 完成：新增 Phase 4B「部署前安全強化」排在無障礙與 i18n 之前；排名頁資料庫端分頁設 2,000 筆門檻；移除 `vite-tsconfig-paths`（改用 Vite 內建）；`shadcn` 移到 devDependencies，production `npm audit` 從 7 high → 0。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（149）build ✅
- 下一步：登入防暴力破解

## 2026-10-10 — 登入防暴力破解（Phase 4B）
- 完成：`login_failures` 資料表（migration 0008，只存加鹽的 IP 雜湊，超過 1 天自動刪除）與 `src/data/login-throttle.ts`：同一來源 15 分鐘內失敗 10 次、或全站 15 分鐘內累計失敗 100 次（防止換 IP 無限猜）就暫時拒絕，被擋時不比對密碼也不再記錄；登入成功清除該來源紀錄。來源取 Vercel 設定的 `x-forwarded-for` 第一個位址。沒有資料庫（本機開發）或資料表尚未建立時不限制，避免把自己鎖在外面。登入頁顯示「Too many failed attempts」。DEPLOY.md 加入密碼強度建議。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（155）build ✅ e2e ✅（13）；瀏覽器實測（dev-protected）：連錯 10 次後第 11 次顯示鎖定訊息；資料庫只有 64 字元雜湊、沒有 IP；測試資料已清除，示範資料庫已套用 migration。
- 下一步：安全標頭與 noindex

## 2026-10-10 — 安全標頭與 noindex（Phase 4B 完成）
- 完成：`src/lib/security-headers.ts` 經 `next.config.ts` 的 `headers()` 套用到所有路徑：`X-Frame-Options: DENY`、`frame-ancestors 'none'`、`nosniff`、`Referrer-Policy: no-referrer`（不讓 Meta 或其他店家知道訪客從這裡來）、`Permissions-Policy`、HSTS、`X-Robots-Tag: noindex, nofollow`；移除 `X-Powered-By`；全站 robots meta noindex；`src/app/robots.txt` 全部 disallow，並從 proxy matcher 排除，讓爬蟲不登入也讀得到。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（157，含 proxy matcher 與標頭設定）build ✅ e2e ✅（16，含實際回應標頭、robots.txt、meta）；密碼保護伺服器實測：robots.txt 200、未登入導向 /login 的 307 回應也帶安全標頭。
- 下一步：無障礙檢查

## 2026-10-10 — 無障礙檢查
- 完成：加入 `@axe-core/playwright`（dev，免費），e2e 掃描首頁、排名、廣告、收藏、資料來源、登入、產品詳情 × 淺色 / 深色，WCAG 2.1 A/AA 規則 0 違規。axe 抓不到的部分手動用鍵盤實測後修正：焦點框原本是 1px 半透明灰色幾乎看不到 → 改成 2px 前景色；新增「Skip to content」連結（所有頁面 `<main id="main">`）；導覽列連結原本是 inline，padding 超出高度讓桌面版出現垂直捲軸 → 改成 block 並在捲動容器內留空間給焦點框。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（157）build ✅ e2e ✅（31，新增 14 個 axe 掃描與 1 個鍵盤跳過導覽測試）；瀏覽器鍵盤實測。
- 下一步：i18n（繁中 / 英文）

## 2026-10-10 — i18n 路由基礎（ADR-011）
- 完成：頁面移到 `src/app/[lang]`（`generateStaticParams` 產生 en / zh-TW，各自預渲染）；proxy 先做密碼檢查、再依 `locale` cookie 把沒有前綴的網址改寫到對應語言（網址不變，`/zh-TW/...` 也可直接開）；`src/i18n`（語言清單、路徑工具、字典、`getLocale` 用 `next/root-params`）；語言切換按鈕；導覽列、頁尾、Skip link、`<html lang>` 已翻譯。其他頁面的翻譯拆成後續子項目。
- 修正：Skip link e2e 在串流內容尚未出現時按 Tab 會失敗 → 先等搜尋框出現。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（165，含字典 key 完整性與 proxy 改寫）build ✅（每頁 en / zh-TW 兩個預渲染外殼）e2e ✅（33，新增語言切換與 `/zh-TW` 前綴網址）；瀏覽器檢查 `/zh-TW/products` 導覽為中文、`lang="zh-TW"`、伺服器無錯誤。
- 下一步：翻譯首頁

## 2026-10-10 — 翻譯首頁
- 完成：首頁所有文字（主標語、按鈕、四個特色、運作步驟、資料來源、前三名區塊的空狀態與載入中）移到字典，`Landing` 由伺服器端傳入字串；繁中版本使用台灣用語，產品名與來源專有名詞保留英文。
- 修正：單元測試在 20 核心機器上預設一個檔案一個 worker，數十個 PGlite 同時啟動互相拖慢，4–7 個測試剛好 20 秒逾時 → `maxWorkers: "50%"`，全部通過且從約 50 秒降到約 24 秒；寫入 CLAUDE.md 已知陷阱。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（166）build ✅ e2e ✅（34，新增中文首頁）；瀏覽器檢查 `/zh-TW` 全文為中文、前三名真實產品正常、伺服器無錯誤（截圖逾時，改用頁面文字確認）。
- 下一步：翻譯排名頁與產品詳情頁

## 2026-10-10 — 翻譯排名頁
- 完成：字典新增 `common`（載入中、樣本資料標籤、可信度、資料庫未設定 / 未建立提示）與 `ranking`；`src/i18n/format.tsx`：`countryName`（`Intl.DisplayNames`，GB → 英國）、`fill`（`{n}` 佔位）、`RichText`（字典裡用反引號標示的程式名稱顯示為 `<code>`）。排名頁標題、說明、篩選表單、排序選項、表格欄位、可信度、樣本資料標籤、各種空狀態與 metadata 標題都依語言顯示；首頁前三名的國家名稱也跟著語言。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（168，新增中文表格與篩選表單）build ✅ e2e ✅（35，新增中文排名頁）；瀏覽器檢查 `/zh-TW/products?market=GB`：34 個產品、欄位與可信度為中文、市場選單顯示「英國」，伺服器無錯誤。
- 下一步：翻譯產品詳情頁

## 2026-10-10 — 翻譯產品詳情頁主體
- 完成：字典新增 `detail`、`breakdown`、`margin`；詳情頁標題列（Winning Score、可信度、更新日期、分數歷史）、分數拆解（訊號名稱、欄位、沒有資料、跨來源加成、飽和度、單一來源上限）、毛利估算、收藏按鈕、返回連結與 metadata 標題都依語言顯示。`estimateMargin` 改回傳缺少項目的代碼（retail / supplier），由介面組成句子。分數說明：英文顯示評分時存下的說明（含即時數字），中文顯示固定的計算方式說明，結構化改進列入 ROADMAP。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（171，新增分數拆解中英文、毛利中文）build ✅ e2e ✅（36，新增中文詳情頁）；瀏覽器檢查 `/zh-TW/products/ear-cleaner` 各區塊為中文、毛利提示「需要供應商報價」，伺服器無錯誤。
- 下一步：翻譯證據清單與來源名稱

## 2026-10-10 — 翻譯證據清單與來源名稱
- 完成：字典新增 `evidence`；證據清單的廣告列（來源、國家、影片 / 圖片 / 輪播、同素材廣告數、開始日、天數、投放中 / 已停止）、搜尋需求、販售店家（國家名、售價中位數、ECB 換算說明、Shopify 目錄相符數）、供應商報價都依語言顯示。`sourceLabel` 加上語言參數，只翻譯描述性名稱（「Shopify 店家」「TikTok Ads（歐盟）」），品牌名保留；排名頁的證據來源欄也跟著翻譯。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（172，新增中文證據清單）build ✅ e2e ✅（37，新增中文證據區塊）；瀏覽器檢查 Ear Cleaner 中文頁：「廣告（5）」「販售的店家（67）」、加拿大「4 筆依 2026-10-09 的 ECB 匯率換算」，伺服器無錯誤。
- 下一步：翻譯廣告、收藏、資料來源、登入頁
- 補充：實測時 dev server log 出現一次 `SyntaxError: Unexpected end of JSON input`（page `/en`，回 500）。重現確認只在 dev server 冷啟動時、第一批同時進來的請求才會發生，之後的請求都是 200；production（`next start`）同時打 6 個冷請求都 200、無錯誤 → 判定為 dev 首次編譯的競態，記入 CLAUDE.md 已知陷阱。

## 2026-10-10 — 翻譯廣告頁與收藏頁
- 完成：字典新增 `ads`、`watchlist`；廣告頁的篩選表單、廣告卡片（沿用 `evidence` 的格式 / 天數 / 狀態字串，兩處用詞一致）、總數、分頁、樣本標籤、各種空狀態與 metadata 標題；收藏頁的欄位、尚未評分、分數變動提醒（`AlertText` 把有顏色的變動數字放進翻譯句子中）、空狀態、收藏按鈕與 metadata 標題。廣告瀏覽元件首次加上單元測試。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（175）build ✅ e2e ✅（38，新增中文廣告與收藏頁）；瀏覽器檢查 `/zh-TW/ads?market=US`：「68 則廣告 · 顯示第 1–50 則」「第 1 頁，共 2 頁」，伺服器無錯誤。
- 下一步：翻譯資料來源頁、登入頁、主題切換按鈕

## 2026-10-10 — 翻譯資料來源頁、登入頁、主題按鈕（介面中文化完成）
- 完成：字典新增 `sources`、`login`、`theme`、`site.description`；資料來源頁（欄位、狀態、來源與提供者名稱、失敗次數、空狀態、metadata）、登入頁（說明、密碼欄、錯誤與鎖定訊息、按鈕、metadata）、主題切換按鈕的無障礙標籤、全站 metadata 描述都依語言顯示。順便修正：廣告主商店的提供者原本直接顯示代碼 `shopify_catalog_lookup`，現在有中英文名稱。全專案 grep 已無寫死的英文介面文字。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（176）build ✅ e2e ✅（39，新增中文資料來源與登入頁）；瀏覽器檢查 `/zh-TW/sources`：欄位、狀態「正常」、「Shopify 店家 / Global Catalog（廣告主商店）」、主題按鈕標籤皆為中文，伺服器無錯誤。
- 剩下的 i18n 子項目：數字與日期依語言格式化、分數說明結構化。

## 2026-10-10 — 分數說明結構化（i18n 完成）
- 完成：每個子分數除了英文 `basis` 之外，另存 `explain: { key, params }`（例如 `momentumNeedsHistory { need: 5, have: 1 }`、`margin { retail, supplier }`）；字典新增 `breakdown.explain` 中英文樣板，介面依語言填入該分數自己的數字。舊分數沒有 `explain` 時沿用原本的行為。分數數值不變，不需升版本；示範資料庫已重新評分。數字與日期格式化評估後不需要（ISO 日期、千分位、標示幣別兩地通用），項目關閉。i18n 全部完成。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（178，新增「英文樣板填入參數必須和 basis 完全相同」的一致性測試與中文即時數字測試）build ✅ e2e ✅（39）；瀏覽器檢查 Ear Cleaner 中文頁：廣告動能顯示「需要至少 5 天的每日廣告紀錄（目前 1 天）」，伺服器無錯誤。
- 下一步：Phase 4 的 RWD/深色/無障礙/i18n 已全部完成；接著看 ROADMAP 下一個未封鎖項目

## 2026-10-10 — 排名頁價格區間與證據來源篩選
- 完成：`getRankedProducts` 為每個產品算出美國售價中位數（店家報價，跨幣別以 ECB 換算，與毛利估算同一套邏輯）；`applyRankingFilters` 新增價格區間（設定區間時，沒有美國售價的產品不顯示，並在空狀態說明）與證據來源篩選；網址參數 `minPrice`、`maxPrice`、`source`；表單新增最低 / 最高售價與證據來源（中英文）；表格新增「售價（美國）」欄。ROADMAP：實體對應 v2 標為等待資料量、評分 v2 標為等待金鑰。
- 注意：本輪中途使用者要求停止 loop，loop 已停止；本項目依使用者指示做完並 commit。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（182，新增價格 / 來源篩選、參數解析、售價中位數查詢、表格與表單）build ✅ e2e ✅（40，新增網址帶入篩選並檢查每列售價在範圍內；一次 dev 偶發語言錯誤，重跑兩次全過，`next start` 24 個中英混合並行請求全部正確，記入已知陷阱）；瀏覽器實測：Ear Cleaner $30.72、篩 20–40 美元剩 7 個產品且全在範圍內，伺服器無錯誤。

## 2026-10-10 — 排名表顯示 7 個子分數，可排序與篩選（使用者要求）
- 完成：排名表新增 7 欄子分數（持久度、擴量、涵蓋、動能、搜尋需求、訂單、毛利），數值為評分時存下的真實子分數 ×100；沒有資料一律顯示「—」，不推估，表格下方附說明。表頭可點擊依該訊號排序（`aria-sort` 標示），排序選單也新增 7 個選項；沒有資料的產品排在最後。新增「訊號篩選」（可收合，每個訊號可選不限 / 有資料 / 40+ / 60+ / 80+，網址參數 `min_<訊號>`）。抽出 `rankingHref` 共用網址組合、`SUB_SCORE_ORDER` 共用順序。依使用者問題，ROADMAP 新增 Phase 4C（探索擴充、真實銷量訊號、照片比對 v2、評分標示）。
- 修正：表頭變成連結後，e2e「點表格第一個連結」會點到排序連結 → 改為只點 tbody 裡的產品連結；中文說明含「還沒有」讓 e2e 正則同時抓到兩個元素 → 正則改精確。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（188，新增子分數排序 / 篩選 / 網址往返、表格欄位與表頭連結、表單）build ✅ e2e ✅（41，新增依單一訊號排序與篩選並檢查每列都有真實值且遞減；axe 無障礙掃描通過）；瀏覽器實測依擴量排序 98、97、96…，動能、搜尋需求、訂單、毛利在真實產品上皆為「—」，伺服器無錯誤。
