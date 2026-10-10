# 部署到 Vercel

說明如何把 Winning Product Hunter 部署到 Vercel，並啟用每日自動蒐集。架構背景見 ADR-003（[`loop/DECISIONS.md`](loop/DECISIONS.md)）。

> **目前狀態**：適合使用者個人研究使用。網站有密碼保護（ADR-008），真實資料由每日排程蒐集（Meta Ad Library 公開網站、Shopify Global Catalog、ECB 匯率）。尚未有多使用者帳號與付費功能；Meta 公開網頁資料限個人研究（ADR-006），對外開放前必須重新評估。

## 1. 在 Vercel 匯入專案

1. Vercel → **Add New → Project** → 選擇這個 GitHub repo（只需要 push `main`，`backup/*` 等本機分支不必 push）。
2. Framework Preset 會自動偵測為 **Next.js**，Build / Output 設定維持預設。
   - 專案有 `vercel-build` script，Vercel 會優先使用：先套用 database migration，再執行 `next build`（見第 3 節）。
3. **Settings → Build and Deployment → Node.js Version** 選 **22.x 以上**（`package.json` 的 `engines` 要求 Node 22+）。

## 2. 建立資料庫（Neon）

1. Vercel 專案 → **Storage** → 從 Marketplace 加入 **Neon** 並連結到專案，Vercel 會自動加入 `DATABASE_URL`。
2. Neon 的 region 與 Vercel 的 **Settings → Functions → Function Region** 設成一致（例如都在 US East / `iad1`），避免每次查詢多一段跨區延遲。
3. 建議開啟 Neon 整合的 **Preview branching**：每個 Preview Deployment 有獨立的資料庫 branch，不會動到 Production 資料。

> `DATABASE_URL=pglite:...` 只能在本機使用。Vercel 的 serverless 檔案系統不會保留資料。

## 3. Migration（自動）

每次部署時 `vercel-build` 會先執行 `tsx src/jobs/migrate.ts --if-configured`：

- 有 `DATABASE_URL`：套用 `drizzle/` 底下尚未執行的 migration（可重複執行）。
- 沒有 `DATABASE_URL`：印出警告並略過，build 照常進行。

要在部署前手動套用，先把 Vercel 的環境變數拉到本機：

```bash
npx vercel env pull .env.local
```

```bash
npm run db:migrate
```

> 修改 `src/db/schema.ts` 後，要先 `npm run db:generate` 並 commit `drizzle/`，部署時才會套用。

## 4. 環境變數

| 變數                        | 環境                             | 說明                                                                                                                                                                                         |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Production、Preview、Development | Neon 整合會自動設定                                                                                                                                                                          |
| `SITE_PASSWORD`             | Production、Preview              | **部署前必設**。設定後所有頁面都要輸入密碼；請用**至少 16 個隨機字元**。同一來源 15 分鐘內輸錯 10 次、或全站累計輸錯 100 次，會暫停登入 15 分鐘（ADR-010）。改密碼會讓所有裝置登出。本機開發可留空 |
| `SHOPIFY_UCP_AGENT_PROFILE` | Production、GitHub Actions       | 選填。部署後改用自己的 UCP agent profile 網址（目前用 Shopify 官方範例 profile）                                                                                                              |
| `CJ_API_KEY` 等來源金鑰     | GitHub Actions                   | 拿到金鑰後才需要，清單見 [`loop/HUMAN_TODO.md`](loop/HUMAN_TODO.md)                                                                                                                          |

本機開發時，`.env.local` 會同時被 Next.js 與 CLI jobs（`npm run pipeline`、`db:migrate` 等）讀取。

## 5. 真實資料蒐集（目前：只能手動）

> **注意（2026-10-10）**：GitHub Actions 的每日排程已移除，改由 Vercel Cron 觸發同一套可續跑的 pipeline（ADR-013）。Vercel Cron 與網頁「開始探索」按鈕還在開發中（下一個里程碑），**在那之前沒有任何每日自動蒐集**，要手動執行。

`npm run pipeline`（本機或 GitHub Actions 手動執行）：ECB 匯率 → 產品探索（關鍵字 + 追蹤廣告主）→ Shopify Catalog 蒐集 → 廣告主商品頁查詢 → 去重 → 比對 → 評分。每個 UTC 日最多 3 次 Meta 掃描（含之後的每日自動）；用完或被擋時，其他步驟照跑、狀態標成 `partial`。

手動在 GitHub 執行（`.github/workflows/daily-pipeline.yml`，名稱「Pipeline (manual)」）：

1. GitHub repo → **Settings → Secrets and variables → Actions** → 新增 secret `DATABASE_URL`（與 Vercel Production 相同的 Neon 連線字串）。
2. 選填：新增 `SHOPIFY_UCP_AGENT_PROFILE`。
3. **Actions → Pipeline (manual) → Run workflow**，可調整關鍵字數、自訂關鍵字、追蹤廣告主數與蒐集產品數。資料庫上已有進行中的 run 時會接手那一個。

GitHub runner 被 Meta 擋時，退避只影響 GitHub（egress `github`），不影響本機或 Vercel。某一步失敗（例如來源被擋）時 workflow 會標示失敗並寄信通知 repo 擁有者；其他步驟照跑，已取得的資料會保留。

## 6. 方案選擇

- **Hobby（免費）方案僅限個人、非商業用途**。向使用者收費的 SaaS 必須用 **Pro**。
- 資料蒐集改為在 Vercel 分段執行（ADR-013，開發中）；GitHub Actions 只保留手動執行，私有 repo 每月 2,000 分鐘免費額度足夠。

## 疑難排解

| 症狀                                                                                      | 原因與處理                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `relation "product_scores" does not exist`，或頁面顯示「Database is not set up yet」      | 還沒跑 migration。重新部署，或在本機執行 `npm run db:migrate`。                |
| 頁面顯示「No database configured」                                                        | 該環境沒有 `DATABASE_URL`，確認 Neon 整合已連結到 Production / Preview。      |
| 排名頁沒有產品                                                                            | 資料表是空的。手動執行一次 Pipeline (manual)，或在本機 `npm run pipeline`。    |
| Build log 出現 `DATABASE_URL is not set; skipping migrations.`                            | 該環境沒有設定資料庫，migration 被略過。                                       |
| Pipeline 的 discover 步驟失敗                                                             | GitHub 是機房 IP，Meta 可能擋。依 ADR-006 不繞過；看 `/sources` 頁的失敗紀錄。 |

> 只想看介面時，可用 `npm run seed` 載入**樣本資料**（fixture）。樣本資料在網頁上會標示「Sample data」，排名頁預設不顯示。請勿對 Production 資料庫執行。
