# 進度紀錄

每輪在最下面追加一筆。格式：

```
## <YYYY-MM-DD> — <任務>
- 完成：
- 成效：（真實資料上的前後數字；量不到就說明原因與之後怎麼量）
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（N）build ✅ e2e ✅（N）
- 限制：
- 下一步：
```

## 早期進度摘要（2026-10-09～10-10，第 1～約 50 輪）

舊的逐輪紀錄已整理成下表，細節見 git log。

| 階段                     | 完成內容                                                                                                                                                           | 關鍵數字與發現                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 研究與架構               | 資料來源、競品、評分研究；ADR-001～003                                                                                                                              | 美國商業廣告沒有任何官方 API；競品評分全是黑盒子                                                                                                                                                  |
| 專案骨架                 | Next.js 16、Drizzle schema、PGlite 測試、CI、`SourceAdapter` + fixture、ingest CLI                                                                                  | —                                                                                                                                                                                                 |
| 垂直切片（ADR-004）      | 實體對應 v0（文字）、評分 v0、排名頁、詳情頁、`npm run seed`、Vercel 自動 migration                                                                                 | 樣本排名符合設計的故事（合理性檢查，不是回測）                                                                                                                                                    |
| 第一手資料（ADR-005、006） | 國家維度、移除 AliExpress、Shopify Global Catalog、ECB 匯率、Meta Ad Library 公開網站蒐集器                                                                         | Global Catalog 不需金鑰，5 產品 × 5 國 525 筆；Ad Library 25 個請求 443 筆，未被擋                                                                                                                |
| 真實資料閉環（ADR-007）  | 產品探索 v1、`npm run pipeline`、評分 v1、排名頁預設只顯示真實資料、每日排程、`/sources` 健康度頁、廣告主商品頁查詢                                                 | 2 個關鍵字 × 5 國 → 298 則廣告 → 23 個真實產品；TikTok Creative Center 需頁面簽章，暫緩                                                                                                           |
| 資料品質與評分           | 實體對應 v1（商品照片 dHash）、廣告動能（v1.1）                                                                                                                    | 28 張真實照片 0 個合併（最近距離 9），規則刻意保守；動能需 5 天以上歷史                                                                                                                           |
| 介面與安全（ADR-008～011） | Landing page、排名篩選、詳情頁毛利、`/ads`、Watchlist、站台密碼、防暴力破解、安全標頭、RWD、深色模式、無障礙、中英文介面                                            | axe 掃描 0 違規；production `npm audit` 7 high → 0；e2e 41 個                                                                                                                                     |

## 2026-10-10 — 排名表顯示 7 個子分數，可排序與篩選（使用者要求）

- 完成：排名表新增 7 欄子分數（持久度、擴量、涵蓋、動能、搜尋需求、訂單、毛利），數值為評分時存下的真實子分數 ×100；沒有資料一律顯示「—」。表頭可點擊排序（`aria-sort`），沒有資料的排最後；新增「訊號篩選」（不限 / 有資料 / 40+ / 60+ / 80+，網址參數 `min_<訊號>`）。依使用者問題新增 Phase 4C。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（188）build ✅ e2e ✅（41）
- 成效：真實產品的動能、搜尋需求、訂單、毛利皆為「—」——如實反映目前缺的訊號。

## 2026-10-10 — 追蹤廣告主（Phase 4C，新版 Loop 協定第 1 輪）

- 完成：Ad Library 蒐集器新增廣告主模式（`view_all_page_id`，一個粉專一國一個請求）；`src/discovery/advertisers.ts` 挑選廣告連到商品頁的電商店家、依其產品分數排序、每日輪替，排除樣本與已合併產品；pipeline 新增「follow advertisers」步驟（預設 10 個、間隔 5 秒）；`npm run discover -- --advertisers=N`。
- 成效（示範資料庫，真實請求）：10 個請求 → 245 則廣告 → 28 個有潛力產品（15 新、13 補強）；對照關鍵字掃描 10 個請求 → 29 個新產品。最後 213 個真實產品、846 則廣告。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（194）build ✅（未改頁面）
- 限制：每個請求的新產品數低於關鍵字掃描；「更早發現新品」要等每日資料累積才能量測；只取粉專第一頁（約 30 則）。

## 2026-10-10 — 資料品質 A：Meta 廣告只掛到它連到的產品

- 問題：手動 `collect meta_ad_library` 用產品標題搜尋，把所有用類似字眼的廣告主都掛到這個產品上。
- 完成：只掛連到該產品自己商品頁（`landingKey` 相同）的廣告；`runMatching` 不再用標題處理 Ad Library 廣告；`npm run repair -- ad-attachments [--apply]`（預設只預覽）修復既有資料。
- 成效（示範資料庫）：846 則中 173 則（20%）錯掛 → 0 則；25 則搬到正確產品、148 則刪除，17 個產品受影響。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（197）build ✅
- 限制：正式資料庫的每日排程不跑 `collect meta_ad_library`，理論上不受影響；若曾手動對 Neon 跑過，執行 repair 即可。

## 2026-10-10 — 資料品質 B：售價只用廣告主自己的商品頁（ADR-012）

- 完成：評分、排名表售價、價格篩選、毛利估算只用廣告主商品頁（`shopify_catalog_lookup`）的售價；標題搜到的商品改稱「同類商品」，只用於飽和度；詳情頁分成「廣告主商店」與「同類商品」兩區。
- 成效（示範資料庫，重新評分 213 個產品）：有售價的產品 43 → 26（17 個原本顯示的是同類商品中位數）；Ear Cleaner $30.72 → $34.99（廣告主實際售價）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（198）build ✅ e2e ✅（41）；瀏覽器實測中英文詳情頁。
- 限制：售價覆蓋率只有 26 / 208。
- 下一步：售價覆蓋率（ROADMAP Phase 4C）

## 2026-10-10 — 整理 git history 與 docs（使用者要求）

- 完成：git history 依功能從 65 個 commit 合併成 18 個（最終檔案內容與原本完全相同，原歷史備份在本機分支 `backup/pre-squash-2026-10-10`）；docs 全面改寫：刪除已被取代的 `research/data-sources.md`，ROADMAP 與 PROGRESS 把已完成項目整理成摘要，DEPLOY 與 HUMAN_TODO 更新成目前狀態，研究文件移除過時建議並統一用語。
- 限制：本地 `main` 與 GitHub 上的 `origin/main` 歷史已分岔，要同步需使用者自行決定是否 force push。

## 2026-10-10 — Vercel 探索 M1：資料層強化（runner 的前置）

- 完成：
  - Schema（migration 0009，只新增）：`pipeline_runs`（同時只能一個 `running`）、`pipeline_stage`、`collection_attempts`、`source_backoff`、`ingestion_runs.pipeline_run_id`。
  - HTTP：sleep / rate limiter 可被 `AbortSignal` 中斷；每次嘗試逾時（`timeoutMs`）；rate limiter 可接續保存的下次請求時間。
  - 寫入：`runIngestion` 拆成 start / ingest / finish，每批 100 筆（或最舊一筆等滿 2 秒）寫入，同一 `externalId` 照順序、不同的 8 個並行，結果與逐筆寫入相同；呼叫端中止時已抓到的照樣存，`/sources` 記錄存了幾筆並標成「Interrupted」；`reapStaleIngestionRuns` 關閉卡住的紀錄。
  - 探索：拆成 fetch / store；建立產品遇到 landing key 衝突就跳過再重查（slug 衝突仍會報錯，不會默默丟廣告）。
  - 挑選：`src/pipeline/targets.ts` 用 `collection_attempts`（有結果或沒結果 7 天、錯誤 1 天內不重挑，從未嘗試的優先，排除樣本產品）；中途被中止時，已做完的產品照樣記錄，只有被切斷的那一個留待下次；只有關鍵字層級資料（`trend`）不算「找到」；抓到但沒存進去的記成錯誤。
  - 照片：只用產品自己的、廣告主商品頁的或廣告的照片，不再用「同類商品」的照片；下載 15 秒逾時、只允許 https、拒絕私有網段、每次轉址都重新檢查、10 MB 上限；失敗的照片隔一天才重試且不擋住新產品；被中止時已完成的結果照樣記錄，沒輪到的產品還原。
  - `npm run repair -- product-images [--apply]`（預設預覽）：只處理探索出來、非樣本、照片確實來自 Shopify 搜尋結果的產品。
  - 評分：不讀 `raw`、snapshot 改用 JOIN（沒有 65,535 參數上限）、資料庫端只回傳評分用得到的值。
  - Neon 查詢 20 秒逾時；migration 改用 10 分鐘。
- 成效（示範資料庫的複本，示範資料庫本身沒有寫入）：
  - 評分重構：213 個產品新舊實作分數、信心值、breakdown 差異都是 0；PGlite 評分時間 878–1110 ms → 396–483 ms。
  - 產品照片：正確（廣告主自己的）23、錯圖（同類商品）17 個真實 + 1 個樣本、沒有照片 172。對複本執行 repair `--apply` + `npm run dedupe`（約 53 張 Shopify CDN 照片）→ 52 張成功、1 張失敗（超過 10 MB）、132 個沒有可用照片；之後**正確照片 74、錯圖 0**；合併 1 → 2（新的一組是同一款 4D 雷射面罩，看起來正確）。原本 1 組依錯圖做的合併（兩個姿勢矯正器）只回報、不還原。
  - 防重挑：示範資料庫還沒有嘗試紀錄，量不到；之後量法是每天看 `collection_attempts` 中各 provider 的 found / empty / error 數，以及每次 collect 挑到「從未嘗試」產品的比例。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（227）build ✅；e2e 未跑（沒動頁面、路由、proxy）。
- 限制：
  - `source_backoff`、`pipeline_stage` 尚未使用（M2）；`runIngestion` 每次呼叫仍建立新的 ingestion 紀錄（M2 處理重試共用）。
  - 照片 repair 尚未套用到示範資料庫（等使用者決定）。
  - 照片網址只檢查字面上的私有 IP，解析到私有 IP 的網域名稱擋不到。
  - 「兩個同時探索」的測試在同一個 PGlite 連線上跑，不能證明 Neon 上的真實競態。
- 下一步：M2 可續跑的 pipeline runner。

## 2026-10-10 — Vercel 探索 M2：可續跑的 pipeline runner（純邏輯 + CLI）

- 完成：
  - `src/pipeline/runner/`：整條 pipeline 拆成可續跑的工作單位（start → 每個 Meta 請求一個單位 → discover_finalize → 追蹤廣告主 → advertisers_finalize → collect 每單位 4 個產品 → stores 每單位 10 個 → hash 每單位 30、每次最多 100 → merge → match → score → finish）。狀態存在 `pipeline_runs`，每個單位開始前先寫入標記、做完立即存檔，被殺掉後下一個 tick 接著做。
  - Tick：單一條件式 UPDATE 取 lease、所有存檔都有 fencing（lease 被搶就立刻停）、軟預算 200 秒 / 硬中止 250 秒 / lease 320 秒（`PIPELINE_TICK_BUDGET_MS` 可改）；CLI 沒有時間預算，改用每 60 秒的 heartbeat 續約，避免大資料庫上 merge / match / score 超過 320 秒被誤判成 lease 被搶。
  - Meta 安全（ADR-006）：請求數與下次可請求時間**先寫入再送出**；Meta adapter 不再自動重試（重試是沒記帳的請求，429 依規則應停止退避）；被擋時先寫退避再暫存結果；重試單位若結果已暫存就直接用、不再問 Meta；每次送出前檢查本機 egress 的退避（CLI 接手別處規劃的 run 也不會送）；退避依 `(provider, egress)` 6→12→24 小時…最多 7 天，egress 分成 `vercel`、`github`、`local`。
  - 上限：每 run ≤70 個 Meta 請求（關鍵字 50 + 廣告主 20）；每個 UTC 日最多 3 次 Meta 掃描（以資料庫時鐘的 run 建立日計算）；同一天第 2、3 次掃描輪到各自的關鍵字視窗與廣告主視窗（不與隔天重複）；只記錄真的會搜尋的關鍵字；2 小時沒進度或 tick 快用完就收尾（已抓到的廣告先存，再 merge / match / score），20 小時或 40 個 tick 硬失敗；單位被中斷 3 次就跳過（跳過本身出錯也不會卡住 run）。
  - Shopify：401 / 403 / 429 或連續 3 個產品失敗就停止該步驟，不再對已拒絕的來源一直送。
  - CLI：`npm run pipeline` 改用 runner（新增 `--keyword="a,b"` 自訂關鍵字）；Neon 上接手進行中的 run；PGlite 上取代已死程序留下的 run，仍被持有（例如 dev server）就拒絕。舊 `runPipeline` 移除，3 個測試移植。
  - GitHub Actions：移除每日 `schedule`，只保留手動；輸入改經環境變數傳入（避免 shell injection）。DEPLOY.md、CLAUDE.md、`.env.example`（`PIPELINE_TICK_BUDGET_MS`）同步更新。
- 成效（示範資料庫的複本、`--keywords=1 --advertisers=1 --collect=2`、`PIPELINE_TICK_BUDGET_MS=20000` 強制分段；示範資料庫本身沒有寫入）：
  - run `succeeded`：22 個 tick（21 個各 1 單位、最後 1 個 2 單位）、56 秒、6 個 Meta 請求（關鍵字 5 + 廣告主 1），沒有被擋。
  - 產品 214 → 215（探索出來的 208 → 209）、Meta 廣告 698 → 703、Shopify 搜尋紀錄 3924 → 4067、評分批次 15 → 16（214 個產品）。
  - 照片：嘗試 100 張（27 成功、1 失敗、72 沒有可用照片），剛好在每次 100 張的上限（修正前最多可到 120）。
  - 結束後沒有殘留 `running` 的 ingestion 紀錄或暫存資料。
  - 發現既有問題：廣告主商品頁紀錄 77 → 73（被同 ID 的搜尋結果覆蓋，ADR-012 售價因此遺失），已列入 ROADMAP「資料品質 C」。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（262）build ✅；`db:generate` 無 schema 變更；e2e 未跑（沒動頁面、路由、proxy）。
- 限制：
  - 只在 PGlite 上測過；Neon HTTP driver 的行為未驗證（每個操作都是單一 SQL、不用 transaction）。
  - Vercel 上的分段執行、自我接續與 Meta 是否擋機房 IP 要到 M3 部署後才知道。
  - 一天最多 3 次掃描會讓「廣告動能」略偏高，之後要改成只用每日排程的觀測並量測。
  - 第一次掃描的關鍵字輪替順序因「每天 3 個視窗」而改變（只影響挑哪些關鍵字，不影響評分）。
  - **Vercel Cron 接上（M3）前沒有任何每日自動蒐集**，要手動跑。
- 下一步：M3 Vercel 觸發（routes、proxy、cron）。

## 2026-10-11 — Vercel 探索 M3：Vercel 觸發（routes、proxy、cron）

- 完成：
  - `POST /api/pipeline/start`：再檢查一次站點 cookie、要求同站 `Origin`（否則 403）；可帶 `{keywords}`（同 CLI 驗證，錯誤回 400）；已有進行中的 run 就回那一個（200、`created:false`，停住的會接著跑；帶了關鍵字會回 `ignoredOptions:true`，不會假裝用了）；Production 沒設 `SITE_PASSWORD` 一律拒絕；新 run 回 201，第一個 tick 在 `after()` 跑。
  - `GET /api/pipeline/status`：`no-store` 的進度 JSON（含 `configured`、`setup`、`disabled`、`cronConfigured`（只回布林）、`canStart`、`startBlockedReason`）；兼 watchdog，run 停住超過 45 秒就在 `after()` 接著跑。
  - `POST /api/internal/pipeline/tick`：Bearer token = 固定前綴 + `CRON_SECRET`（沒設時用 `DATABASE_URL`）的 sha256，常數時間比對；做完一段後只往白名單 origin（Production 的 `VERCEL_PROJECT_PRODUCTION_URL`、本機 loopback）POST 下一段，可重試的失敗重試一次，失敗原因記在 `last_kick_error`。
  - `GET /api/internal/cron/daily`（`vercel.json` 06–09 UTC 各一個）：需要 `Bearer $CRON_SECRET`；當天沒有成功的 cron run、也還沒掃過 Meta 才開新 run；其餘時間只接續停住的 run、把超過上限的 run 標失敗。
  - Proxy：`api/internal/` 不經 proxy；`/api/*` 不做語言改寫、未登入回 401 JSON。只在 Vercel Production 或本機執行（Preview 要 `PIPELINE_ALLOW_PREVIEW=1`），`PIPELINE_DISABLED=1` 全關（e2e 伺服器已設，且不再重用已在跑的伺服器）。
  - Review 修正：交棒只認 202，或 tick route 回的 `{accepted:false}`（其他 200 例如防火牆頁面不算成功）；run 結束時清掉過時的 `last_kick_error`；別的環境的 run 超過上限也會被標失敗（不會擋住當天的 cron）；cron 在 migration 前回 503 而不是 500；DEPLOY.md 改成「Fluid compute 必須開啟、不支援 60 秒模式」，移除調低到 30000 的錯誤建議；補 start 接續停住的 run、別的環境的 run、cron 過期後的決策、tick 停用 / 409 等測試。
- 成效（`next dev` + 示範資料庫的複本，`PIPELINE_TICK_BUDGET_MS=30000`，`POST /api/pipeline/start {"keywords":"posture corrector"}`，每 20 秒輪詢 status；示範資料庫 `.data/dev` 本身沒有寫入）：
  - run #1 `succeeded`：36 個 tick、35 次 HTTP 自我接續全部 202、接續錯誤 0、261.6 秒、15 個 Meta 請求（關鍵字 5 + 廣告主 10）、沒有被擋。
  - 產品 214 → 230（新增 16）、Meta 廣告 817 → 926（新增 109）、評分 229 個產品。230 與 229 的差距是 1 個早就被合併掉的產品（`merged_into` 有值、沒有自己的廣告），本來就不評分。
  - 各步驟：discover 149 則廣告 → 19 個產品（1 新）、advertisers 232 則 → 29 個（15 新）、collect 20 個產品 2057 筆、stores 3 筆、dedupe 22 張照片（1 張失敗、0 合併）、match 0。
  - 對同一份複本用 `next start` 開 `/products`：16 個新產品全部看得到（10 個在「最新」排序第一頁，6 個用搜尋找到），分數 29.4–43.3。
  - 失誤：run #1 結束後又送了一次 start，建立了 run #2（真的掃描），送出 4 個 Meta 請求後停掉伺服器；兩個 run 合計 19 個真實 Meta 請求，都在上限內，只寫入複本，run #2 留在複本裡 `running`。
  - 與計畫的差異：預算用 30000 而不是 60000；用 API 直接觸發而不是瀏覽器按鈕（按鈕在 M4）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（300）build ✅ e2e ✅（41）；dev / e2e log 沒有 `[WebServer]` 或 blocking-prerender 錯誤。
- 限制：
  - 預算 30000 時每個 tick 只做 1 個單位（Meta 單位上限 45 秒、collect 60 秒），小 run 就用了 40 次上限中的 36 次；預設 200000 才是支援的設定。
  - 未在 Vercel 上驗證：Meta 會不會擋 Vercel 機房 IP、自我 POST 會不會被 508 迴圈偵測切斷，要部署後才知道（已寫入 HUMAN_TODO）。
  - Route 沒有 `export const runtime`：Node.js 是預設，文件也建議不要寫。
  - start 只接受自訂關鍵字；廣告主數、collect 數用預設值。
  - 還沒有按鈕（M4）；部署前只能直接呼叫 API。
- 下一步：M4 介面殼層、探索頁（開始探索按鈕、進度）、移除樣本資料。

## 2026-10-11 — 資料品質 C：廣告主商品頁紀錄不再被搜尋結果覆蓋

- 原因：Shopify 搜尋（`shopify_catalog`）與廣告主商品頁查詢（`shopify_catalog_lookup`）都用 `source=shopify`、`externalId=${商品 id}|${國家}`，`source_items` 的 (source, external_id) 唯一索引讓搜尋結果直接覆蓋 lookup 那一筆（provider、售價、`advertised` 標記都被換掉）。
- 完成：
  - lookup 的 externalId 改成 `lookup|${商品 id}|${國家}`（`LOOKUP_ID_PREFIX`），搜尋維持原樣。讀 lookup 紀錄的地方（`OWN_LISTING_PROVIDER` 的評分、毛利、詳情頁、合併照片、repair）都用 provider 判斷、沒有解析 externalId，不受影響。
  - Migration `0010_lookup_external_ids`：既有 lookup 紀錄改名到新命名空間（新 id 已存在就不動、不刪任何資料），否則下次查回來會多一筆重複、舊的那筆仍會被搜尋覆蓋。
  - `npm run repair -- store-listings [--apply]`（預設只預覽）：產品的廣告連到某個商品頁（同網域 + 同 handle），那個商品頁在資料庫裡只剩搜尋紀錄、產品自己沒有該頁的 lookup 紀錄 → 視為被覆蓋，`--apply` 只清掉該產品的 lookup 嘗試紀錄，讓下一次 pipeline 重查；不改、不刪任何證據。
  - 測試：同一商品同一國家先 lookup 再搜尋，兩筆都在、lookup 售價與 `advertised` 保留；repair 預覽 / 套用（含部分遺失、跨網域同 handle、樣本產品、完好產品）。
- 成效（示範資料庫的複本；`.data/dev` 本身沒有寫入）：
  - 修正前：lookup 紀錄 77、有廣告主售價的產品 76（未合併的產品 213）。M2 量測時同樣跑一次 pipeline 是 77 → 73。
  - migration 後 77 筆全部改成 `lookup|` 前綴。repair 預覽：11 個產品符合（11 個完全沒有自己的商品頁紀錄、0 個還有其他新鮮的 lookup）；這份資料庫沒有任何 lookup 嘗試紀錄（嘗試紀錄是 M1 才加的），所以 `--apply` 清掉 0 筆——這 11 個本來就排得到。
  - `npm run pipeline -- --keywords=1 --advertisers=0 --collect=5`（5 個 Meta 請求、79 秒、沒被擋）：lookup 紀錄 77 → 77（不再減少）；這次搜尋有 6 筆的商品 id / 國家與既有 lookup 相同，修正前會覆蓋掉 6 筆，現在兩筆並存。有廣告主售價的產品 76 → 75：差的 1 個是 dedupe 把兩個 JOVS 面罩產品合併（兩邊各有一筆 lookup、合併後兩筆都在目標產品上），不是資料遺失。
  - stores 步驟這次查 5 個產品、0 筆結果（都記成 empty）；跑完後 repair 預覽變成 13 個（新的搜尋結果多對到 2 個）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（302）build ✅；e2e 未跑（沒動頁面、路由、proxy）。
- 限制：
  - repair 的規則也會抓到「搜尋碰巧找到廣告主商品、但從沒 lookup 過」的產品；對這些產品重查一樣是正確的下一步，但數字不全是被覆蓋的。
  - 已經有其他新鮮 lookup 紀錄的產品（部分遺失）清掉嘗試紀錄也不會馬上重查，要等那筆超過 7 天；預覽會分開列出（`stillFresh`）。
  - 被覆蓋前的歷史 snapshot 已經混進搜尋紀錄，無法拆回；只能靠重查補回目前售價。
  - 售價覆蓋率仍低（lookup 對多數商品頁回空結果），屬於下一個 ROADMAP 項目。
- 下一步：售價覆蓋率。

## 2026-10-11 — Vercel 探索 M4：介面殼層、探索頁、移除樣本資料

- 完成：
  - 導覽：只有一個 `<nav>`，四項是產品／廣告／收藏／探索（lucide 圖示 + 文字）。桌機放在精簡的 sticky header 內；手機是固定在底部的分頁列（safe-area 內距、作用中的分頁上緣有指示線），body 在手機版留出底部空間。語言、主題改成小圖示按鈕，DOM 放在 nav 前面，手機的 Tab 順序是 header 按鈕 → 分頁列 → 內容；桌機用 `md:order-last` 排到 nav 後面。
  - `/discover`：「開始探索」按鈕，自訂關鍵字收合在 `<details>` 裡（最多 10 個，半形逗號、全形逗號、頓號、換行都能分隔，前後端用同一個 `KEYWORD_SEPARATOR`）。
    - 輪詢：只在有進行中的 run 時輪詢，用 setTimeout 串接（請求不重疊）；分頁在背景時暫停，回到前景立刻補一次；失敗時退避 5→10→20→40→60 秒；遇到 401 就停止並提供「重新登入」連結。run 結束時 `router.refresh()`，顯示「新增 N 個產品 → 查看新產品」。
    - 白話步驟清單附 done/total。原始錯誤會分類成「被擋／請求太多／逾時／網路／對方服務問題／其他」顯示成中文句子，原文收在「技術細節」裡。
    - 誠實提示：Meta 擋下伺服器、今日 3 次已用完、無法開始的原因、每日自動未啟用（只在可以開始時顯示）。另有最近 10 次執行紀錄、資料來源健康度卡片、「運作方式」。`/sources` 以 308 永久轉到 `/discover`。
  - 共用 `StartDiscoveryCard`：放在產品、廣告、首頁的空狀態；有進行中的 run 時顯示進度連結。所有 `npm run`、`.env.local` 的文字都改成給站長看的白話。
  - 移除樣本資料：拿掉 `?sample=1`、切換連結、樣本標籤與徽章、noScored 分支、`npm run seed` 與 `src/jobs/seed.ts`。fixture 產品不出現在排名、詳情頁（回 404，`<title>` 也不露出名稱）、收藏。資料層的 `includeSample` 只給測試用。
  - 共用元件：`Notice`/`EmptyState`、`ScoreBadge`（70 以上綠、50–69 琥珀）、`ProductThumb`、`Pagination`、`FilterDisclosure`（面板底部也有「套用」）+ 可移除的篩選 chips、skeleton；共用 `fieldClass`、`formatUsd`/`formatUtc`。首頁讀取失敗會顯示「暫時無法讀取資料」，不會被當成空狀態。產品表格的排序欄標頭和產品連結不在進入畫面時預先抓取（`prefetch={false}`），每次預先抓取都會在伺服器跑一次查詢。
  - 修正 `getDb`：連線改存在 `globalThis`（`{ url, connection }`，URL 改變就重建，失敗就清掉快取）。原本頁面和 route handler 各有一份模組，用 PGlite 時同一個目錄會變成兩個互不相通的資料庫，探索頁要重啟才看得到 tick 寫入的資料（已寫入 CLAUDE.md 已知陷阱）。
- 成效（瀏覽器實測，`next dev` + 示範資料庫的複本，`.data/dev` 本身沒有寫入）：
  - 按鈕第 1 次（關鍵字 posture corrector，英文介面）：約 4 分鐘完成，新增 16 個產品、新廣告 108 則、檢查 381 則廣告、評分 229 個產品；沒被擋，Shopify Catalog 有 1/20 個產品回 Service error。進度即時更新；執行紀錄這次沒有即時更新，查出就是上面 `getDb` 的問題。
  - 第 2 次（pet hair remover，中文介面，修正 `getDb` 後用 API 觸發）：約 5 分鐘，新增 23 個產品、新廣告 63 則、評分 251 個；結束後執行紀錄與來源健康度都正確。兩次合計 30 個 Meta 請求，都在上限內。
  - 空資料庫：產品、廣告、首頁顯示開始探索卡片；375×812 與桌機、中英文、淺深色都看過，沒有橫向捲動。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（335）build ✅ e2e ✅（43，最後一次全過；`[WebServer]` 沒有錯誤）。
- 限制：
  - e2e 在預設 4 個 worker 下偶發：點連結後的動態頁 5 秒內仍停在 Suspense 載入畫面（伺服器單獨量測時產品頁約 0.1 秒、詳情頁約 0.05 秒；2 個 worker 或單獨跑都全過）。原因還沒查清楚，寫進 ROADMAP。
  - 瀏覽器窗格的分頁開著本機 3000 port 時會干擾 e2e，跑 e2e 前要關掉。
  - dev 偶發：探索結束後背景分頁曾出現 HMR 整頁重新載入的迴圈；期間沒有任何 status 請求，所以不是輪詢造成的，原因未明，只發生在 dev。
  - 產品表格與首頁、詳情、收藏的版面改版留給 M5、M6。
- 下一步：M5 產品列表、首頁儀表板、排名效能。

## 2026-10-11 — Vercel 探索 M5：產品列表、首頁儀表板、排名效能

- 完成：
  - `getRankedProducts` 只讀最新一次評分批次（`computed_at = max(computed_at)`，走 `product_scores_rank_idx`），不再對整個評分歷史做 `DISTINCT ON`。`runScoring` 每次都用一個 INSERT、同一個 `computed_at` 評分所有有證據的產品，所以兩者等價；唯一差別是「最新批次裡沒有的產品」（證據全部被合併走）不再用過期分數出現，另外也排除 `merged_into` 有值的產品。樣本（fixture）產品改在 SQL 排除；分數 + 產品資料合成一個 JOIN，證據、售價、匯率查詢同時送出；篩選仍在記憶體（資料庫端篩選仍是 Phase 6）。`limit` 預設改成全部，由頁面分頁。
  - 分頁：每頁 30 筆（`src/lib/pagination.ts`），顯示真實總數「208 個產品，顯示第 31–60 個」（原本永遠只拿 50 筆，數字會誤導）。`page` 參數保留在網址；換排序、篩選、移除 chip 一律回到第 1 頁（`rankingHref(filters, page)`，page 不屬於篩選條件）。
  - `/products`：桌機（≥lg）精簡表格——縮圖、產品名 + 「N 天前首次發現」、分數（含可信度）、7 個子分數窄欄（縮寫標頭、可點擊排序、`aria-sort`）、售價、市場（前 3 個 + 「+N」）、廣告主數；拿掉排名 # 與證據來源欄。手機 / 平板：卡片——縮圖、名稱（兩行截斷）、大分數 + 可信度、售價 · 廣告主 · 首次發現、市場 chips、7 格子分數（縮寫、數值或「—」）、收藏星號（既有 `setWatched`，`getWatchedIds` 一次查完整頁）。375px 沒有橫向捲動。
  - 首頁改成儀表板：H1、一句說明、「查看熱賣產品」按鈕 → 資料狀態列（上次更新時間、已排名產品數、探索進行中的進度連結或「探索新產品」）→ 收藏分數變動提醒（有才顯示）→ 前 6 名產品卡片 → 「查看全部 N 個產品」。移除行銷區塊（特色、運作方式、資料來源；`/discover` 已有運作方式）與 `Landing` 元件。沒有產品時顯示原本的開始探索卡片。
  - 收藏提醒抽成共用的 `WatchAlerts`（收藏頁與首頁共用）。
  - 產品連結與排序標頭拿掉 `prefetch={false}`（見下方 e2e 調查）。
- 成效（示範資料庫的複本；`.data/dev` 本身沒有寫入）：
  - 目前的示範資料庫（1,137 筆評分、15 個批次）：`getRankedProducts` 中位數 33 → 31.5 ms（預設排序，各 3 個程序 × 9 次）。差很少，因為歷史還短；主要成本在證據彙整（unnest 國家，約 14 ms）與 breakdown JSON 解碼。
  - 模擬 90 天、每天 3 次的歷史（複本再加 270 個舊批次，共 58,647 筆評分）：中位數 92–96 → 33 ms，舊寫法隨歷史線性變慢、新寫法不受影響。
  - 兩種資料量下，新舊寫法排出的 208 個產品（id 與分數、順序）完全相同；另有單元測試用三個批次比對與舊 `DISTINCT ON` 寫法一致。
- e2e 偶發（M4 留下的問題）查明：
  - 預設 worker 數是 CPU 核心數的一半（這台是 10 個，不是 4 個）。10 個 worker 時每次都是同一組 3–6 個「點連結後等內容」的測試失敗；4 個 worker 連續 5 次全過。總耗時 10 個 32–59 秒、4 個 45–48 秒：多開 worker 並沒有更快，瓶頸在伺服器。
  - 證據：Playwright trace 顯示失敗時 `/products` 文件 74 ms 就收到開頭，但串流到結束要 3.2–7.1 秒；導覽的 RSC 請求有的到測試結束都沒有回應。PGlite 查詢記錄同一段時間最多 9 個查詢排隊、最久等 0.47 秒，而且有 4 秒完全沒有查詢——不是資料庫鎖住。伺服器單一請求很快（`/products` 約 95–120 ms CPU、詳情頁約 33 ms、預先抓取約 4 ms），`robots.txt` 探測最慢 0.7 秒（事件迴圈沒有卡死）。
  - 結論：所有 worker 共用一個 `next start` 程序，PGlite（WASM）與 SSR 在同一條執行緒；10 個瀏覽器同時載入時這條執行緒飽和，每個串流都被拉長到數秒，瀏覽器對同一主機最多 6 條連線又被這些慢串流與預先抓取佔住，點擊後的請求就排在後面，畫面停在載入骨架超過 5 秒。這是測試環境特有的：正式環境用 Neon（網路 I/O）且每個 Vercel function 有自己的 CPU。處理：`playwright.config.ts` 固定 `workers: 4` 並寫明原因；CLAUDE.md 已知陷阱加一條。
  - `prefetch={false}` 不再需要：`partialPrefetching` 開啟後，預先抓取只拿靜態 App Shell（每個連結一個約 4 ms 的 `_tree` 請求，動態頁的頁面殼層所有產品共用一份），不會跑排名查詢。拿掉後點產品約 46 ms 就切到載入畫面（原本要等伺服器回應）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（354）build ✅ e2e ✅（45，4 個 worker 連續 2 次全過，`[WebServer]` 沒有錯誤）。瀏覽器實測（`next dev` + 複本、`PIPELINE_DISABLED=1`）：`/products` 與首頁在 375×812 與 1280 寬、中英文、淺深色都看過；375px 沒有橫向捲動；收藏星號按下 / 取消都正確；第 2 頁 + 依持久度排序正確；dev log 與 console 沒有錯誤。
- 限制：
  - 每次請求仍要把所有產品讀進記憶體再篩選、分頁（208 個約 30 ms）；上千個產品時要改成資料庫端篩選（Phase 6）。
  - 表格與卡片都在 HTML 裡，用 CSS 切換，`/products` 的渲染量約多一倍（伺服器約多 60 ms）。
  - 「首次發現」是我們第一次找到產品的時間，不是產品在市場上出現的時間。
  - 子分數縮寫（Longev. / Mom. / 持久 / 動能）要滑鼠移上去才看到全名；手機版沒有 tooltip。
- 下一步：M6 詳情頁、廣告、收藏。

## 2026-10-11 — Vercel 探索 M6：詳情頁、廣告、收藏

- 完成：
  - 詳情頁 `/products/[slug]` 改版：
    - 頂部摘要卡：產品圖、名稱、首次發現日期、大分數 + 可信度 + 更新日期、分數走勢、收藏按鈕；兩個查證連結——「廣告主商品頁」（`getProductDetail` 回傳 `canonicalUrl`）與「Meta Ad Library 中投放最久的廣告」（投放中的 Meta 廣告裡開始最早的一則，附已投放天數）。外部連結一律 `target=_blank` + `rel="noopener noreferrer"`，並有螢幕閱讀器的「（在新分頁開啟）」。
    - 重點數字：投放中的廣告（N 則，共 M 則）、投放中的廣告主（依 advertiserId，與評分相同）、投放最久的廣告天數、廣告主售價（美國）、廣告連到的網域、市場。沒有資料一律顯示「—」，不推估。
    - 網域提示（Phase 4C 項目）：從廣告的 landing URL 取網域；超過 1 個時顯示警示「這個產品的廣告來自 N 個不同網域」並列出網域，說明同一個商品代號也可能把不同產品併在一起；每則廣告也標出它連到的網域，方便逐一查證。
    - 「分數怎麼來的」改成直條列：標籤、權重、長條（沒有資料時是虛線框）、數值或「—」（螢幕閱讀器讀「沒有資料」），計算方式收在 `<details>`；手機不再需要橫向捲動。
    - 證據分區改成 `<details>`，摘要列含數量、標題仍是 h3（瀏覽器的無障礙樹看得到）：廣告與廣告主商店預設展開，同類商品、搜尋需求、供應商報價預設收合。廣告依投放天數排序，先顯示 5 則，其餘放在「顯示全部 N 則」（原生 `<details>`，不需要 JavaScript；原本只顯示前 20 則，現在全部可看）。每則廣告有天數徽章與投放中 / 已停止標籤。
    - 所有外部連結先經過 `externalHref`：只允許 http(s)，資料來源若存了 `javascript:` 之類的網址不會變成連結。
  - 資料層：`getProductDetail` 的評分、證據、snapshot（改用子查詢，不必等證據查完）、匯率四個查詢同時送出；snapshot 用 Map 分組（原本每個證據都 filter 全部 snapshot，平方時間）；證據改成只選需要的欄位，不再載入大型 `raw`，只取 `raw->>'landing_url'`。`getAds` 同樣改成明確欄位 + landing URL。
  - `/ads`：卡片（手機 1 欄、桌機 2 欄），廣告主名稱 + 天數徽章 + 狀態標籤、廣告文字、平台 · 國家 · 格式 · 開始日期 · 連到的網域、查看廣告與產品連結；工具列、篩選面板、分頁沿用 M4。
  - `/watchlist`：提醒置頂；清單改成同一份標記的響應式卡片（手機數字換到名稱下方，桌機一列），不再有橫向捲動；分數、與上次更新相比、與加入時相比都有可見標籤，取消收藏照常運作。
  - `/products`：列表下方新增「子分數縮寫說明」`<details>`，列出 7 個縮寫的全名與計算方式（手機看不到 tooltip）。
- 成效（示範資料庫的複本；`.data/dev` 本身沒有寫入）：
  - 詳情頁資料查詢 `getProductDetail`：10 個產品（證據最多的 5 個：224、139、128、123、122 筆，加 5 個一般產品）× 9 次，3 個程序。中位數 16.1–16.8 → 10.4–10.6 ms；證據最多的 5 個 22.3–22.6 → 12.5–13.3 ms。改動前後 7 個可顯示產品的分數、歷史、每筆證據的 metrics / series 完全相同（另外 3 個是樣本或已合併）。
  - 網域：208 個有廣告的產品中，197 個只連到 1 個網域、9 個 2 個、1 個 3 個、1 個 4 個（vkthr：4 家不同店），共 11 個會顯示警示；此前這些混在一起的情況在頁面上看不出來。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（369）build ✅ e2e ✅（47，4 個 worker、示範資料庫複本，連續 2 次全過，`[WebServer]` 沒有錯誤）。新增 e2e：詳情頁廣告先 5 則、按「顯示全部」後展開；詳情頁在 375px 沒有橫向捲動；收藏 e2e 改用清單卡片。瀏覽器實測（`next dev` + 複本、`PIPELINE_DISABLED=1`）：詳情頁、`/ads`、`/watchlist` 在 375×812 與 1280 寬、中英文、淺深色都看過；375px 沒有橫向捲動；展開全部廣告、收藏 / 取消收藏、子分數說明都正常；dev log 與 console 沒有錯誤。
- 限制：
  - 網域數只能提示，不能判定：同一商品代號在不同店家多半是同一個供應商商品，但也可能不是；要靠照片比對 v2 才能更客觀。
  - 「市場」沿用排名頁的算法（所有證據的國家，含同類商品搜尋結果的國家），可能比實際投放市場多；已寫進 ROADMAP。
  - 廣告依投放天數排序，沒有開始日期的排最後；展開全部時一次渲染所有廣告（示範資料庫中單一產品最多 39 則）。
  - 收藏的取消按鈕名稱仍是「★ 已收藏」，清單中多個按鈕同名（螢幕閱讀器要靠所在卡片判斷是哪個產品）。
- 下一步：M7 文件收尾。

## 2026-10-11 — Vercel 探索 M7：文件收尾與整體 review（Vercel 網頁觸發探索 + UI/UX 改版完成）

- 整體成果（M1–M7 + 資料品質 C，`727fe2c..HEAD`）：
  - 在網站「探索」頁按「開始探索」就會在 Vercel 上分段執行完整 pipeline（每段約 200 秒、自動接續、頁面即時顯示進度），Vercel Cron 每天自動跑一次（06 UTC，07–09 UTC 負責恢復）；CLI 與 GitHub Actions（手動）共用同一個 runner。
  - ADR-006 規則全部保留並強化：Meta 請求先記帳再送出、間隔 5 秒跨 tick 成立、每 run ≤70、每 UTC 日 ≤3 次掃描、被擋依出口（vercel / github / local）退避 6 小時起最多 7 天、不重試不繞過。
  - 網站不再顯示樣本資料；全站改版（單一導覽、手機底部分頁列、產品表格 / 卡片、首頁儀表板、詳情頁摘要卡、廣告卡片、收藏響應式清單）。
- 重點數字（都在示範資料庫的複本上量測，`.data/dev` 本身沒有寫入）：
  - 評分重構：213 個產品新舊分數差 0；PGlite 評分 878–1110 → 396–483 ms。
  - 產品照片只用廣告主自己的：錯圖 17 → 0、正確照片 23 → 74（repair 套用在複本上）。
  - 本機分段執行：M2 CLI 22 個 tick、56 秒、6 個 Meta 請求；M3 HTTP 自我接續 36 個 tick、35 次接續全部 202、15 個 Meta 請求、產品 214 → 230；M4 網頁按鈕兩次各新增 16、23 個產品，沒有被擋。
  - 資料品質 C：廣告主商品頁紀錄同樣跑一次 pipeline 77 → 73（修正前）→ 77 → 77（修正後）。
  - 排名查詢：58,647 筆評分歷史時中位數 92–96 → 33 ms；目前資料量 33 → 31.5 ms；排序結果完全相同。
  - 詳情頁查詢中位數 16.1–16.8 → 10.4–10.6 ms；208 個有廣告的產品中 11 個連到超過 1 個網域，現在會顯示警示。
- M7 本輪：
  - 整體 review（安全、ADR-006、樣本資料、milestone 之間的回歸、殘留程式與文件）：proxy 只排除 `/api/internal/`、內部 route 缺 secret 回 503（fail closed）、tick token 只送往 Production 網域或 loopback、start 檢查 cookie + 同站 `Origin`、正式站沒密碼不能開始；client props 只有布林（`cronConfigured`），不含 secret；照片下載只允許 https、擋私有網段、每次轉址重新檢查；外部連結都經 `externalHref` 且 `noopener noreferrer`；頁面沒有任何 `includeSample` / `sample` 用法；route 沒有 import `src/jobs/*`；字典鍵沒有未使用的；沒有找到需要修的程式問題。
  - 修正文件與設定：`.env.example` 補 `SHOPIFY_UCP_AGENT_PROFILE`、移除已不用的 AliExpress 金鑰、`CRON_SECRET` 長度說明；README 的排程描述（原本寫 GitHub Actions）；DEPLOY.md 改寫成端到端步驟（含探索頁每個狀態與提示的意思、Meta 擋 Vercel 時用 Production 的 Neon 連線字串在本機跑）；HUMAN_TODO 改成 6 個編號步驟並移除過時的 GitHub 每日排程說明、修正「歷史已分岔」的錯誤說法（本機紀錄 `origin/main` 停在資料品質 C，一般 push 即可）；ADR-013 補上最終行為、決策一覽表、ADR-004/006/007 的交叉註記；CLAUDE.md 技術棧排程、資料蒐集規則、4 條已知陷阱；ROADMAP 勾選 M7 並加入後續項目。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（61 檔 369 個）build ✅ e2e ✅（47，4 個 worker、示範資料庫複本，`[WebServer]` 沒有錯誤）；`drizzle-kit check` 與 `db:generate` 沒有待產生的 schema 變更。
- 仍未驗證（要部署後才知道，已寫進 HUMAN_TODO 第 1 項）：
  - Meta 會不會擋 Vercel（AWS 機房 IP）；本機住宅 IP 沒被擋不代表 Vercel 也不會。Shopify Global Catalog 從 Vercel 的表現也未驗證。
  - Vercel 自我請求的 508 迴圈偵測門檻未公開；以看門狗與 4 個 cron 緩解，實際是否觸發未知。
  - Neon HTTP driver 下的 lease、fencing 與並行建立產品只在 PGlite 上測過（每個操作都是單一 SQL，理論上安全）。
  - Hobby 的 cron 在該小時內任何時間觸發，用量是否真的在免費額度內要看 Vercel Usage。
- 其他限制：Meta 請求間隔固定 5 秒（CLAUDE.md 寫隨機間隔，已列 ROADMAP）；照片下載擋不到 DNS 解析到私有 IP 的網域；一天最多 3 次掃描會讓廣告動能偏高；「市場」含同類商品的國家；廣告 `countries` 只留最後一國、`groupAdsByLanding` 跨國重複計數（都已列 ROADMAP）。
- 下一步：使用者部署並按一次「開始探索」回報結果；loop 回到 Phase 4C（售價覆蓋率）。

## 2026-10-11 — Meta 回應診斷（Vercel 上「被擋」原因不明）＋ 官方 Ad Library API adapter

- 背景：部署後在 Vercel 按「開始探索」，探索頁顯示「Meta 擋下了這台伺服器」（退避到 08:56 UTC）。舊程式只要頁面沒有 `search_results_connection` 就當成被擋，「登入頁」判斷是「前 5000 字含 login / checkpoint」，所以不知道 Meta 實際回了什麼。
- 做了什麼：
  - 新增 `src/ingestion/sources/meta-ad-library-failure.ts`：回應診斷（HTTP 狀態、轉址後最終網址只留 origin + path、是否轉址、位元組數、`<title>` ≤120 字、標記 captcha / login_form / login_title / login_url / checkpoint_url / results_json / ad_library_app），不存 HTML、cookie、查詢字串。分類 `captcha`、`login_wall`、`http_403`、`http_429`（被擋）與 `results_not_embedded`、`parse_error`（不算被擋）。
  - 網站 adapter 用 `res.url` / `res.redirected` / `res.status`；`fetchWithRetry` 新增 `acceptStatus`，403 / 429 頁面交給診斷（不重試）。
  - runner：被擋照舊依出口退避；`results_not_embedded` / `parse_error` 不退避，但寫入 `adLibrary.stopped`，這次執行不再送 Meta 請求（追蹤廣告主步驟跳過，`meta_unusable`）。理由：不一定是封鎖，誤判會把「做不到」說成「被擋」並擋掉 6 小時；每日 3 次掃描 × 每次第 1 個請求就停，影響受控。
  - 探索頁：退避提示加「發生了什麼：」白話說明（中英文：Meta 要求登入 / 驗證碼 / HTTP 403 / 429 / 頁面沒有內嵌廣告資料 / 讀不出來）＋「技術細節」原文；步驟錯誤同樣依分類說明；舊格式的訊息也能辨識。
  - 官方 API：查官方文件（Graph API v26.0；商業廣告只限「過去 1 年在 UK 或 EU 投放」；欄位清單見 research）。`meta-ads.ts` 新增 `createMetaAdsApiAdapter`（provider `ad_library_api`、只查 UK + EU 國家、關鍵字或粉專、游標分頁、請求上限、Graph 錯誤碼 190 / 613、錯誤訊息不含 token 與網址），`parseMetaAd` 不再保存含 access token 的 `ad_snapshot_url`。**沒有接進 runner**：官方 API 沒有 landing page 與創意變體數，而且同一則廣告（同 id）會覆蓋網站版的紀錄、弄掉 `landing_url`；正確做法是「補強觸及人數」，已寫進 ROADMAP（需要 token）。
- 成效（真實資料）：本機住宅 IP 3 個真實請求（US、GB、AU，間隔 ≥6 秒，誠實 UA）都正常：HTTP 200、無轉址、約 655 KB、title「Ad Library」、有 results_json 與 ad_library_app、無 captcha / 登入標記；新解析器在 AU「neck fan」解析出 30 則廣告，沒有誤判。正常頁面全文有 11 個 `login`、2 個 `checkpoint`，證實舊的字串判斷可能誤判。Vercel 上的實際分類要等下一次執行（HUMAN_TODO 第 1 節第 7 項）。探索、比對、評分的數字不受影響（只改失敗時的分類與記錄）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（63 檔 387 個；新增診斷 12、官方 API 4、runner 1、UI 2 個測試）build ✅ e2e ✅（47，示範資料庫複本）。瀏覽器實測（`next start` + 插入一筆 login_wall 退避的複本）：中英文提示與技術細節正確、375px 無橫向捲動、server log 無錯誤。
- 踩到的坑：在 Git Bash 用 `DATABASE_URL=pglite:/c/Users/...` 會被 Node 當成 `C:\c\Users\...`，開出空資料庫，e2e 出現 2 個假失敗（「No products yet」strict mode）；要用 `pglite:C:/Users/...`。
- 限制：診斷只能看到 Meta 回給我們的頁面，不能證明原因；`login_title` 依英文標題判斷；`total_reach_by_location` 的 JSON 形狀（`{key, value}`）與 UK 鍵名要拿到 token 後實測。
- 下一步：使用者 push 後在 Vercel 再跑一次並貼上「技術細節」；loop 回到 Phase 4C。

## 2026-10-11 — CJ 官方 API 探索（ADR-014）：Meta 被擋時也能找到有真實訂單的產品

- 背景：Vercel 上 Meta Ad Library 網站回 HTTP 403，正式站沒有產品；依 ADR-006 不繞過。使用者決定加入 CJ 探索並提供 `CJ_API_KEY`。
- 研究（`docs/research/cj-api.md`）：官方文件＋少量真實請求。實測與文件不同處：詳情的 90 天銷量 `soldOut` 在 137 個詳情中**全部是 null**，有值的是 `orderCount`（CJ 未公開期間，看起來是近期窗口）、`totalQuantity`、`latestPaymentDate`；詳情欄位全小寫、0 點；`listV2` 50 點、`createAt` 是 null；trending 的 `timeStart` 篩的不是商品建立時間。token 24 小時內重取會回同一組，有效約 180 天。
- 做了什麼：
  - `src/ingestion/sources/cj.ts`：依實測修正型別；`createCjClient`（token 從 `api_tokens` 取用、到期前 7 天才重取、被拒就清除；一次只打一次不重試；錯誤分成 auth / points / rate_limited / service / other；錯誤訊息遮蔽金鑰與 token）。`cj-failure.ts` 給探索頁解釋錯誤。
  - 新表 `api_tokens`（migration 0011，純新增）；token 以 `CJ_API_KEY` 衍生的金鑰 AES-256-GCM 加密（`src/lib/token-crypto.ts`）。
  - Runner 新步驟「搜尋 CJ 熱銷商品」（`cj` → `cj_details` → `cj_finalize`，`src/pipeline/runner/cj-units.ts`）：Meta 之後、collect 之前，不受 Meta 退避影響；每 run 最多 11 次列表＋40 次詳情、間隔 1.1 秒、先記帳再送出；點數用完／限流 → 停止並對出口退避；金鑰被拒 → 停止不退避；沒有金鑰 → 「未設定」跳過。舊版存的 run 狀態用 `upgradeState` 補上欄位，可以續跑。
  - 產品：`products.landing_key = cj:<pid>`；門檻 `CJ_RULES`（上架數 ≥ 50 才查詳情；訂單數 ≥ 50 且最近付款 ≤ 30 天才建立）；`first_seen_at` 用 CJ 的上架時間；證據 `source=cj`、`provider=cj_api`、metrics `stores_listed` / `orders_total` / `units_total`（`units_sold_90d` 只在 CJ 真的回傳時）。與既有產品只靠既有的照片 dHash 規則合併。
  - 評分 v1.2：市集訂單子分數沒有 90 天銷量時用 CJ 訂單數（說明標示「CJ 平台計數；未公開期間」）；只量到一個子分數的產品最高 50 分（`thin_evidence`），詳情頁顯示上限原因。
  - 介面：來源標籤「CJ（供應商銷量）」；詳情頁 CJ 訂單數、上架數與「CJ 平台計數」說明、「CJ 商品頁」連結（原本會誤標成「廣告主商品頁」）；探索頁新步驟、CJ 的跳過原因與錯誤說明；Meta 被擋／今日已用完的提示改為「沒有 Meta 也會繼續從 CJ 探索」（沒設金鑰時說明加金鑰能換到什麼），移除「在自己的電腦上執行」。DEPLOY.md 第 4、7、8 節、HUMAN_TODO 第 0 節、CLAUDE.md 已知陷阱同步更新。
- 成效（示範資料庫複本、模擬 Meta 對 `local` 出口退避、真實 CJ 請求；`.data/dev` 未寫入）：
  - 改動前：213 個產品、0 個 CJ 產品；有「市集訂單」子分數的 5 個（都是 fixture 樣本資料）；有毛利的 0 個。
  - 改動後（採用的挑選方式 C）：CJ 51 次請求、550 點（帳號每日 50,000 點）、列表 250 個商品 → 查 40 個詳情 → **19 個新產品**（訂單數 77–7,422、最近付款 3–28 天前）；產品 213 → 232；有市集訂單子分數 5 → 24；跟既有 Meta 產品合併 0 個；有毛利 0 → 0（CJ 產品沒有廣告主售價，Meta 產品沒有對上 CJ 照片）。
  - CJ 產品分數分布：0–9 分 4、10–19 分 3、20–29 分 3、30–39 分 3、40–49 分 3、50 分 3（受上限）；可信度全部「低」；前 15 名沒有只有 CJ 證據的產品。沒有上限時（第一次量測）只有 CJ 證據的產品 69.6 分排第 1、可信度 0.05 → 加了 50 分上限。
  - 挑選方式比較：A（合併後取上架數前 40）13 個、B（近期 trending＋最佳比對）3 個、C 19 個，細節見 research 第五節。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（67 檔 403 個；新增 CJ client 4、token 加密 1、CJ 規則 2、runner 5、live deps 1、評分 1、證據 1、摘要 1）build ✅ e2e ✅（47，4 個 worker、示範資料庫複本，`[WebServer]` 沒有錯誤）。瀏覽器（`next start` + 複本 + `PIPELINE_DISABLED=1`）：排名頁 CJ 篩選 19 個、詳情頁中英文、375px 無橫向捲動、探索頁 Meta 被擋提示與 CJ 步驟。自查 diff 與錄下的回應沒有金鑰、token、帳號資訊。
- 限制：CJ 訂單數只算經由 CJ 下的單、期間未公開，不是整個市場；`listedNum` 是累計上架數（偏向老商品）；只有 CJ 證據的產品沒有廣告類子分數、最高 50 分；CJ 商品頁有反爬驗證頁，連結格式無法自動驗證；CJ 產品在 Shopify collect 排在最後（還沒分數）；CJ ToS 尚未確認（個人研究使用）。
- 需要使用者：push、在 Vercel Production 加 `CJ_API_KEY` 並 Redeploy，然後按一次「開始探索」回報（HUMAN_TODO 第 0 節）。
- 下一步：CJ 產品的 collect 排序、CJ 運費試算（到岸毛利）、Meta 官方 Ad Library API（需要 token）。

## 2026-10-11 — Meta 官方 Ad Library API 探索（英國／歐盟，ADR-015）

- 背景：Meta 網站擋了 Vercel（HTTP 403），不繞過。使用者要求 Meta 資料優先、用盡合規方法 → 官方 Ad Library API（Graph API v26.0 `/ads_archive`）：Vercel 可用、免費、第一手，但只有英國＋歐盟。**還沒有 `META_ACCESS_TOKEN`**：全部依官方文件格式做 fixture 測試，沒有任何真實請求。
- 研究（`docs/research/meta-ad-library-api.md`）：對照 ads_archive、ArchivedAd、Ad Library API、Graph API 速率限制文件。使用的欄位：`id`（Library ID）、`page_id`／`page_name`、`ad_creation_time`、`ad_delivery_start_time`／`stop_time`、`ad_creative_bodies`、`ad_creative_link_titles`／`_captions`／`_descriptions`、`publisher_platforms`、`languages`、`eu_total_reach`、`total_reach_by_location`（文件鍵名 `UK`）。不再請求 `ad_snapshot_url`（網址含 token）。Ad Library API 沒有公開速率數字；user token 的上限也不公開。
- 做了什麼：
  - `meta-ads.ts`：`createMetaApiClient`（一次一個請求、不重試、錯誤分成 token／rate_limited／request／service、訊息不含 token 與網址）；`externalId = api|<id>`；一次查多國時只有 UK 觸及 > 0 才標 `GB`；UK 觸及只接受文件的 `{key:"UK", value}` 形狀。`meta-api-failure.ts` 給探索頁解釋錯誤。
  - `src/discovery/meta-api.ts`：網域（`link_caption`）＋正規化標題（`link_title`）分組，鍵 `meta-api:<網域>|<標題>`；門檻沿用 `DISCOVERY_RULES`；掛到網站版產品：同一 Library ID 優先 → 同店家＋同 handle → 同店家＋標題 Jaccard ≥ 0.6 且唯一；多個候選一樣像就略過、也不另建。
  - Runner 新步驟「搜尋 Meta 官方 API（英國／歐盟）」（`meta_api` → `meta_api_finalize`，網站版之後、CJ 之前，不受網站版退避或每日上限影響）：每 run ≤ 10 次、間隔 2 秒、先記帳再送出、回應暫存（重試不重送）；190 停止不退避、613 等限流停止並退避（provider `ad_library_api`）、其他 4xx 停止、5xx 繼續；沒有 token → 「未設定」跳過；舊狀態用 `upgradeState` 補欄位。
  - 去重：評分 `dedupeAds`（來源＋Library ID，網站版為主、API 補國家與觸及）、廣告動能 SQL、詳情頁廣告數與列表（`dedupeAdRecords`）、廣告頁（API 紀錄有網站版雙胞胎就不列）。觸及人數只顯示不計分。
  - 介面：來源標示「Meta 官方 API（英國／歐盟）」、詳情頁「歐盟觸及／英國觸及」或「歐盟／英國觸及 —」與說明、同一則廣告兩筆合併成一列（「Meta Ad Library + Meta 官方 API（英國／歐盟）」）；探索頁新步驟、跳過原因、錯誤說明；網站被擋／今日已用完提示加上「官方 API（英國／歐盟）照常」或「未設定 META_ACCESS_TOKEN，加了能換到什麼」；網站版步驟改名「搜尋 Meta 廣告（Ad Library 網站）」。
- 成效（示範資料庫複本兩份，模擬網站被擋，關鍵字 3 個；API 回應是依文件格式做的 fixture：5 個網站版產品的 9 則廣告用真實 Library ID 當雙胞胎、3 則同店家同標題的新廣告、5 則虛構英國／德國／法國店家的廣告）：
  - 3 次請求、14 則廣告（13 則有網域＋產品標題）→ 10 組：**7 組掛到網站版既有產品**（5 組靠同一 Library ID、2 組靠同店家＋標題）、**2 個新產品**（各 2 則廣告）、1 組單則 3 天的廣告不達門檻；12 則廣告存成 `api|` 紀錄，網站版紀錄完全沒動。
  - 第一次量測發現：同一家店（jovs.com）有「4d Laser Light Therapy Mask」與「Jovs 4d Laser Light Therapy Mask Fda Certification」兩個網站版產品，標題比對兩個都過門檻 → 原本判為不確定並**另建一個重複產品**。改成 handle 相同優先、仍不確定就略過不建：掛上 6 → 7、新產品 3 → 2、重複產品 1 → 0。
  - 評分：沒有官方 API 證據的 **206 個產品，評分輸入完全相同**（7 個子分數原始值、來源、飽和懲罰輸入、可信度）；分數最多差 0.3 分，來自 2 個新產品改變百分位排名。有 API 證據的 7 個產品：雙胞胎廣告沒有重複計算（擴量與廣告主數不變），市場覆蓋因 UK 觸及 > 0 多了 GB（0.2 → 0.4 的 2 個）；新產品 28、30 分，可信度低。
  - 這些數字只證明「程式行為正確」，**不代表真實探索成效**；真實數字要等 token。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（69 檔 424 個；新增官方 API client 4、分組規則 5、runner 7、live deps 1、評分去重 1、廣告事實 1、證據列表 1、廣告列表 1，修改既有 5 個）build ✅ e2e ✅（47，4 個 worker、示範資料庫複本）。瀏覽器（`next start` + 量測後的複本 + `PIPELINE_DISABLED=1` + 假 token 字串只為顯示「已設定」）：詳情頁中英文、合併的廣告列與觸及、375px 無橫向捲動、探索頁新步驟與提示，server log 無錯誤。
- 限制：沒有真實請求，`link_caption` 是否為網域、`total_reach_by_location` 形狀、網站與 API 的 Library ID 是否相同、多國 `ad_reached_countries` 都待實測；歐盟國家標不出來（只標得出英國）；官方 API 產品沒有圖片與商品頁網址（照片去重無效、詳情頁「廣告連到的網域」是「—」）；美加澳紐、挪威仍然沒有 Meta 資料。
- 需要使用者：申請 `META_ACCESS_TOKEN`，加進 `.env.local` 與 Vercel Production（HUMAN_TODO 第 0 節，最優先）。
- 下一步：token 到手 → 少量真實請求實測（research 第五節）→ 複本量測 → Vercel 實測；在那之前回到 Phase 4C（CJ 產品的 collect 排序等）。

## 2026-10-11 — 同款照片比對 v1（ADR-016）：CJ 產品有了售價與毛利

- 背景：正式站 Meta 被擋，產品幾乎都來自 CJ；CJ 產品沒有售價、毛利是「—」、只有 1 個子分數。Shopify 搜尋結果是「同類商品」（ADR-012），不能當售價。
- 研究（`docs/research/same-photo-listings.md`）：8 個 CJ 商品 × 16 次 Shopify 搜尋（320 筆結果）實測，照片 dHash 距離 1–8 的 16 筆都是同一產品（標題幾乎相同、10 家店），其餘多半 ≥ 13。
- 做了什麼：
  - `source_items.image_hash`（migration 0012）、runner 新單位 `listing_hash`：下載 Shopify 搜尋結果的 256 px 縮圖算 dHash（同網址一次、每單位 30 張、每次 run ≤ 800 張、失敗記 `-`、網址改變就清掉）。
  - `isSamePhoto` / `samePhotoOf`（與產品去重同一規則）；`productRetailPrice`：廣告主售價 → 同款店家售價中位數（每家店一筆，優先美國），評分、詳情頁、排名頁共用。
  - 評分 v1.3：毛利說明標示「N 家賣同款商品的店家中位數」；「證據太少」50 分上限只算需求訊號（毛利不算）。
  - CJ 供貨價改取規格區間的**最高價**：原本取最低價，象造型抱枕的「空殼」規格 1.00 USD 讓毛利算成 97.5%。
  - 介面：詳情頁「其他店家賣的同款商品」區塊（預設展開、可點連結查證）、「同款商品售價（美國）」標籤、供貨價說明「CJ 取最貴的規格」、探索步驟名稱「合併重複的產品、比對同款照片」。
- 成效（Vercel 情境：空資料庫＋模擬 Meta 被擋，真實 CJ 與 Shopify 請求；`.data/dev` 未寫入）：
  - 改動前：18 個 CJ 產品，有售價 0、有毛利 0、每個產品只有 1 個子分數，8 個卡在 50 分上限。
  - 改動後（同一份資料）：比對 671 張照片（0 失敗，約 273 秒；經 runner 以 200 秒 tick 分 3 段跑完）；**4 / 18 個產品找到同款店家（共 5 家），有售價與毛利 0 → 4**；人工看 5 家店的標題與網址都是同一產品（樣本小，準確率未驗證）。
  - 第一次量測（評分 v1.2）：2 個產品因毛利從 50 分跳到 79.2、65.5 分 → 判定毛利不是需求證據，改成 v1.3 後仍在 50 分上限（50 分以上 2 → 0）。
  - CJ 供貨價改最高價：18 個中 14 個有規格區間（最高／最低 1.1–34 倍）；4 個有毛利的產品毛利 97.5/96.2/91.2/86.4% → 93.4/65.2/85.8/86.4%（仍是運費前）。
  - 沒找到同款的 14 個產品：搜尋結果都是同類商品（距離 ≥ 11）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（71 檔 439 個；新增同款判定 5、listing hash 3、售價 3、毛利 1、評分 3、介面 2，修改 CJ 價格與文字的既有測試）build ✅ e2e ✅（47，示範資料庫複本，`[WebServer]` 無錯誤）。瀏覽器（`next start` + 量測後的複本）：詳情頁中英文的同款售價、毛利說明、同款區塊；375px 無橫向捲動；server log 無錯誤。
- 發現的新問題：同一天第 3 次探索（空資料庫）CJ 第 2 個請求就回 `1600200 QPS limit is 1 time/1second`，CJ 步驟停止並退避 → 已列 ROADMAP 第一項（CJ 請求節奏）。
- 限制：dHash 認不出裁切／修圖的照片；店家只有 1 家時售價代表性低；售價是店家公開價；不知道店家賣哪個規格（供貨價取最高只保證不高估）；毛利未含運費；同款店家數不計分。
- 下一步：CJ 請求節奏（避免 Vercel 上被 CJ 限流退避 6 小時）→ CJ 規格比對／運費試算 → 既有 Meta 產品的同款比對。

## 2026-10-11 — CJ 請求節奏：每秒限流不再讓 CJ 停 6 小時（ADR-014 修訂）

- 背景：上一輪量測時，同一天第 3 次探索（空資料庫）第 2 個 CJ 請求就收到 `1600200 QPS limit is 1 time/1second`，舊程式把它當封鎖，CJ 對出口退避 6 小時；在 Vercel 上等於整天沒有新產品。
- 研究（`docs/research/cj-api.md` 第六節）：官方文件免費帳號每秒 1 次、`getAccessToken` 也算，沒寫恢復時間。實測 25 個 0 點的詳情請求＋2 次取 token：間隔 1.0 秒 6 次中 1 次被拒、0.8 秒 4 次中 2 次被拒（被拒與成功交替 → 被拒的不佔額度）、1.25 與 1.5 秒各 6 次全部成功；被拒後 1 秒再送就成功；回應時間 150 ms–3.2 s。原因：間隔從「呼叫前」算，token 請求不在節奏內，token 回來後的請求與下一個請求在 CJ 那邊不到 1 秒。
- 做了什麼：`createCjClient` 新增 `beforeRequest`（每個 HTTP 請求都經過，含 token）；runner 的 `counted` 用它依送出時間間隔 **1.5 秒**、每次先寫入 `cjNextAt` 與請求數再送（跨 tick 成立）；`1600200` 等 3 秒重送同一請求最多 3 次（`qpsRetries` 記數），仍被拒就停止這次的 CJ 請求但**不退避**；只有點數用完才退避。探索頁 CJ 限流說明改成「連續拒絕 3 次、這次停止、下次再試」。
- 成效（空資料庫複本，模擬 Meta 被擋，真實 CJ 請求，`--collect=0`）：連續 3 次探索，CJ 請求 52 / 51 / 51（第 1 次含取 token）、**被拒 0 次、重送 0 次、退避 0 筆**；CJ 步驟每次約 78–81 秒（間隔 1.1 秒時約 57 秒）；第 1 次 18 個新產品、第 2、3 次 0 個新產品（CJ 清單同一天相同，18 個清單紀錄更新）。改動前同樣情境：本輪稍早第 3 次探索第 2 個請求就被拒並退避。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（71 檔 442 個；新增間隔 1、QPS 重送 1、持續拒絕 1，`requests` 改為含 token 9 個）build ✅ e2e ✅（47，示範資料庫複本，`[WebServer]` 無錯誤）。
- 限制：只在本機住宅 IP 實測；Vercel 出口的延遲與抖動可能不同（1.5 秒留了 0.5 秒餘裕）。CJ 可能調整上限（文件說會依營運狀況調整）。token 是否計入只能依文件推定。
- 下一步：CJ 規格比對／運費試算（到岸毛利）→ 既有 Meta 產品的同款比對；使用者 push 後在 Vercel 確認 CJ 步驟完成。

## 2026-10-11 — CJ 規格比對＋運費試算：毛利改成到岸毛利（ADR-017）

- 背景：ADR-016 之後 4 個 CJ 產品有毛利，但那是運費前毛利，供貨價又是整個規格區間的最高價。
- 研究（`docs/research/cj-api.md` 第七節，少量真實請求）：商品詳情（0 點）的 `stanProducts` 就是規格（`vid`、名稱、價格、重量）；`freightCalculate` 每次 10 點、回 10–29 個未排序的選項，`totalPostageFee` 含稅；英語系五國都實測（1,300 克抱枕到 US 15 天內最便宜 36.73、GB 23.60、CA 26.02、AU 20.75、NZ 35.80 USD）。運費常比供貨價高好幾倍。
- 做了什麼：
  - `parseCjVariants`、CJ client `freight`；候選商品詳情保存規格。
  - `src/pricing/landed.ts`：`chooseVariant`（全部同價 → 同款店家選項對得上的規格 → 對不上用最貴規格）、`chooseShipping`（15 天內最便宜）、`landedMargin`（缺一項就 null）。
  - runner 新單位 `cj_freight`（CJ 收尾後）：寄到美國、每次探索 ≤ 20 次（200 點）、照 CJ 節奏、同規格 7 天內沿用、有售價的產品優先；新表 `cj_landed_costs`（migration 0013）。
  - 評分 v1.4：毛利子分數改用到岸毛利（滿分門檻 40%、負毛利 0 分、沒有運費就是「—」並說明「需要 CJ 運費報價」）。
  - 詳情頁「毛利估算」四格：售價、供貨成本（CJ 規格與依據）、寄到美國的運費（物流商、天數、報價日期）、到岸毛利率（中英文）。
- 成效（上一輪量測後的複本：18 個 CJ 產品、4 個有同款售價；真實 CJ 請求）：
  - 一次探索 69 個 CJ 請求（51 + 18 次運費試算 = 180 點），106 秒，被拒 0 次。
  - 18 個產品都有規格與運費：規格依據 `single_price` 2、`store_options` 3、`max_variant` 13；15 天內最便宜的物流 5.93–32.72 USD（11 個是 LuWei Ordinary US）。
  - 抱枕：同款店家只賣 40／60 cm → 22 個規格對到 10 個，供貨價 9.95（80 cm）→ 4.86。
  - 有毛利的產品 4 → 4（受售價限制）；毛利從運費前 93.4／65.2／85.8／86.4% → 到岸 35.8／48.5／50.6／52.5%。
  - 分數：18 個產品完全不變（4 個中 3 個到岸毛利仍 ≥ 40% 滿分，抱枕 0.9 分但受 50 分上限）。
- 驗證：format ✅ lint ✅ typecheck ✅ test ✅（72 檔 453 個；新增規格／運費規則 7、運費 runner 1，修改毛利與評分既有測試）build ✅ e2e ✅（47，示範資料庫複本）。瀏覽器（`next start` + 量測複本）：抱枕英文、手套中文 375px（沒有售價時顯示規格、運費、毛利「—」並說明缺什麼），無橫向捲動，server log 無錯誤。
- 限制：規格比對是字面比對（店家改名就對不上 → 最貴規格）；只算美國；運費與天數是 CJ 試算；店家售價是公開價。
- 下一步：既有 Meta 產品的同款比對（示範資料庫 208 個，量測售價覆蓋率）；到岸毛利其他四國。
