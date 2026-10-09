# Architecture Decision Records

格式：

```
## ADR-NNN：<標題>（<日期>，狀態：採用 / 取代於 ADR-XXX）
- 背景：
- 選項：
- 決定：
- 理由：
- 後果：
```

## ADR-001：資料來源策略（2026-10-09，狀態：採用）
- 背景：Meta 與 TikTok 的官方廣告 API 只開放 EU/UK 的商業廣告；Google Trends 官方 API 仍為 alpha；Amazon PA-API 5 已停用。合規規則禁止繞過反爬機制。詳見 `docs/research/data-sources.md`。
- 選項：(A) 自建爬蟲抓 Meta/TikTok 美國廣告；(B) 只用官方 API；(C) 官方 API + 授權第三方資料商（Apify、SerpApi、Keepa），把 EU 廣告資料當成代理指標。
- 決定：C。第一批接 Meta Ad Library（EU）、Google（SerpApi：Ads Transparency + Trends）、AliExpress Affiliate；第二批接 TikTok（Commercial Content API / Apify Creative Center）、Keepa、CJ、Shopify `products.json`。
- 理由：A 違反 ToS 且有法律與封鎖風險；B 訊號太少；C 在合規前提下取得最多獨立訊號。
- 後果：adapter 分「來源」與「供應商」兩層；UI 需清楚標示每個訊號的覆蓋範圍；Meta 資料能否用於商業產品需法律確認。

## ADR-002：評分與實體對應方法（2026-10-09，狀態：採用，待回測修正）
- 背景：業界評分公式皆未公開；持續天數只代表存活力不等於獲利；單一來源易偏誤。詳見 `docs/research/scoring.md`。
- 選項：(A) 機器學習模型直接預測；(B) 可解釋的加權子分數 + 佐證/飽和乘數；(C) 只做排序不給分數。
- 決定：B（v0 規格見 scoring.md）。缺資料的子分數不計入並降低信心度；單一來源上限 70 分。實體對應採 dHash/pHash → CLIP 向量（pgvector）→ 規則決策三層漏斗。
- 理由：初期沒有標註資料無法訓練 A；B 透明可驗證，符合差異化定位；累積回測資料後可再引入 A 調權重。
- 後果：ingestion 必須保存不可覆寫的時間序列快照；評分模組要輸出完整拆解；需要 Postgres pgvector 與外部 embedding 計算。

## ADR-003：整體架構、資料庫、排程與驗證（2026-10-09，狀態：採用）
- 背景：Vercel function 上限 Hobby 300 秒、Pro 800 秒（延伸 1800 秒）；Vercel Cron 在 Hobby 只能每天一次、Pro 可每分鐘；評分需要 pgvector 與不可覆寫的時間序列快照（ADR-002）；Auth.js 已於 2025-09 由 Better Auth 團隊接手維護，官方建議新專案用 Better Auth。
- 選項：
  - 資料庫：Neon / Supabase
  - 抓取執行位置：Vercel Cron + function / GitHub Actions 排程 / 獨立 worker 主機（Railway、Fly）
  - 驗證：Better Auth / Clerk / Auth.js
- 決定：
  - **單一 Next.js（App Router）專案**部署在 Vercel，負責 UI 與讀取 API。
  - **Neon Postgres**（Vercel 原生整合、支援 pgvector、preview 分支資料庫）+ Drizzle ORM。資料存取都透過 repository 層，日後要換 Supabase 只改這層。
  - **Ingestion 與評分以 Node CLI 腳本實作**（`src/jobs/*`），同一份程式碼可在三處執行：本機、GitHub Actions 排程（預設，免費、單次最多 6 小時）、Vercel Cron（只做輕量觸發，Hobby 每日一次）。
  - **Better Auth**，使用者與 session 存在自己的 Postgres。權限檢查放在 server component / route handler，不只靠 middleware（CVE-2025-29927 的教訓）。
  - 套件管理用 npm；Node 22 LTS 以上。
- 理由：抓取與 embedding 計算時間不可控，不適合 Vercel function；GitHub Actions 無額外成本、跟 repo 同處；Better Auth 免費、資料自有、Next.js 生態主流。
- 後果：jobs 不能依賴 Next.js runtime；需要 `DATABASE_URL` 與各 API key 同時設定在 Vercel 與 GitHub Secrets；Vercel Hobby 方案的 cron 只能每日，若需更頻繁要升級 Pro 或全交給 GitHub Actions。

## ADR-004：先做端到端垂直切片，再接 live API（2026-10-09，回顧輪 10，狀態：採用）
- 背景：前 9 輪完成研究、骨架、schema、adapter 層與 fixtures。所有 API 金鑰都還沒有，live adapter 寫了也無法驗證真實回應；而實體對應、評分、頁面都還沒開始，schema 與評分設計尚未被實際使用驗證。
- 選項：(A) 照原順序先寫所有 live adapter；(B) 先用 fixtures 打通 蒐集 → 對應 → 評分 → 頁面 的最小版本，再回頭接 live API。
- 決定：B。新增 ROADMAP「Phase 2A」。實體對應 v0 只用文字（fixture 圖片網址是假的，圖片雜湊等真實資料再做）。
- 理由：越早有可展示、可點進去看證據的產品頁，越早發現 schema/評分設計的問題；拿到金鑰後只需替換 adapter 供應商。
- 後果：live adapters 移到垂直切片之後；首頁/探索頁必須清楚標示樣本資料。
