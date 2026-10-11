# 部署到 Vercel

說明如何把 Winning Product Hunter 部署到 Vercel，並在網站上蒐集真實資料。架構背景見 ADR-003、ADR-013（[`loop/DECISIONS.md`](loop/DECISIONS.md)）。

> **目前狀態**：適合使用者個人研究使用。網站有密碼保護（ADR-008），真實資料由「探索」頁（`/discover`）的「開始探索」按鈕與每日 Vercel Cron 蒐集（Meta Ad Library 公開網站、CJ Dropshipping 官方 API、Shopify Global Catalog、ECB 匯率）。網站不顯示任何樣本資料。尚未有多使用者帳號與付費功能；Meta 公開網頁資料限個人研究（ADR-006），對外開放前必須重新評估。

**快速檢查清單**（細節在後面各節）：

1. Vercel 匯入 GitHub repo（第 1 節）
2. 加入 Neon 整合，取得 `DATABASE_URL`（第 2 節）
3. Production 設定 `SITE_PASSWORD`、`CRON_SECRET` 與 `CJ_API_KEY`（第 4 節）
4. 確認 **Fluid compute 開啟**（第 5 節）
5. 部署（migration 自動套用，第 3 節）→ 登入 → `/discover` 按「開始探索」→ 看進度（第 6 節）
6. Meta 擋了 Vercel 的話：Meta 搜尋自動退避，CJ 探索照常（第 7 節）

## 1. 在 Vercel 匯入專案

1. Vercel → **Add New → Project** → 選擇這個 GitHub repo（只需要 push `main`，`backup/*` 等本機分支不必 push）。
2. Framework Preset 會自動偵測為 **Next.js**，Build / Output 設定維持預設。
   - 專案有 `vercel-build` script，Vercel 會優先使用：先套用 database migration，再執行 `next build`（見第 3 節）。
3. **Settings → Build and Deployment → Node.js Version** 選 **22.x 以上**（`package.json` 的 `engines` 要求 Node 22+）。

之後每次 push 到 `main`，Vercel 會自動部署 Production。

## 2. 建立資料庫（Neon）

1. Vercel 專案 → **Storage** → 從 Marketplace 加入 **Neon** 並連結到專案，Vercel 會自動加入 `DATABASE_URL`。
2. Neon 的 region 與 Vercel 的 **Settings → Functions → Function Region** 設成一致（例如都在 US East / `iad1`），避免每次查詢多一段跨區延遲。
3. 建議開啟 Neon 整合的 **Preview branching**：每個 Preview Deployment 有獨立的資料庫 branch，不會動到 Production 資料。Preview 預設不執行探索（第 5 節）。

> `DATABASE_URL=pglite:...` 只能在本機使用。Vercel 的 serverless 檔案系統不會保留資料。

## 3. Migration（自動）

每次部署時 `vercel-build` 會先執行 `tsx src/jobs/migrate.ts --if-configured`：

- 有 `DATABASE_URL`：套用 `drizzle/` 底下尚未執行的 migration（可重複執行）。
- 沒有 `DATABASE_URL`：印出警告並略過，build 照常進行。

要在部署前手動套用：把 Production 的 Neon 連線字串放進本機 `.env.local` 的 `DATABASE_URL`（Neon 主控台 → Connection string），然後：

```bash
npm run db:migrate
```

> 修改 `src/db/schema.ts` 後，要先 `npm run db:generate` 並 commit `drizzle/`，部署時才會套用。

## 4. 環境變數

| 變數                        | 環境                             | 說明                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`              | Production、Preview、Development | Neon 整合會自動設定                                                                                                                                                                                                            |
| `SITE_PASSWORD`             | Production、Preview              | **必設**。設定後所有頁面都要輸入密碼；請用**至少 16 個隨機字元**。同一來源 15 分鐘內輸錯 10 次、或全站累計輸錯 100 次，會暫停登入 15 分鐘（ADR-010）。改密碼會讓所有裝置登出。**Production 沒設時「開始探索」一律拒絕**（fail closed）。本機開發可留空 |
| `CRON_SECRET`               | Production                       | **建議設定**。每日自動探索（Vercel Cron）需要；至少 16 個隨機字元（建議 `openssl rand -hex 32`）。沒設時 cron 不執行（回 503）、探索頁顯示「每日自動探索尚未啟用」，按鈕仍可用。段與段之間的接續 token 也由它衍生（沒設時改用 `DATABASE_URL`） |
| `CJ_API_KEY`                | Production                       | **建議設定**。CJ Dropshipping 官方 API 金鑰（CJ 後台 Apps → API → Add API）。有了它，探索會從 CJ 找有訂單的商品（Meta 被擋時也照常）並補上供貨價；沒設時「搜尋 CJ 熱銷商品」步驟顯示「未設定」並跳過。access token 由程式取得並加密存在資料庫（ADR-014） |
| `PIPELINE_TICK_BUDGET_MS`   | Production                       | 選填，通常不用設。每段 tick 的軟性時間預算（毫秒，預設 200000）；要改請維持在 120000–250000 之間（見第 5 節）                                                                                                                   |
| `PIPELINE_DISABLED`         | 任何                             | 選填。設為 `1` 關閉這個環境的 pipeline（緊急停止開關；探索頁顯示「這個部署已關閉探索功能」）                                                                                                                                       |
| `PIPELINE_ALLOW_PREVIEW`    | Preview                          | 選填。設為 `1` 才允許 Preview deployment 執行 pipeline（不建議，見第 5 節）                                                                                                                                                    |
| `SHOPIFY_UCP_AGENT_PROFILE` | Production                       | 選填。部署後改用自己的 UCP agent profile 網址（目前用 Shopify 官方範例 profile）                                                                                                                                              |

本機開發時，`.env.local` 會同時被 Next.js 與 CLI jobs（`npm run pipeline`、`db:migrate` 等）讀取。新增或修改環境變數後要**重新部署**才會生效（Vercel → Deployments → 最新一筆 → Redeploy）。

## 5. 探索怎麼在 Vercel 上執行（ADR-013）

整條 pipeline（ECB 匯率 → Meta 廣告搜尋（關鍵字 + 追蹤廣告主）→ Shopify Catalog 蒐集 → 廣告主商品頁查詢 → 去重 → 比對 → 評分）是一個**可續跑的 runner**。在 Vercel 上拆成每段約 200 秒的「tick」，一段做完就自動請下一段接手，整條約 10–15 分鐘；進度存在資料庫（`pipeline_runs`），任何一段被中斷都能從資料庫狀態接續。

| 觸發                      | 怎麼運作                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「探索」頁的「開始探索」  | `POST /api/pipeline/start`（需登入，只接受同網站的請求）。可選填最多 10 個自訂關鍵字，留空用系統輪替關鍵字。已有進行中的探索就顯示那一個，不會重複開始。                                       |
| Vercel Cron（每天自動）   | `vercel.json` 設了 06、07、08、09 UTC 四個排程，都呼叫 `/api/internal/cron/daily`：當天第一次（今天還沒有 cron run、也還沒掃過 Meta）才開始探索，其餘三次只負責恢復停住的探索。Hobby 方案的 cron 可能在該小時內任何時間觸發。 |
| `npm run pipeline`（CLI） | 在自己電腦（或 GitHub Actions 手動）執行，沒有時間限制；資料庫上已有進行中的探索時會接手那一個。                                                                                                 |

**Fluid compute 必須開啟**（新專案預設開啟，**Settings → Functions**）：Hobby 方案在 Fluid compute 下每次 function 最多 300 秒。**不支援 60 秒上限的模式**：一個工作單位最長可能要 45 秒（Meta 請求）或 60 秒（collect），超過預算時的強制中止在預算後 50 秒才觸發，60 秒的 function 會在單位做到一半時被砍；把預算調低也沒用（本機實測每段只做一個單位，小 run 就用掉 40 次 tick 上限中的 36 次）。`PIPELINE_TICK_BUDGET_MS` 維持預設 200000；要改請保持在 120000–250000 之間（預算 + 50 秒不能超過 300 秒）。

接續與恢復：

- 每段做完會 POST 給下一段（`/api/internal/pipeline/tick`，不經網站密碼，改用由 `CRON_SECRET`（沒設時用 `DATABASE_URL`）雜湊而來的 Bearer token；只會送往 `https://$VERCEL_PROJECT_PRODUCTION_URL`）。
- 接續失敗（例如 Vercel Firewall 擋了自我請求、`HTTP 508` 迴圈偵測）會記在 `last_kick_error`；開著探索頁時每次輪詢、或下一個整點的 cron，發現探索停住超過 45 秒就接著跑。
- **Preview deployment 預設不執行**（Neon preview branching 會複製出進行中的探索，避免從第二個環境再掃一次 Meta）。`PIPELINE_ALLOW_PREVIEW=1` 可允許，但 Preview 不會自動接續，只靠探索頁輪詢推進。
- **緊急停止**：在 Production 設 `PIPELINE_DISABLED=1` 並重新部署，所有觸發（按鈕、cron、接續）都停止。

蒐集規則（ADR-006，ADR-013 保留）：誠實的 User-Agent、Meta 請求間隔 5 秒（跨 tick 也一樣）、每次探索最多 70 個 Meta 請求、**每個 UTC 日最多 3 次 Meta 掃描**（含每日自動）。用完或被擋時，其他步驟（售價、去重、評分）照跑，狀態標成「部分完成」。被擋（CAPTCHA、要求登入、403/429）就停止並依出口（`vercel` / `github` / `local` 分開計算）退避 6 → 12 → 24 小時…最多 7 天，成功一次就重置；不嘗試繞過。

## 6. 第一次部署後：按「開始探索」並確認

1. 登入網站 → 下方（手機）或上方（桌機）導覽列的「探索」。
2. 按「開始探索」。頁面會顯示步驟清單與進度（例如「搜尋 Meta 廣告 12/50」），每 5 秒更新；可以離開頁面，探索會在伺服器上繼續。
3. 完成後顯示「新增 N 個產品 → 查看新產品」，「產品」頁就有真實資料。

探索頁上的狀態與提示：

| 看到的                                         | 意思與處理                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 執行中                                         | 正在跑；步驟清單顯示做到哪裡。                                                                                                                                     |
| 完成                                           | 所有步驟成功。                                                                                                                                                     |
| 部分完成                                       | 有步驟失敗或被跳過（例如 Meta 被擋、今日掃描次數用完），其他步驟照跑，已蒐集的資料都有保存。展開「技術細節」可看原始錯誤。                                         |
| 失敗                                           | 整個探索中止（例如超過 20 小時或 40 段上限）。下一次按鈕或每日 cron 會重新開始。                                                                                   |
| 步驟「已跳過」                                 | 附原因：Meta 暫時擋下這台伺服器、今天的 Meta 搜尋次數已用完、這次沒有需要做的項目、太久沒有進展、執行時間用完等。                                                             |
| 「Meta 擋下了這台伺服器」                      | Meta 拒絕了 Vercel 的請求，Meta 搜尋暫停到顯示的時間；按鈕在這段期間只更新售價、去重、評分。處理見第 7 節。                                                         |
| 「今天的 Meta 搜尋次數已用完」                 | 今天（UTC）已跑過 3 次完整 Meta 掃描（含每日自動），UTC 午夜重置；按鈕仍可更新售價、去重、評分。                                                                   |
| 「每日自動探索尚未啟用」                       | Production 沒有 `CRON_SECRET`。設定後重新部署。                                                                                                                    |
| 「這裡無法開始探索」                           | 附原因：沒有資料庫、資料表還沒建立（重新部署一次）、這個部署已關閉探索（`PIPELINE_DISABLED`）、Preview 不執行、正式站沒有設定密碼（設定 `SITE_PASSWORD`）。         |
| 「一段時間沒有進展」／「交接給下一段失敗」     | 段與段之間的接續中斷；開著頁面時會自動接著跑，否則下一個整點的 cron 會接手。持續發生時看第 8 節。                                                                  |
| 「登入已過期」                                 | 進度停止更新；重新登入即可，探索本身不受影響。                                                                                                                     |

也可以直接看 `GET /api/pipeline/status`（需登入）：`run.status` 從 `running` 變成 `succeeded` / `partial`，`run.ticks` 隨每段增加，`run.lastKickError` 應為 `null`；`run.blocked` 或 `adLibrary.pausedUntil` 有值代表 Meta 擋了這台伺服器。

## 7. Meta 擋了 Vercel 時

Vercel 對外是 AWS 機房 IP，Meta 可能直接擋（2026-10-11 實際回 HTTP 403）。依 ADR-006 我們不繞過，只退避：Meta 搜尋暫停 6 → 12 → 24 小時…（最多 7 天），時間到了自動再試，解封後資料自然補上。

暫停期間探索照常進行（ADR-014）：「搜尋 CJ 熱銷商品」步驟用 CJ 官方 API 找 CJ 上有訂單、最近還在賣的商品並建立產品，接著照常查 Shopify、合併重複、評分。需要 Production 有 `CJ_API_KEY`（第 4 節）；設定或修改後要 Redeploy 才生效。

- 只有 CJ 證據的產品，廣告相關的子分數會顯示「—」、可信度低，而且最高 50 分（只量到一個訊號）；詳情頁的「供應商報價」顯示 CJ 訂單數與上架數（CJ 平台計數，不是整個市場）。
- CJ 回「點數用完」或「請求太多」時 CJ 也會退避，不重試；回「金鑰無效」時請檢查 `CJ_API_KEY`。

GitHub Actions 的「Pipeline (manual)」（`.github/workflows/daily-pipeline.yml`）是另一個出口（`github`），也可以手動執行：repo → **Settings → Secrets and variables → Actions** 新增 secret `DATABASE_URL`（與 Vercel Production 相同）、選填 `SHOPIFY_UCP_AGENT_PROFILE`，再到 **Actions → Pipeline (manual) → Run workflow**。GitHub 也是機房 IP，被擋的機率與 Vercel 相近；每日排程已移除，由 Vercel Cron 負責。

## 8. 方案與疑難排解

- **Hobby（免費）方案僅限個人、非商業用途**。向使用者收費的 SaaS 必須用 **Pro**。
- Hobby 允許每專案 100 個 cron、每個每天最多一次，本專案用 4 個。

| 症狀                                                                                 | 原因與處理                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `relation "product_scores" does not exist`，或頁面顯示資料庫尚未建立                 | 還沒跑 migration。重新部署，或在本機執行 `npm run db:migrate`。                                                                                                                |
| 頁面顯示沒有連接資料庫                                                               | 該環境沒有 `DATABASE_URL`，確認 Neon 整合已連結到 Production / Preview。                                                                                                      |
| 產品頁沒有產品                                                                       | 資料表是空的。到「探索」頁按「開始探索」；Meta 被擋時要有 `CJ_API_KEY` 才會從 CJ 找到產品（第 7 節）。                                                                         |
| `run.lastKickError` 不是空的                                                         | 段與段之間的自動接續失敗。`HTTP 401/403`：token 不符、Deployment Protection 或 Firewall 擋了 `/api/internal/pipeline/tick`；`HTTP 508`：Vercel 迴圈偵測。開著探索頁或等 cron 會接手；持續發生請回報。 |
| 每日自動探索沒有執行                                                                 | 沒設 `CRON_SECRET`（cron route 回 503）、今天已經掃過 Meta，或 Hobby 的 cron 還沒到觸發時間。到 Vercel → **Settings → Cron Jobs** 看執行紀錄。                                 |
| Build log 出現 `DATABASE_URL is not set; skipping migrations.`                       | 該環境沒有設定資料庫，migration 被略過。                                                                                                                                       |
| Meta 搜尋步驟被跳過（Meta 暫時擋下這台伺服器）                                         | 依 ADR-006 不繞過、自動退避；CJ 探索照常（第 7 節）。                                                                                                                          |
| 「搜尋 CJ 熱銷商品」被跳過或失敗                                                       | 「未設定」：Production 沒有 `CJ_API_KEY`（設定後 Redeploy）。「CJ 拒絕了 API 金鑰」：金鑰錯或已刪除。「點數用完／請求太多」：CJ 自動退避，之後會再試。                                    |

> 網站不顯示樣本資料（fixture 只留給自動測試，`npm run seed` 已移除）。
