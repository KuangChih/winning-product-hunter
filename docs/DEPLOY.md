# 部署到 Vercel

本文件說明如何把 Winning Product Hunter 部署到 Vercel。架構背景見 ADR-003（`docs/loop/DECISIONS.md`）。

> **目前狀態**：可以部署成示範站，但還不適合正式對外營運。目前只有樣本資料（fixture）、沒有自動更新資料的排程、沒有帳號與付費功能，Meta 資料的使用條款也還待確認（見 `docs/loop/HUMAN_TODO.md`）。

## 1. 準備 GitHub repo

```bash
git push -u origin main
```

只需要 push `main`。`backup/*` 之類的本機備份分支不必 push。

## 2. 在 Vercel 匯入專案

1. Vercel → **Add New → Project** → 選擇這個 GitHub repo。
2. Framework Preset 會自動偵測為 **Next.js**，Build / Output 設定維持預設即可。
   - 專案有 `vercel-build` script，Vercel 會優先使用它：先跑 database migration，再執行 `next build`（見第 4 節）。
3. **Settings → Build and Deployment → Node.js Version** 選 **22.x 以上**（`package.json` 的 `engines` 要求 Node 22+）。

## 3. 建立資料庫（Neon）

1. Vercel 專案 → **Storage** → 從 Marketplace 加入 **Neon**，並連結到這個專案。
   Vercel 會自動加入 `DATABASE_URL` 等環境變數。
2. 讓 Neon 的 region 與 Vercel 的 **Settings → Functions → Function Region** 一致（例如都在 US East / `iad1`），否則每次查詢都會多一段跨區延遲。
3. 建議開啟 Neon 整合的 **Preview branching**：每個 Preview Deployment 會有獨立的資料庫 branch，不會動到 Production 資料。

> `DATABASE_URL=pglite:...` 只能在本機使用。Vercel 的 serverless 檔案系統不會保留資料，請勿在 Vercel 上使用。

## 4. Migration（自動）

每次部署時，`vercel-build` 會先執行：

```bash
tsx src/jobs/migrate.ts --if-configured
```

- 有 `DATABASE_URL`：套用 `drizzle/` 底下尚未執行的 migration（已套用的會略過，可重複執行）。
- 沒有 `DATABASE_URL`：印出警告並略過，build 照常進行。

如果想在部署前手動套用，可以把 Vercel 的環境變數拉到本機再執行：

```bash
npx vercel env pull .env.local
```

```bash
npm run db:migrate
```

> 修改 `src/db/schema.ts` 後，記得先用 `npm run db:generate` 產生新的 migration 並 commit `drizzle/` 底下的檔案，部署時才會套用。

## 5. 載入資料

資料表建好之後是空的，`/products` 會顯示「No scored products yet」。目前只能載入**樣本資料**：

```bash
npx vercel env pull .env.local
```

```bash
npm run seed
```

`npm run seed` 會依序執行 ingest（所有 fixture 來源）→ match → score。網頁上的樣本資料都會標示「Sample data」。

> 這會寫入 `.env.local` 指向的資料庫。請確認指向的是示範用的資料庫或 Preview branch，而不是之後要放真實資料的 Production 資料庫。

## 6. 環境變數

| 變數 | 環境 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | Production、Preview、Development | Neon 整合會自動設定 |
| `META_ACCESS_TOKEN`、`SERPAPI_KEY`、`ALIEXPRESS_APP_KEY`、`ALIEXPRESS_APP_SECRET`、`ALIEXPRESS_TRACKING_ID` 等 | Production | 接上 live API 後才需要，完整清單見 `.env.example` |

本機開發時，`.env.local` 會同時被 Next.js 與 CLI jobs（`npm run ingest` / `match` / `score` / `seed` / `db:migrate`）讀取。

## 7. 方案選擇

- **Hobby（免費）方案僅限個人、非商業用途**。要向用戶收費的 SaaS 必須使用 **Pro** 方案。
- Hobby 方案的 Vercel Cron 每天最多執行一次；資料更新排程預計由 GitHub Actions 執行（ADR-003），不受此限制。

## 疑難排解

| 症狀 | 原因與處理 |
| --- | --- |
| `relation "product_scores" does not exist`，或頁面顯示「Database is not set up yet」 | 資料庫還沒跑 migration。重新部署（`vercel-build` 會自動套用），或在本機執行 `npm run db:migrate`。 |
| 頁面顯示「No database configured」 | 該環境沒有 `DATABASE_URL`。確認 Neon 整合已連結到 Production / Preview。 |
| 頁面顯示「No scored products yet」 | 資料表是空的，執行 `npm run seed`（樣本資料）。 |
| Build log 出現 `DATABASE_URL is not set; skipping migrations.` | 該環境沒有設定資料庫，migration 被略過。 |

## 尚未完成（之後的 roadmap 項目）

- 用 GitHub Actions 排程定期執行 ingest → match → score（需在 GitHub Secrets 設定 `DATABASE_URL` 與各 API 金鑰）。
- 接上 live API 取代樣本資料。
- 帳號系統、付費功能、隱私權政策與服務條款頁。
