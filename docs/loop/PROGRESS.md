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
