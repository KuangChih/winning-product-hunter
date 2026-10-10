# 架構決策紀錄（ADR）

新增 ADR 時沿用以下格式，編號遞增。被取代的 ADR 保留，在狀態註明由哪一份取代。

```
## ADR-NNN：<標題>（<日期>，狀態：採用 / 部分取代於 ADR-XXX / 取代於 ADR-XXX）
- 背景：
- 選項：
- 決定：
- 理由：
- 後果：
```

## 目前有效的決策一覽

| 主題           | 有效 ADR         | 重點                                                                         |
| -------------- | ---------------- | ---------------------------------------------------------------------------- |
| 資料來源       | 005、006、007、013 | 第一手官方 API 優先；美國等市場的廣告用公開網站蒐集（可在 Vercel 執行，規則不變）；先完成真實資料閉環 |
| 評分與實體對應 | 002、012         | 可解釋的加權子分數；售價只用廣告主自己的商品頁                               |
| 架構           | 003、013         | Next.js on Vercel + Neon + Drizzle；pipeline 是可續跑的 runner，在 Vercel 分段執行（網頁按鈕 + Vercel Cron），CLI 共用 |
| 存取與安全     | 008、010         | 站台密碼保護、登入防暴力破解、安全標頭                                       |
| 介面           | 009、011         | 單一 Watchlist；`[lang]` 路由 + cookie 改寫的中英文介面                      |

---

## ADR-001：資料來源策略（2026-10-09，狀態：取代於 ADR-005）

- 背景：Meta 與 TikTok 官方廣告 API 只開放 UK + EU 的商業廣告；Google Trends 官方 API 仍是 alpha；Amazon PA-API 5 已停用。
- 決定：官方 API + 授權第三方資料商（SerpApi、Apify、Keepa），把 EU 廣告資料當成全球熱度的代理指標；第一批接 Meta（EU）、SerpApi、AliExpress。
- 後續：使用者 2026-10-10 決定第一手資料優先、不用 AliExpress，由 ADR-005 取代。保留「來源 × 供應商」兩層 adapter 的設計。

## ADR-002：評分與實體對應方法（2026-10-09，狀態：採用，待回測修正）

- 背景：業界評分公式都沒有公開；廣告持續天數只代表存活力，不等於獲利；單一來源容易偏誤。詳見 [`research/scoring.md`](../research/scoring.md)。
- 選項：(A) 機器學習直接預測；(B) 可解釋的加權子分數 + 佐證／飽和乘數；(C) 只排序不給分數。
- 決定：B。缺資料的子分數不計入並降低信心度；單一來源上限 70 分。實體對應採三層漏斗：感知雜湊 → 圖片／文字向量 → 規則決策。
- 理由：初期沒有標註資料，無法訓練 A；B 透明、可驗證，符合差異化定位；累積回測資料後再用 A 調權重。
- 後果：ingestion 必須保存不可覆寫的時間序列快照；評分要輸出完整拆解。

## ADR-003：整體架構、資料庫、排程與驗證（2026-10-09，狀態：採用；排程部分由 ADR-013 修改）

- 背景：Vercel function 有執行時間上限（Hobby 300 秒、Pro 800 秒）；Vercel Cron 在 Hobby 只能每天一次；評分需要 pgvector 與時間序列快照；Auth.js 已由 Better Auth 團隊接手，官方建議新專案用 Better Auth。
- 決定：
  - **單一 Next.js（App Router）專案**部署在 Vercel，負責介面與讀取。
  - **Neon Postgres** + Drizzle ORM；資料存取都經過資料層，日後換資料庫只改這層。
  - **蒐集與評分是 Node CLI jobs**（`src/jobs/*`），可在本機、GitHub Actions 排程（預設，免費、單次最多 6 小時）或 Vercel Cron（只做輕量觸發）執行。
  - **Better Auth**（Phase 5 多使用者時才導入），權限檢查放在 Server Component / Route Handler，不只靠 proxy。
  - npm、Node 22 以上。
- 理由：蒐集與向量計算時間不可控，不適合 Vercel function；GitHub Actions 無額外成本且跟 repo 同處。
- 後果：jobs 不能依賴 Next.js runtime；`DATABASE_URL` 與來源金鑰要同時設在 Vercel 與 GitHub Secrets。

## ADR-004：先做端到端垂直切片，再接 live API（2026-10-09，回顧輪 10，狀態：採用，已完成）

- 背景：當時沒有任何 API 金鑰，live adapter 寫了也無法驗證；實體對應、評分、頁面都還沒開始。
- 決定：先用 fixture 打通「蒐集 → 對應 → 評分 → 頁面」的最小版本，再接真實來源。
- 理由：越早有可點進去看證據的產品頁，越早發現 schema 與評分設計的問題。

## ADR-005：以第一手資料為主、英語系五國優先，移除 AliExpress（2026-10-10，狀態：採用；決定 2 由 ADR-006 修改）

- 背景：使用者決定目標市場為英語系五國優先（US、CA、UK、AU、NZ），其次歐洲（DE、FR、SE、BE、ES、NO）；要求第一手資料優先；不用 AliExpress；花錢必須有實質成果。研究見 [`first-party-sources.md`](../research/first-party-sources.md)、[`suppliers.md`](../research/suppliers.md)、[`store-signals.md`](../research/store-signals.md)。
- 主要發現：
  - 沒有任何平台提供 US / CA / AU / NZ 商業廣告的官方 API；Meta `/ads_archive` 與 TikTok Commercial Content API 只涵蓋 UK + EU。
  - SerpApi、Apify、Keepa 都是自己爬平台頁面；Amazon 官方 API 的條款禁止分析與資料服務用途。
  - 可用的第一手來源：Google Merchant API Best sellers（11 國，需 Merchant Center 資格）、Shopify Global Catalog、Pinterest Trends API、Google Ads Keyword Planner、Meta / TikTok 官方 API（UK + EU）、CJ Dropshipping API v2。
- 決定：
  1. 資料來源以官方第一手 API 為主；中間商只在第一手來源補不了缺口、且經使用者決定時才用。
  2. ~~美國等市場不爬 Meta / TikTok 公開網站~~（已由 ADR-006 修改）。
  3. 移除 AliExpress，供應商先接 CJ Dropshipping API v2；Zendrop 實測後再決定；歐洲第二波考慮 BigBuy。
  4. 資料模型加入國家維度，評分可依目標市場加權。
- 後果：需要使用者申請各平台的開發者帳號（見 HUMAN_TODO）。

## ADR-006：蒐集 Meta / TikTok 公開廣告網站（2026-10-10，狀態：採用；決定 3 的執行地點由 ADR-013 修改）

- 背景：官方 API 只提供 UK + EU 的商業廣告，而最優先的市場是 US、CA、AU、NZ。使用者認為 Meta 與 TikTok 的公開廣告網站是最重要的第一手資訊，決定蒐集；平台初期由使用者個人研究使用。
- 風險（已告知使用者）：Meta 條款禁止自動化蒐集（不論是否登入）並禁止轉售蒐集資料；TikTok 條款禁止 scraping；可能被封鎖。若對外開放或收費，必須重新評估。
- 決定：
  1. 實作 Meta Ad Library 網站與 TikTok Creative Center 的公開頁面蒐集器，英語系市場優先。
  2. 界線：不破解 CAPTCHA、不繞過 bot 偵測（不用 proxy 輪替、不偽造指紋或簽章）、不用程式輸入帳密、不蒐集個人資料；被擋就停止退避並記錄。
  3. 低頻率、有總量上限；在 GitHub Actions 或使用者電腦執行，不在 Vercel。
  4. 自建蒐集器長期被擋時，再評估 Apify 等付費服務（依花錢原則由使用者決定）。
- 後果：CLAUDE.md 的「資料蒐集規則」以此為準。TikTok Creative Center 實測後暫緩（API 需要頁面簽章，見 [`tiktok-creative-center.md`](../research/tiktok-creative-center.md)）。

## ADR-007：先完成真實資料閉環（2026-10-10，回顧輪 20，狀態：採用，已完成）

- 背景：已接上三個不需金鑰的真實來源（Shopify Global Catalog、Meta Ad Library 公開網站、ECB 匯率），但系統只會用樣本產品名稱去搜尋，不會自己發現新產品；評分沒用到真實訊號；沒有每日排程，回測無法開始累積。
- 決定：新增 Phase 2R 並放最前面：產品探索 → 真實訊號評分 → 每日排程 → 來源健康度。產品探索 v1 用 Meta Ad Library 做品類關鍵字掃描，以商品頁網址分組（同一商品頁 = 同一商品，比標題比對可靠）。
- 理由：每天自動累積的真實資料本身就是最有價值的資產；之後每個新來源都只是增加訊號。
- 後果：需要使用者 push 並在 GitHub Secrets 設定 `DATABASE_URL`，排程才會執行。

## ADR-008：部署前先加站台存取保護（2026-10-10，回顧輪 30，狀態：採用）

- 背景：使用者將部署到 Vercel，但 ADR-006 的公開網頁資料限個人研究使用，公開網站會讓任何人看到。
- 決定：`SITE_PASSWORD` 密碼保護（未設定時開放，方便本機開發）；多使用者帳號與付費（Phase 5）延後到要對外營運時。
- 後果：部署前使用者必須在 Vercel 設定 `SITE_PASSWORD`。

## ADR-009：Watchlist 先做單一清單（2026-10-10，狀態：採用）

- 背景：網站目前只有使用者本人使用，沒有帳號系統。
- 選項：(A) 等帳號系統再做；(B) 全站共用一份收藏清單，存資料庫；(C) 存瀏覽器 localStorage。
- 決定：B。`watchlist` 以 `product_id` 為主鍵，加入時記下當時分數；去重合併產品時，收藏移到存活產品。
- 理由：存在資料庫，每日排程之後才能寄送分數變動通知。
- 後果：Phase 5 加帳號時，`watchlist` 要加 `user_id` 並改成複合主鍵。

## ADR-010：部署前先做安全強化（2026-10-10，回顧輪 40，狀態：採用，已完成）

- 背景：站台只靠一組共用密碼，登入沒有次數限制；沒有安全標頭，可被嵌入 iframe 或被搜尋引擎收錄；production `npm audit` 有 7 個 high（全部來自只在開發時用的 `shadcn` CLI）。
- 決定：登入防暴力破解（用既有 Postgres 記錄，不加外部服務）、安全標頭與 noindex，排在無障礙與 i18n 之前；`shadcn` 移到 devDependencies。
- 理由：部署隨時可能發生，安全缺口的代價遠高於介面改善；兩項都不需要金鑰或付費。

## ADR-011：介面多語系（英文 / 繁體中文）用 `[lang]` 路由 + cookie 改寫（2026-10-10，狀態：採用）

- 背景：使用者用繁體中文，目標客群是英語系賣家。Next.js 16 開啟 Cache Components，頁面靠預渲染的靜態外殼加串流。
- 選項：(A) 網址加語言前綴，所有內部連結都帶語言；(B) 只用 cookie 決定語言，但在 layout 讀 cookie 會讓外殼變動態；(C) 頁面放在 `app/[lang]`，各語言分別預渲染，proxy 依 `locale` cookie 把沒有前綴的網址改寫到 `/en/...` 或 `/zh-TW/...`。
- 決定：C。語言用 `next/root-params` 的 `lang()` 取得；字典是 TypeScript 物件，用型別強制每種語言都有相同的 key。來源資料（廣告文字、產品標題）不翻譯。
- 理由：網址與既有連結不用改，兩種語言都保有預渲染外殼；`/zh-TW/...` 也能直接開。
- 後果：新頁面放在 `src/app/[lang]/`；切換語言會重新載入頁面。之後若開放 CDN 公開快取，要確認快取鍵包含改寫後的路徑。

## ADR-012：產品售價只用廣告主自己的商品頁；搜尋結果是「同類商品」（2026-10-10，狀態：採用）

- 背景：Shopify Global Catalog 有兩種資料：(1) 用廣告的商品頁網址查到的廣告主商品（`shopify_catalog_lookup`），就是這個產品；(2) 用產品標題搜尋到的商品（`shopify_catalog`），是其他店家的同類商品。原本兩者混用，排名表售價、價格篩選、毛利、「販售的店家」都把 (2) 當成這個產品。
- 選項：(A) 維持混用；(B) 有 (1) 用 (1)，沒有時退回 (2) 的中位數；(C) 售價只用 (1)，沒有就顯示「—」，(2) 只用於競爭程度與市場參考。
- 決定：C。
- 理由：核心原則「只用真實資料、不推估」——(2) 的中位數不是這個產品的價格；(2) 的店家數仍是有效的飽和度訊號，但要明確說是「同類商品」。
- 後果：示範資料庫有售價的產品從 43 個降到 26 個。要提高覆蓋率，需對更多產品執行廣告主商品頁查詢（ROADMAP Phase 4C）。

## ADR-013：pipeline 在 Vercel 分段執行，由網頁按鈕與 Vercel Cron 觸發（2026-10-10，狀態：採用；修改 ADR-006 決定 3 與 ADR-003 排程部分）

- 背景：正式站（Vercel + Neon）的資料庫是空的，真實資料只能用 CLI 或 GitHub Actions 蒐集，而 GitHub 排程從未設定。使用者 2026-10-10 決定：在網頁上按按鈕就觸發真實資料探索、蒐集直接在 Vercel 執行、Vercel Cron 每天自動跑一次、每個 UTC 日最多 3 次 Meta 掃描、可輸入自訂關鍵字。限制：Vercel Hobby 每次 function（含 `after()`）最多 300 秒，而整條 pipeline 因節制的請求間隔需要 10–15 分鐘。
- 選項：
  - (A) 維持 CLI + GitHub Actions 排程，網頁只顯示。
  - (B) Vercel Workflow（durable steps）：要新依賴，與 Next 16.4 + cacheComponents 的相容性未驗證，且無法在部署前驗證。
  - (C) 自建可續跑的 runner：狀態存在 `pipeline_runs`（DB lease + fencing），工作拆成冪等的小單位，每個 function 做一段約 200 秒的 tick，結束前 POST 下一段（自我接續）；status 輪詢（看門狗）與每天 4 個 cron（06–09 UTC）負責恢復停住的 run。CLI 用同一個 runner、沒有時間限制。
- 決定：C。
  - 路由：`POST /api/pipeline/start`（網站 cookie + `Origin` 檢查；已有進行中的 run 就回傳那一個；正式環境沒設 `SITE_PASSWORD` 時拒絕）、`GET /api/pipeline/status`（進度 JSON；含 `cronConfigured`、`canStart`、`startBlockedReason`）、`POST /api/internal/pipeline/tick`（Bearer = sha256(固定前綴 + `CRON_SECRET` 或 `DATABASE_URL`)，常數時間比較）、`GET /api/internal/cron/daily`（需要 `Authorization: Bearer $CRON_SECRET`，沒設回 503；當天還沒掃過 Meta 才建立 run，否則只恢復停住的 run）。都是 `maxDuration = 300`、Node runtime；`/api/internal/*` 不經過網站密碼的 proxy。
  - 自我接續只送往允許的網址：正式環境 `https://$VERCEL_PROJECT_PRODUCTION_URL`，本機只送 localhost / 127.0.0.1 / [::1]，絕不跟著請求的 `Host`。失敗記在 `last_kick_error`。
  - 只在 Vercel Production 或本機執行；Preview 需 `PIPELINE_ALLOW_PREVIEW=1`（避免 Neon preview branch 複製出第二條 pipeline 再掃一次 Meta）；`PIPELINE_DISABLED=1` 總開關（e2e）。一個 deployment 只接手自己環境或 CLI 建立的 run。
  - ADR-006 的蒐集規則全部保留：誠實 User-Agent、Meta 請求間隔 5 秒、每個 run 最多 70 個 Meta 請求、被擋就停止並依 egress（vercel / github / local）退避 6 → 12 → 24 小時…最多 7 天、不繞過。新增：每個 UTC 日最多 3 次 Meta 掃描（含每日自動），用完後按鈕仍可用，只做售價、去重、評分。
- 理由：使用者要求在網頁直接觸發並由 Vercel 每日自動執行；(C) 不需新依賴，邏輯與 Next.js 分離（可用 PGlite 單元測試、與 CLI 共用），每個工作單位冪等，任何一段被殺都能從資料庫狀態接續。
- 後果：
  - **最大風險**：Vercel 對外是 AWS 機房 IP，Meta 可能直接擋；本機（住宅 IP）實測成功不代表 Vercel 也會成功，要使用者部署後按一次才知道。被擋時頁面說明並退避；替代方案是在自己電腦用 Neon 連線字串跑 `npm run pipeline`，或之後評估付費來源。
  - Vercel 自我請求的迴圈偵測（508）門檻未公開；以較長的 tick、看門狗與 4 個恢復用 cron 緩解。
  - 一天最多掃 3 次會讓「廣告動能」（每日觀測到的廣告數）略偏高，寫進 ROADMAP 之後改為只用每日排程的觀測並量測。
  - 部署需要設定 `CRON_SECRET`（每日自動）並確認 Fluid compute 開啟（300 秒；不支援 60 秒上限的模式：一個工作單位可能就要 45–60 秒，調低 `PIPELINE_TICK_BUDGET_MS` 會讓 tick 數撞到 40 次上限），見 `docs/DEPLOY.md`。GitHub Actions 每日排程不再需要（只保留手動執行）。
