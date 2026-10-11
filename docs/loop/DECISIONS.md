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
| 資料來源       | 005、006、007、013 | 第一手官方 API 優先；美國等市場的廣告用公開網站蒐集（可在 Vercel 執行，ADR-006 規則不變；每日最多 3 次 Meta 掃描、每次最多 70 個請求、被擋依出口退避）；先完成真實資料閉環 |
| 評分與實體對應 | 002、012         | 可解釋的加權子分數；售價只用廣告主自己的商品頁                               |
| 架構           | 003、013         | Next.js on Vercel + Neon + Drizzle；pipeline 是可續跑的 runner，在 Vercel 分段執行（「開始探索」按鈕 + 每天 4 個 Vercel Cron，第 1 個開始、其餘恢復），CLI 共用；GitHub Actions 只手動 |
| 存取與安全     | 008、010、013    | 站台密碼保護（正式站沒設密碼時不能開始探索）、登入防暴力破解、安全標頭；內部 route 用 Bearer token |
| 介面           | 009、011、013    | 單一 Watchlist；`[lang]` 路由 + cookie 改寫的中英文介面；不顯示樣本資料、`/discover` 探索頁 |

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
- 後續：真實資料閉環完成後，網站不再顯示樣本資料（ADR-013，`npm run seed` 移除）；fixture 只留給自動測試。

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
  3. 低頻率、有總量上限；~~在 GitHub Actions 或使用者電腦執行，不在 Vercel~~（執行地點已由 ADR-013 修改：也在 Vercel 分段執行，其他規則不變）。
  4. 自建蒐集器長期被擋時，再評估 Apify 等付費服務（依花錢原則由使用者決定）。
- 後果：CLAUDE.md 的「資料蒐集規則」以此為準。TikTok Creative Center 實測後暫緩（API 需要頁面簽章，見 [`tiktok-creative-center.md`](../research/tiktok-creative-center.md)）。

## ADR-007：先完成真實資料閉環（2026-10-10，回顧輪 20，狀態：採用，已完成）

- 背景：已接上三個不需金鑰的真實來源（Shopify Global Catalog、Meta Ad Library 公開網站、ECB 匯率），但系統只會用樣本產品名稱去搜尋，不會自己發現新產品；評分沒用到真實訊號；沒有每日排程，回測無法開始累積。
- 決定：新增 Phase 2R 並放最前面：產品探索 → 真實訊號評分 → 每日排程 → 來源健康度。產品探索 v1 用 Meta Ad Library 做品類關鍵字掃描，以商品頁網址分組（同一商品頁 = 同一商品，比標題比對可靠）。
- 理由：每天自動累積的真實資料本身就是最有價值的資產；之後每個新來源都只是增加訊號。
- 後果：需要使用者 push 並在 GitHub Secrets 設定 `DATABASE_URL`，排程才會執行（每日排程後來由 ADR-013 改為 Vercel Cron，GitHub Actions 只保留手動執行）。

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
  - 最終行為（M1–M7 完成後，2026-10-11）：
    - Tick：軟預算 200 秒（`PIPELINE_TICK_BUDGET_MS`，支援 120000–250000）、預算後 50 秒硬中止、lease 再多 70 秒（共 320 秒）；需要 Fluid compute（300 秒），不支援 60 秒模式。CLI 沒有預算，用每 60 秒的 heartbeat 續約。
    - Meta 間隔跨 tick 也成立：下次可請求時間存在 run 狀態，請求數與時間**先寫入再送出**；Meta adapter 不自動重試（重試是沒記帳的請求）；重試的單位若結果已暫存就不再問 Meta。
    - 上限：每 run ≤40 個 tick、20 小時硬失敗；2 小時沒進度或 tick 快用完就收尾（merge → match → score）；同一單位被中斷 3 次就跳過；每 UTC 日 ≤3 次 Meta 掃描（以 run 建立日計算，第 2、3 次輪到不同的關鍵字與廣告主視窗）。
    - Cron：`vercel.json` 4 個 entry（06、07、08、09 UTC）指向同一個 route；當天沒有成功或進行中的 cron run、也還沒掃過 Meta 才開新 run，其餘只恢復停住或標記過期的 run。
    - 環境：只在 Vercel Production 或本機執行；Preview 預設停用（`PIPELINE_ALLOW_PREVIEW=1` 才允許，且不自我接續）；`PIPELINE_DISABLED=1` 是總開關（e2e 伺服器使用）。
    - 介面：`/discover` 探索頁（按鈕、自訂關鍵字、即時步驟、被擋 / 今日已用完 / cron 未啟用 / 無法開始的誠實提示、執行紀錄、來源健康度）；`/sources` 永久轉址到 `/discover`；網站不再顯示樣本資料（`?sample=1`、`npm run seed` 移除），fixture 產品在排名、詳情（404）、收藏都被排除。
    - Route handler 不 import `src/jobs/*`（`load-env`、`runJob` 有副作用）；runner 與 HTTP 傳輸層分離（`src/pipeline/runner`、`src/pipeline/web.ts`、`src/pipeline/transport.ts`）。
- 理由：使用者要求在網頁直接觸發並由 Vercel 每日自動執行；(C) 不需新依賴，邏輯與 Next.js 分離（可用 PGlite 單元測試、與 CLI 共用），每個工作單位冪等，任何一段被殺都能從資料庫狀態接續。
- 後果：
  - **最大風險**：Vercel 對外是 AWS 機房 IP，Meta 可能直接擋；本機（住宅 IP）實測成功不代表 Vercel 也會成功，要使用者部署後按一次才知道。被擋時頁面說明並退避；替代方案是在自己電腦用 Neon 連線字串跑 `npm run pipeline`，或之後評估付費來源。
  - Vercel 自我請求的迴圈偵測（508）門檻未公開；以較長的 tick、看門狗與 4 個恢復用 cron 緩解。
  - 一天最多掃 3 次會讓「廣告動能」（每日觀測到的廣告數）略偏高，寫進 ROADMAP 之後改為只用每日排程的觀測並量測。
  - 部署需要設定 `CRON_SECRET`（每日自動）並確認 Fluid compute 開啟（300 秒；不支援 60 秒上限的模式：一個工作單位可能就要 45–60 秒，調低 `PIPELINE_TICK_BUDGET_MS` 會讓 tick 數撞到 40 次上限），見 `docs/DEPLOY.md`。GitHub Actions 每日排程不再需要（只保留手動執行）。

## ADR-014：CJ Dropshipping 官方 API 作為不依賴 Meta 的探索來源（2026-10-11，狀態：採用）

- 背景：使用者在 Vercel 按「開始探索」，Meta Ad Library 網站回 HTTP 403（Meta 封鎖 Vercel 的機房 IP）。依 ADR-006 不繞過，只退避；正式站因此沒有任何產品。使用者 2026-10-11 決定加入 CJ 探索並提供 `CJ_API_KEY`。CJ 是官方 API（第一手、免費、從 Vercel 呼叫不會被擋），而且有目前最缺的真實銷量訊號。實測見 `docs/research/cj-api.md`。
- 選項：
  - (A) 只用 CJ 補供貨價（毛利），探索仍只靠 Meta：Meta 被擋時網站依然沒有產品。
  - (B) CJ 當獨立的探索來源：從 CJ 的 trending 清單與本次關鍵字找「CJ 上有訂單」的商品並建立產品，Meta 被擋也照常執行。
  - (C) 付費資料商（AdSpy、Minea 等）：要付費、屬於中間商，使用者規則是第一手優先。
- 決定：B。
  - Runner 新增「搜尋 CJ 熱銷商品」步驟（`cj` → `cj_details` → `cj_finalize`），位置在 Meta 掃描之後、Shopify collect 之前，**不受 Meta 退避或封鎖影響**。每次 run：CJ trending（依上架數取前 10）＋本次的關鍵字（每個取依上架數排序前 20 筆中最高的 3 個；三種挑選方式的量測比較見 research 第五節，這個方式建立 19 個產品，其他兩種 13 個、3 個），最多 11 次列表（50 點／次，共 550 點，帳號每日 50,000 點）＋ 40 次詳情（0 點）；每次請求間隔 1.1 秒（免費帳號 1 QPS），**先記帳再送出**；一次只打一次，不自動重試。
  - 錯誤分類：金鑰／token 被拒（`auth`）→ 停止 CJ、刪除快取 token、不退避（要使用者修金鑰）；點數用完（`points`）或限流（`rate_limited`）→ 停止 CJ，並對這個出口記錄退避（沿用 `source_backoff`，provider `cj_api`，6 → 12 → 24 小時…）；其他錯誤（單一商品）→ 記錄後繼續。沒有 `CJ_API_KEY` 時步驟顯示「未設定」並跳過。
  - Access token：取得端點有頻率限制，存在新表 `api_tokens`（以 `CJ_API_KEY` 衍生的金鑰做 AES-256-GCM 加密；資料庫外洩不會洩漏 token），到期前 7 天才重取。金鑰只來自環境變數，錯誤訊息會把金鑰與 token 遮蔽。
  - 產品鍵：沿用 `products.landing_key` 欄位，值為 `cj:<pid>`（既有值是 `handle:` / `url:` 前綴，命名空間不重疊）。理由：這個欄位的語意本來就是「來源上的唯一產品鍵」（唯一索引、合併後仍指向存活產品、重複掃描更新同一產品），新增欄位只會複製同一套邏輯；`finish` 的新產品計數、collect 的「探索到的產品優先」也自然涵蓋 CJ 產品。
  - 建立門檻（`CJ_RULES`，依 2026-10-11 實測的詳情決定）：查詳情需 `listedNum ≥ 50`；建立產品需 CJ 訂單數（`soldOut` 有值時用它，否則 `orderCount`）≥ 50 **且**最近一筆付款在 30 天內。CJ 文件寫的 90 天銷量 `soldOut` 實測全部是 null，所以實際用的是 `orderCount`（CJ 未公開統計期間）。不達門檻的商品不儲存（沒有產品的 CJ listing 會被 `runMatching` 用標題比對，太鬆）。
  - 跟既有產品的對應：只用既有的照片 dHash 合併規則（幾乎相同的照片，或相似照片＋標題重疊），不另做標題比對；不確定就不合併。
  - 證據：`source='cj'`、`provider='cj_api'`、`kind='listing'`；metrics `stores_listed`（CJ 上架數）、`orders_total`（CJ 訂單數）、`units_total`（訂單件數），只有 CJ 真的回傳 `soldOut` 時才有 `units_sold_90d`；供貨價取最低（含折扣）USD。產品的 `first_seen_at` 用商品上架 CJ 的時間（詳情的 `createdate`），讓飽和懲罰的「存在多久」反映真實年齡。
  - 評分（v1.2）：「市集訂單」子分數有 90 天銷量時用它，否則用 CJ 訂單數，並在說明中標示「CJ 平台計數；CJ 未公開期間」。新增**證據太少上限**：只量到一個子分數（可用權重 < 0.25）的產品最高 50 分（量測前：只有 CJ 證據的產品拿到 69.6 分、排名第 1，可信度只有 0.05）。
  - 介面：來源標籤「CJ（供應商銷量）」；詳情頁「供應商報價」顯示 CJ 訂單數、上架數與「CJ 平台計數」說明；探索頁新增步驟；Meta 被擋與今日已用完的提示改成說明「沒有 Meta 也會繼續從 CJ 探索」（沒設 `CJ_API_KEY` 時改為說明加了金鑰能換到什麼），**不再建議在自己的電腦上執行**。
- 理由：唯一第一手、免費、Vercel 上可用、而且有銷量訊號的來源；不需要繞過任何封鎖。點數用量（每次 run 550 點）只占每日額度約 1%。
- 後果與限制：
  - CJ 的訂單數只代表經由 CJ 下的單，不是整個市場；`listedNum` 是累計上架數，偏向老商品，只用來挑選要查的商品。
  - 只有 CJ 證據的產品沒有廣告持久度、擴量、動能等子分數（顯示「—」），可信度低，且受 50 分上限。
  - CJ 商品頁有反爬驗證頁，程式不讀取；連結格式依 CJ 網站慣例，無法自動驗證。
  - CJ ToS 對資料展示的條款尚未確認；目前是個人研究使用，對外開放或收費前要重新評估（HUMAN_TODO）。

- **修訂（2026-10-11，CJ 請求節奏）**：實測（`docs/research/cj-api.md` 第六節）CJ 的每秒上限是當下的、被拒的請求不佔額度、1 秒後就能再送。改成：間隔 1.1 → **1.5 秒**、從每一個 HTTP 請求（含取 token）的送出時間算並先寫進 run 狀態；`1600200` 等 3 秒重送、最多 3 次，仍被拒就停止這次的 CJ 請求但**不退避**；只有點數用完才對出口退避。原因：一次每秒限流就讓 Vercel 上的 CJ 停 6 小時，代價遠大於每次探索多花約 25 秒。

## ADR-015：Meta 官方 Ad Library API（英國／歐盟）作為另一個 Meta 探索步驟（2026-10-11，狀態：採用，待真實 token 實測）

- 背景：Meta Ad Library 網站擋了 Vercel（HTTP 403），依 ADR-006 不繞過。使用者 2026-10-11 要求 Meta 資料優先、用盡合規方法。官方 Ad Library API（Graph API `/ads_archive`）用 token 認證、從 Vercel 可用、免費、第一手，但只有英國＋歐盟的商業廣告，且沒有商品頁網址、創意變體數與圖片。研究見 `docs/research/meta-ad-library-api.md`。
- 為什麼另寫 ADR 而不是擴充 ADR-014：ADR-014 是「CJ 當作不依賴 Meta 的來源」；這裡是另一個來源（Meta 官方 API），有自己的產品分組規則（沒有商品頁網址）、自己的命名空間與去重決定，也會影響評分（同一則廣告的兩筆紀錄）。分開寫，之後實測修正時才看得出改的是哪個決定。
- 選項：
  - (A) 只「補強」：對網站版已找到的廣告用 `search_page_ids` 補觸及人數（原本的打算）。網站被擋時沒有網站版廣告可補，等於沒有作用。
  - (B) 獨立探索步驟：用本次關鍵字查英國＋歐盟，自己把廣告分組成產品；能對上網站版產品時掛上去。
  - (C) 依國家拆開查詢：國家資訊準確，但請求數 ×6。
- 決定：B（一個關鍵字一次查 6 國）。
  - Runner 新步驟「搜尋 Meta 官方 API（英國／歐盟）」（`meta_api` → `meta_api_finalize`），位置在網站版 Meta 步驟之後、CJ 之前；**不受網站版的退避、每日 3 次上限影響**（不同服務、不同限制）。沒有 `META_ACCESS_TOKEN` 時顯示「未設定」並跳過。
  - 請求：每 run 最多 10 次（一個關鍵字一次，`ad_reached_countries = GB, DE, FR, SE, BE, ES`，`ad_type=ALL`、`ad_active_status=ACTIVE`、`limit=100`、只取第一頁）、間隔 2 秒、**先記帳再送出**、回應先暫存（`pipeline_stage`，bucket `meta_api`），重試的單位不會再問 Meta；不自動重試。
  - 錯誤：190（token 無效）→ 停止、不退避；613／4／17／32／HTTP 429 → 停止並對出口退避（provider `ad_library_api`，與網站版 `ad_library_web` 分開）；其他 4xx → 停止、不退避；5xx／網路 → 記錄、繼續下一個關鍵字。token 只在環境變數，錯誤訊息遮蔽 token、不含網址；不請求 `ad_snapshot_url`（網址含 token）。
  - 產品分組：產品鍵 `meta-api:<link_caption 網域>|<正規化 link_title>`（沿用 `products.landing_key`，命名空間不與 `handle:`、`url:`、`cj:` 重疊）；整則廣告只能有一個網域、一個標題；標題至少 2 個內容字、不是 CTA 或樣板。門檻沿用 `DISCOVERY_RULES`（≥ 2 則廣告或投放 ≥ 14 天）。新產品沒有商品頁網址（`canonical_url` 為空，不猜）。
  - 掛到網站版產品（保守，不確定就不合併）：網站版已存同一個 Library ID → 掛那個產品（分屬多個產品就整組略過）；否則同一店家網域＋同一 handle（優先）或標題 Jaccard ≥ 0.6，而且只有一個候選；多個候選一樣像 → 略過、**也不另建**（避免重複）。
  - 不覆蓋網站版：externalId `api|<Library ID>`，與網站版 `<Library ID>` 分開存。
  - 評分：官方 API 的廣告跟網站版一樣進入廣告特徵（持久度用 `ad_delivery_start_time`／`stop_time`，廣告主用 `page_id`）；以「來源＋Library ID」去重（網站版紀錄為主，API 紀錄補國家、觸及與缺少的日期），廣告動能的每日廣告數 SQL、詳情頁廣告數與廣告列表也去重。觸及人數（`eu_total_reach`、`uk_total_reach`）只存與顯示，**不計分**。
  - 國家：只有 UK 觸及 > 0 時標 `GB`；歐盟國家不標（API 一次查多國時說不出是哪一國），市場覆蓋不高估。
  - 介面：來源標示「Meta 官方 API（英國／歐盟）」；詳情頁廣告列顯示歐盟／英國觸及（沒有就「—」）與觸及說明；同一則廣告兩筆紀錄合併成一列；探索頁新步驟、跳過原因與錯誤說明；網站版被擋／今日已用完的提示加上「官方 API（英國／歐盟）照常」或「未設定 META_ACCESS_TOKEN，加了能換到什麼」。
- 理由：唯一能在 Vercel 上合規取得 Meta 廣告的方式；B 在網站被擋時仍能找到英國／歐盟產品，又不破壞網站版資料。一次查 6 國把請求數控制在每 run 10 次（user token 的速率上限不公開）。
- 後果與限制：
  - 還沒有 token：全部依文件格式的 fixture 測試；`link_caption` 是否真是網域、`total_reach_by_location` 的 JSON 形狀、網站與 API 的 ID 是否相同、多國 `ad_reached_countries` 的行為，都要實測（研究文件第五節）。
  - 示範資料庫複本（fixture 驅動，模擬網站被擋）：沒有官方 API 證據的 206 個產品，評分輸入（子分數原始值、來源、飽和懲罰的輸入、可信度）**完全相同**；分數最多差 0.3 分，來自新產品改變了百分位排名。實測時發現同一店家兩個相似產品會讓網域＋標題比對猶豫，原本會另建一個重複產品 → 改成 handle 相同優先、仍不確定就略過。
  - 美國、加拿大、澳洲、紐西蘭、挪威仍然拿不到；官方 API 建立的產品沒有圖片與商品頁網址。

## ADR-016：照片相同的 Shopify 搜尋結果視為「同款商品」：售價與毛利的第二來源（2026-10-11，狀態：採用）

- 背景：Meta 網站擋了 Vercel，正式站的產品幾乎都來自 CJ（ADR-014）。CJ 產品沒有廣告主商品頁，所以沒有售價、毛利永遠是「—」，只有一個子分數。ADR-012 規定售價只用廣告主自己的商品頁，因為 Shopify 搜尋結果是「同類商品」。研究見 `docs/research/same-photo-listings.md`。
- 選項：
  - (A) 維持 ADR-012：CJ 產品永遠沒有售價與毛利。
  - (B) 用全部搜尋結果的售價中位數：混入不同產品，ADR-012 已否決。
  - (C) 只用「照片與產品自己的照片相同」的搜尋結果（dHash，規則與產品去重相同）：dropshipping 店家通常直接用供應商照片；實測同款距離 1–8、同類多半 ≥ 13。
- 決定：C。
  - `source_items.image_hash`（migration 0012）：runner 新單位 `listing_hash`（產品照片 hash 之後、合併之前），對「產品本身有照片 hash」的 Shopify 搜尋結果下載 256 px 縮圖算 dHash；同一網址只下載一次；每單位 30 張、每次 run 最多 800 張；下載失敗或網址不允許記成 `-`（網址改變時 upsert 會清掉 hash，重新比對）。
  - 同款判定 `isSamePhoto`（`src/matching/same-photo.ts`）：距離 ≤ 2，或 ≤ 8 且標題 Jaccard ≥ 0.25；`MERGE_RULES` 改成同一個常數。
  - 售價 `productRetailPrice`：有廣告主自己的售價就用它；沒有時用同款店家的售價中位數（每家店一筆，優先美國那筆），標示「同款商品售價」與店家數。評分毛利子分數、詳情頁毛利與重點數字、排名頁售價都用同一個函式。
  - 詳情頁證據多一區「其他店家賣的同款商品」（預設展開，附連結可查證）；其餘仍是「同類商品」。
  - 評分 v1.3：「證據太少」上限（50 分）只算需求訊號，毛利不算——便宜好進貨不代表有人買。不然只有 CJ 訂單數＋毛利的產品會從 50 分跳到 79 分（實測）。
  - CJ 供貨價改取規格區間的最高價（原本取最低價，抱枕的「空殼」規格 1.00 USD 讓毛利變成 97%）。
  - 同款店家數只顯示與用於售價，**不計入分數**。
- 理由：第一手、免費、Vercel 上可用（同樣的 Shopify 請求，只多了 CDN 縮圖下載）；售價來自真的在賣同一個產品的店家，比同類商品可信；不確定（照片不同）就不用。
- 後果與限制：
  - 實測 18 個 CJ 產品中 4 個找到同款（5 家店），人工看標題與網址都是同一產品，但樣本小，準確率未驗證；店家修過圖、裁切就認不出（之後照片比對 v2）。
  - 店家很少（1 家）時售價代表性低；售價是店家公開價不是成交價；毛利是運費前（CJ 運費未接）。
  - 不知道店家賣的是哪個規格；供貨價取最高價只保證不高估毛利。

## ADR-017：CJ 規格與運費 → 到岸毛利（2026-10-11，狀態：採用）

- 背景：ADR-016 讓 CJ 產品有了售價，但毛利是「運費前」，供貨價是整個規格區間的最高價。實測（`docs/research/cj-api.md` 第七節）運費常比供貨價高好幾倍（1,300 克抱枕寄美國 15 天內最便宜 36.73 USD，供貨價 9.95），規格區間最高／最低差到 34 倍：運費前毛利會嚴重高估。
- 選項：
  - (A) 用 CJ 規格的平均價、固定運費估計：是推估，違反「不推估」。
  - (B) 只用能確定的規格：全部同價、或與同款店家的選項對得上；對不上就用最貴規格並標示。運費用 CJ 實際試算。
- 決定：B。
  - 規格來自既有的商品詳情（`stanProducts`，0 點）；規則見 `chooseVariant`（`single_price` / `store_options` / `max_variant`），取選定規格中的最高價、最重的規格試算運費。
  - 運費：runner 新單位 `cj_freight`（CJ 步驟收尾之後、Shopify 蒐集之前）：`freightCalculate` 寄到美國、每次探索最多 20 次（10 點／次）、照 CJ 節奏（1.5 秒、限流重送）、同一規格 7 天內沿用、有售價的產品優先；15 天內最便宜的 `totalPostageFee`，沒有就記「沒有 15 天內的物流」。存在新表 `cj_landed_costs`（migration 0013）。
  - 到岸毛利 = 售價 − 規格供貨價 − 運費，缺任何一項就是「—」。評分 v1.4：毛利子分數改用到岸毛利，滿分門檻 60% → 40%（到岸毛利本來就比較低）；負毛利是 0 分。
  - 詳情頁：供貨價附 CJ 規格名稱與依據、寄到美國的運費（物流商、天數、報價日期）、到岸毛利率。
- 理由：第一手（CJ 自己的報價）、不推估、不確定就往不高估的方向取，並把依據寫在畫面上讓使用者查證。
- 後果與限制：
  - 店家選項對規格是字面比對，店家改名（例如 "Large" vs "60cm"）就對不上 → 最貴規格。
  - 只有美國；運費是 CJ 試算價，不含倉庫、退貨與匯率波動；寄送天數是 CJ 的估計。
  - 實測量測：18 個 CJ 產品 18 次試算（180 點）；有毛利的仍是 4 個（受售價限制），到岸毛利 36–53%（運費前 65–93%）；分數不變（4 個都受 50 分上限或到岸毛利仍 ≥ 40%）。
