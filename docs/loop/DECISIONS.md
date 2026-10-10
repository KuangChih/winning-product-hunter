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
| 資料來源       | 005、006、007    | 第一手官方 API 優先；美國等市場的廣告用公開網站蒐集；先完成真實資料閉環       |
| 評分與實體對應 | 002、012         | 可解釋的加權子分數；售價只用廣告主自己的商品頁                               |
| 架構           | 003              | Next.js on Vercel + Neon + Drizzle；蒐集與評分是 CLI jobs，由 GitHub Actions 排程 |
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

## ADR-003：整體架構、資料庫、排程與驗證（2026-10-09，狀態：採用）

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

## ADR-006：蒐集 Meta / TikTok 公開廣告網站（2026-10-10，狀態：採用）

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
