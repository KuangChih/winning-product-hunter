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

## Phase 2 — 資料蒐集層
- [ ] 統一的 `SourceAdapter` 介面 + fixture 模式 + 重試/限流/錯誤紀錄
- [ ] 各來源 adapter（依 Phase 0 研究結果決定順序與方式）
- [ ] 正規化：原始資料 → 統一的 product candidate
- [ ] 產品實體對應（圖片感知雜湊 + 文字相似度）與測試資料集；embedding 欄位需 pgvector migration（PGlite 0.5 未內建 vector，測試需另找方式或以 Neon 分支測）
- [ ] 排程與 ingestion pipeline（Vercel Cron / 外部 worker），含執行紀錄與監控頁

## Phase 3 — 評分引擎
- [ ] 實作 Winning Score（各子分數可解釋、可調權重）
- [ ] 時間序列速度指標、飽和度、利潤估算
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
- [ ] Vercel 部署設定與部署文件 `docs/DEPLOY.md`（實際部署由使用者執行）
- [ ] 完整 E2E 測試通過
