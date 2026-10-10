# 部署到 Vercel

說明如何把 Winning Product Hunter 部署到 Vercel，並啟用每日自動蒐集。架構背景見 ADR-003（[`loop/DECISIONS.md`](loop/DECISIONS.md)）。

> **目前狀態**：適合使用者個人研究使用。網站有密碼保護（ADR-008），真實資料由網頁「開始探索」按鈕與每日 Vercel Cron 蒐集（Meta Ad Library 公開網站、Shopify Global Catalog、ECB 匯率）。尚未有多使用者帳號與付費功能；Meta 公開網頁資料限個人研究（ADR-006），對外開放前必須重新評估。

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
| `CRON_SECRET`               | Production                       | 選填但建議設定。每日自動探索（Vercel Cron）需要；沒設定時 cron 不執行，網頁按鈕仍可用（第 5 節） |
| `PIPELINE_TICK_BUDGET_MS`   | Production                       | 選填，通常不用設。每段 tick 的軟性時間預算（毫秒，預設 200000）；請維持在 120000–250000 之間（見第 5 節） |
| `PIPELINE_DISABLED`         | 任何                             | 選填。設為 `1` 關閉這個環境的 pipeline                                                          |
| `PIPELINE_ALLOW_PREVIEW`    | Preview                          | 選填。設為 `1` 才允許 Preview deployment 執行 pipeline                                         |
| `SHOPIFY_UCP_AGENT_PROFILE` | Production、GitHub Actions       | 選填。部署後改用自己的 UCP agent profile 網址（目前用 Shopify 官方範例 profile）                                                                                                              |
| `CJ_API_KEY` 等來源金鑰     | GitHub Actions                   | 拿到金鑰後才需要，清單見 [`loop/HUMAN_TODO.md`](loop/HUMAN_TODO.md)                                                                                                                          |

本機開發時，`.env.local` 會同時被 Next.js 與 CLI jobs（`npm run pipeline`、`db:migrate` 等）讀取。

## 5. 真實資料蒐集（網頁按鈕 + Vercel Cron，ADR-013）

整條 pipeline（ECB 匯率 → 產品探索（關鍵字 + 追蹤廣告主）→ Shopify Catalog 蒐集 → 廣告主商品頁查詢 → 去重 → 比對 → 評分）是一個**可續跑的 runner**，在 Vercel 上拆成每段約 200 秒的「tick」執行，一段做完就自動接下一段，整條約 10–15 分鐘。三種觸發方式走同一套流程：

> 開發中（2026-10-10）：API 與 Vercel Cron 已完成；網頁上的「開始探索」按鈕與探索頁在下一個里程碑加入，在那之前可登入後用瀏覽器開發者工具或 `curl` 呼叫 `POST /api/pipeline/start`（需帶網站 cookie 與同網站的 `Origin`）。

| 觸發                     | 怎麼運作                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 網頁「開始探索」         | `POST /api/pipeline/start`（需登入，只接受同網站的請求）。已有進行中的 run 就回傳那一個，不會重複開始。正式環境沒設 `SITE_PASSWORD` 時拒絕。 |
| Vercel Cron（每天自動）  | `vercel.json` 設了 06、07、08、09 UTC 四個排程，都呼叫 `/api/internal/cron/daily`：當天第一次（今天還沒掃過 Meta）才建立 run，其餘只負責恢復停住的 run。 |
| `npm run pipeline`（CLI） | 本機或 GitHub Actions 手動執行，沒有時間限制；資料庫上已有進行中的 run 時會接手那一個。                                                      |

設定步驟：

1. **`CRON_SECRET`**：Vercel → **Settings → Environment Variables** 新增 `CRON_SECRET`（Production，至少 32 個隨機字元，例如 `openssl rand -hex 32`）。Vercel Cron 會自動帶 `Authorization: Bearer $CRON_SECRET`。**沒設定時每日自動探索不會執行**（cron route 回 503），網頁按鈕仍可用；`/api/pipeline/status` 的 `cronConfigured` 會是 `false`（只回報有沒有設定，不會回傳值）。
2. **Fluid compute 必須開啟**（新專案預設開啟，**Settings → Functions**）：Hobby 方案在 Fluid compute 下每次 function 最多 300 秒。**不支援 60 秒上限的模式**：一個工作單位最長可能要 45 秒（Meta 請求）或 60 秒（collect），超過預算時的強制中止又在預算後 50 秒才觸發，60 秒的 function 會在單位做到一半時被砍；把預算調到 `30000` 也沒用，本機實測每段只做一個單位，一個自訂關鍵字的小 run 就用了 40 次 tick 上限中的 36 次，預設 run（約 80 個單位）會撞到上限提早收尾。`PIPELINE_TICK_BUDGET_MS` 維持預設 200000 即可；要改請保持在 120000–250000 之間（預算 + 50 秒不能超過 300 秒）。
3. 重新部署後，到網站按一次「開始探索」，或直接查看 `GET /api/pipeline/status`（需登入）確認進度：`run.status` 從 `running` 變成 `succeeded` / `partial`，`run.ticks` 會隨每段增加，`run.lastKickError` 應為 `null`。

怎麼接續與恢復：

- 每段 tick 做完會 POST 給下一段（`/api/internal/pipeline/tick`，Bearer token 由 `CRON_SECRET`（沒設時用 `DATABASE_URL`）雜湊而來；只會送往 `VERCEL_PROJECT_PRODUCTION_URL` 的 https 網址）。
- 接續失敗（例如 Vercel Firewall 擋了自我請求、508 迴圈偵測）會記在 `last_kick_error`；探索頁輪詢 status 時，或下一個整點的 cron，發現 run 停住超過 45 秒就接著跑。
- **Preview deployment 預設不執行**（Neon preview branching 會複製出 `running` 的 run，避免同一天從第二個環境再掃一次 Meta）；真的要測試時在 Preview 設 `PIPELINE_ALLOW_PREVIEW=1`（Preview 不會自動接續，靠 status 輪詢推進）。`PIPELINE_DISABLED=1` 可整個關閉（e2e 測試伺服器就是這樣設的）。

限制與規則（ADR-006 保留）：每個 run 最多 70 個 Meta 請求、每個 UTC 日最多 3 次 Meta 掃描（含每日自動）；用完或被擋時，其他步驟照跑、狀態標成 `partial`。被擋時依 egress（`vercel` / `github` / `local` 分開計算）退避 6 → 12 → 24 小時…最多 7 天，不嘗試繞過。

> **風險**：Vercel 對外是 AWS 機房 IP，Meta 可能直接擋；本機（住宅 IP）實測成功不代表 Vercel 也會成功。被擋時探索頁會顯示 Meta 擋了伺服器的請求與退避到何時，此時可在自己電腦用同一個 Neon 連線字串執行 `npm run pipeline`（Vercel 被擋不影響本機的退避）。

手動在 GitHub 執行（`.github/workflows/daily-pipeline.yml`，名稱「Pipeline (manual)」）：

1. GitHub repo → **Settings → Secrets and variables → Actions** → 新增 secret `DATABASE_URL`（與 Vercel Production 相同的 Neon 連線字串）。
2. 選填：新增 `SHOPIFY_UCP_AGENT_PROFILE`。
3. **Actions → Pipeline (manual) → Run workflow**，可調整關鍵字數、自訂關鍵字、追蹤廣告主數與蒐集產品數。

## 6. 方案選擇

- **Hobby（免費）方案僅限個人、非商業用途**。向使用者收費的 SaaS 必須用 **Pro**。
- 資料蒐集在 Vercel 分段執行（ADR-013）：Hobby 允許每專案 100 個 cron、每個每天一次，本專案用 4 個；GitHub Actions 只保留手動執行，私有 repo 每月 2,000 分鐘免費額度足夠。

## 疑難排解

| 症狀                                                                                      | 原因與處理                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `relation "product_scores" does not exist`，或頁面顯示「Database is not set up yet」      | 還沒跑 migration。重新部署，或在本機執行 `npm run db:migrate`。                |
| 頁面顯示「No database configured」                                                        | 該環境沒有 `DATABASE_URL`，確認 Neon 整合已連結到 Production / Preview。      |
| 排名頁沒有產品                                                                            | 資料表是空的。到網站按「開始探索」，或在本機 `npm run pipeline`。              |
| `/api/pipeline/status` 的 `run.lastKickError` 不是空的                                    | 段與段之間的自動接續失敗（Firewall、508 等）；status 輪詢或下一個整點的 cron 會接著跑。持續發生時檢查 Vercel Firewall 是否擋了 `/api/internal/pipeline/tick`。 |
| 每日自動探索沒有執行                                                                      | 沒設 `CRON_SECRET`（cron route 回 503），或今天已經掃過 Meta。到 Vercel → **Cron Jobs** 看執行紀錄。 |
| Build log 出現 `DATABASE_URL is not set; skipping migrations.`                            | 該環境沒有設定資料庫，migration 被略過。                                       |
| Pipeline 的 discover 步驟失敗或被跳過（backoff）                                          | Vercel / GitHub 是機房 IP，Meta 可能擋。依 ADR-006 不繞過、自動退避；可改在自己電腦執行 `npm run pipeline`。 |

> 只想看介面時，可用 `npm run seed` 載入**樣本資料**（fixture）。樣本資料在網頁上會標示「Sample data」，排名頁預設不顯示。請勿對 Production 資料庫執行。
