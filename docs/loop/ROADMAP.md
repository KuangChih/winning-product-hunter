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
- [ ] 產品詳情頁 v0：分數拆解 + 證據清單（廣告連結、趨勢序列、AliExpress 價格）
- [x] `npm run seed`：一次跑 ingest(fixture) → match → score，方便本機與 preview 環境展示

## Phase 2 — 資料蒐集層
- [x] 統一的 `SourceAdapter` 介面 + fixture 模式 + 重試/限流/錯誤紀錄（`src/ingestion`）
- [x] 第一批 fixture 資料集（Meta EU 廣告、Google Trends、AliExpress）+ 解析器 + CLI job `npm run ingest -- <source|all> --fixture`
- [ ] 各來源 live adapter（依 Phase 0 研究結果決定順序與方式）：Meta /ads_archive、SerpApi google_trends、AliExpress affiliate（需金鑰，先實作請求與簽章並以 mock fetch 測試）
- [ ] 實體對應 v1：加入圖片感知雜湊 + 向量相似度與標註測試集；embedding 欄位需 pgvector migration（PGlite 0.5 未內建 vector，測試需另找方式或以 Neon 分支測）
- [ ] 排程與 ingestion pipeline（Vercel Cron / 外部 worker），含執行紀錄與監控頁

## Phase 3 — 評分引擎
- [ ] 評分 v1：engagementVelocity（robust z-score）、飽和度細化、利潤估算含運費
- [ ] 回測：用歷史資料驗證分數是否能提前抓到後來真的爆的產品，結果寫進 `docs/research/scoring.md`

## Phase 4 — 產品介面
- [ ] Landing page
- [ ] 產品探索頁：篩選（類別、地區、平台、分數、價格、飽和度）、排序、搜尋
- [ ] 產品詳情頁：分數拆解、趨勢圖、原始廣告/影片證據連結、供應商與毛利估算、競爭店家
- [ ] 廣告資料庫瀏覽頁（跨平台）
- [ ] 收藏 / watchlist / 分數變動通知
- [ ] RWD、深色模式、無障礙、i18n（繁中 / 英文）

## Phase 5 — 帳號與商業化
- [ ] 註冊登入
- [ ] 方案與額度限制；Stripe 訂閱（test mode）
- [ ] 管理後台：來源健康度、ingestion 狀態、手動重跑

## Phase 6 — 上線準備
- [ ] 效能（快取、ISR、DB index）、錯誤監控、log
- [ ] 安全檢查（`/security-review`）、rate limiting
- [ ] 隱私權政策 / 服務條款頁草稿（標示需法律審閱）
- [x] Vercel 部署設定與部署文件 `docs/DEPLOY.md`（`vercel-build` 自動 migration；實際部署由使用者執行）
- [ ] 完整 E2E 測試通過
