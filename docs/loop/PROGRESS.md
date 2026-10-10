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
