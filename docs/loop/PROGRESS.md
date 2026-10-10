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
