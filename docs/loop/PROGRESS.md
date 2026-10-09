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
