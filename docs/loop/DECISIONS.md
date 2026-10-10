# Architecture Decision Records

格式：

```
## ADR-NNN：<標題>（<日期>，狀態：採用 / 取代於 ADR-XXX）
- 背景：
- 選項：
- 決定：
- 理由：
- 後果：
```

## ADR-001：資料來源策略（2026-10-09，狀態：採用）
- 背景：Meta 與 TikTok 的官方廣告 API 只開放 EU/UK 的商業廣告；Google Trends 官方 API 仍為 alpha；Amazon PA-API 5 已停用。合規規則禁止繞過反爬機制。詳見 `docs/research/data-sources.md`。
- 選項：(A) 自建爬蟲抓 Meta/TikTok 美國廣告；(B) 只用官方 API；(C) 官方 API + 授權第三方資料商（Apify、SerpApi、Keepa），把 EU 廣告資料當成代理指標。
- 決定：C。第一批接 Meta Ad Library（EU）、Google（SerpApi：Ads Transparency + Trends）、AliExpress Affiliate；第二批接 TikTok（Commercial Content API / Apify Creative Center）、Keepa、CJ、Shopify `products.json`。
- 理由：A 違反 ToS 且有法律與封鎖風險；B 訊號太少；C 在合規前提下取得最多獨立訊號。
- 後果：adapter 分「來源」與「供應商」兩層；UI 需清楚標示每個訊號的覆蓋範圍；Meta 資料能否用於商業產品需法律確認。

## ADR-002：評分與實體對應方法（2026-10-09，狀態：採用，待回測修正）
- 背景：業界評分公式皆未公開；持續天數只代表存活力不等於獲利；單一來源易偏誤。詳見 `docs/research/scoring.md`。
- 選項：(A) 機器學習模型直接預測；(B) 可解釋的加權子分數 + 佐證/飽和乘數；(C) 只做排序不給分數。
- 決定：B（v0 規格見 scoring.md）。缺資料的子分數不計入並降低信心度；單一來源上限 70 分。實體對應採 dHash/pHash → CLIP 向量（pgvector）→ 規則決策三層漏斗。
- 理由：初期沒有標註資料無法訓練 A；B 透明可驗證，符合差異化定位；累積回測資料後可再引入 A 調權重。
- 後果：ingestion 必須保存不可覆寫的時間序列快照；評分模組要輸出完整拆解；需要 Postgres pgvector 與外部 embedding 計算。

## ADR-003：整體架構、資料庫、排程與驗證（2026-10-09，狀態：採用）
- 背景：Vercel function 上限 Hobby 300 秒、Pro 800 秒（延伸 1800 秒）；Vercel Cron 在 Hobby 只能每天一次、Pro 可每分鐘；評分需要 pgvector 與不可覆寫的時間序列快照（ADR-002）；Auth.js 已於 2025-09 由 Better Auth 團隊接手維護，官方建議新專案用 Better Auth。
- 選項：
  - 資料庫：Neon / Supabase
  - 抓取執行位置：Vercel Cron + function / GitHub Actions 排程 / 獨立 worker 主機（Railway、Fly）
  - 驗證：Better Auth / Clerk / Auth.js
- 決定：
  - **單一 Next.js（App Router）專案**部署在 Vercel，負責 UI 與讀取 API。
  - **Neon Postgres**（Vercel 原生整合、支援 pgvector、preview 分支資料庫）+ Drizzle ORM。資料存取都透過 repository 層，日後要換 Supabase 只改這層。
  - **Ingestion 與評分以 Node CLI 腳本實作**（`src/jobs/*`），同一份程式碼可在三處執行：本機、GitHub Actions 排程（預設，免費、單次最多 6 小時）、Vercel Cron（只做輕量觸發，Hobby 每日一次）。
  - **Better Auth**，使用者與 session 存在自己的 Postgres。權限檢查放在 server component / route handler，不只靠 middleware（CVE-2025-29927 的教訓）。
  - 套件管理用 npm；Node 22 LTS 以上。
- 理由：抓取與 embedding 計算時間不可控，不適合 Vercel function；GitHub Actions 無額外成本、跟 repo 同處；Better Auth 免費、資料自有、Next.js 生態主流。
- 後果：jobs 不能依賴 Next.js runtime；需要 `DATABASE_URL` 與各 API key 同時設定在 Vercel 與 GitHub Secrets；Vercel Hobby 方案的 cron 只能每日，若需更頻繁要升級 Pro 或全交給 GitHub Actions。

## ADR-004：先做端到端垂直切片，再接 live API（2026-10-09，回顧輪 10，狀態：採用）
- 背景：前 9 輪完成研究、骨架、schema、adapter 層與 fixtures。所有 API 金鑰都還沒有，live adapter 寫了也無法驗證真實回應；而實體對應、評分、頁面都還沒開始，schema 與評分設計尚未被實際使用驗證。
- 選項：(A) 照原順序先寫所有 live adapter；(B) 先用 fixtures 打通 蒐集 → 對應 → 評分 → 頁面 的最小版本，再回頭接 live API。
- 決定：B。新增 ROADMAP「Phase 2A」。實體對應 v0 只用文字（fixture 圖片網址是假的，圖片雜湊等真實資料再做）。
- 理由：越早有可展示、可點進去看證據的產品頁，越早發現 schema/評分設計的問題；拿到金鑰後只需替換 adapter 供應商。
- 後果：live adapters 移到垂直切片之後；首頁/探索頁必須清楚標示樣本資料。

## ADR-005：以第一手資料為主、英語系五國優先，移除 AliExpress（2026-10-10，狀態：採用；部分取代 ADR-001）
- 背景：使用者決定目標市場為英語系五國優先（US、CA、UK、AU、NZ），其次歐洲（DE、FR、SE、BE、ES、NO）；要求優先使用第一手資料；Meta 資料可用於付費服務；不使用 AliExpress；花錢必須有實質成果。三份研究：`docs/research/first-party-sources.md`、`suppliers.md`、`store-signals.md`。
- 主要發現：
  - 沒有任何平台提供 US/CA/AU/NZ 商業廣告的官方 API。Meta `/ads_archive` 與 TikTok Commercial Content API 只涵蓋 UK + EU；Google Ads Transparency 的 BigQuery 資料集只涵蓋 EEA（不含 UK）。
  - Meta 公開 Ad Library 網站有美國廣告，但 Meta 條款禁止自動化蒐集（不論是否登入）並禁止轉售蒐集到的資料 → 高風險。
  - SerpApi 抓 Google 頁面（Google v. SerpApi 訴訟仍在進行）、Apify actor 抓平台公開介面、Keepa 自己爬 Amazon；Amazon 官方 API 的政策禁止把資料用於分析或資料販售服務。
  - 可用的第一手來源：Google Merchant API Best sellers（11 國，需 Merchant Center 資格）、Shopify Global Catalog（官方 MCP，early access，可依出貨國家查零售價與販售店家數）、Pinterest Trends API、Google Ads Keyword Planner、Meta/TikTok 官方 API（UK + EU）、CJ Dropshipping API v2（Trending、90 天銷量、各國運費）。
- 決定：
  1. 資料來源改以官方第一手 API 為主（Phase 2B 清單）；中間商（SerpApi、Apify、Keepa）暫不採用，除非某個缺口無法由第一手來源補足且經使用者決定。
  2. 美國等非 UK/EU 市場的廣告訊號，以 Google Merchant Best sellers、Shopify Global Catalog、Pinterest Trends、CJ 銷量補足；不自行爬 Meta/TikTok 公開網站（維持 CLAUDE.md 合規規則，若要改變需使用者明確決定）。
  3. 移除 AliExpress，供應商先接 CJ Dropshipping API v2；Zendrop MCP 實測後再決定；歐洲第二波考慮 BigBuy。
  4. 資料模型加入國家維度，評分可依目標市場加權。
- 後果：ADR-001 的第一批來源（SerpApi、AliExpress）作廢；需要使用者申請 Google Cloud / Merchant Center / Google Ads / Pinterest / Meta / TikTok / CJ / Shopify 開發者帳號；Merchant Center 資格與 Shopify Catalog 使用條款需使用者確認。

## ADR-006：蒐集 Meta / TikTok 公開廣告網站（2026-10-10，狀態：採用；修改 ADR-005 決定 2）
- 背景：官方 API 只提供 UK + EU 的商業廣告，而使用者最優先的市場是 US、CA、AU、NZ。使用者認為 Meta 與 TikTok 的公開廣告網站是最重要的第一手資訊，決定要蒐集；平台初期由使用者個人研究使用。
- 風險（已告知使用者）：Meta 條款禁止自動化蒐集（不論是否登入）並禁止轉售蒐集資料；TikTok 條款禁止 scraping。個人使用降低了商業風險，但條款本身仍適用；可能遭封鎖 IP 或帳號。之後若對外開放或收費，必須重新評估。
- 決定：
  1. 實作 Meta Ad Library 網站與 TikTok Creative Center 的公開頁面蒐集器，美國等英語系市場優先。
  2. 界線：不破解 CAPTCHA、不繞過 bot 偵測（不用 proxy 輪替、不偽造指紋）、不用程式輸入帳密登入、不蒐集個人資料；被擋就停止退避並記錄。
  3. 低頻率、有總量上限；在 GitHub Actions 或使用者電腦執行，不在 Vercel。
  4. 若自建蒐集器長期被擋，再評估 Apify 等付費服務（依花錢原則，先說明能換到的成果再請使用者決定）。
- 後果：CLAUDE.md 的「合規規則」改為「資料蒐集規則」；ROADMAP Phase 2B 新增兩個公開頁面蒐集器。

## ADR-007：先完成真實資料閉環（產品探索 → 真實評分 → 每日排程）（2026-10-10，回顧輪 20，狀態：採用）
- 背景：已接上三個不需金鑰的真實來源（Shopify Global Catalog、Meta Ad Library 公開網站、ECB 匯率），其餘來源都在等使用者申請金鑰。但檢視後發現三個根本缺口：
  1. **沒有產品探索**：系統只會用「既有產品名稱」去搜尋，而既有產品全是樣本資料，真正的新熱賣品進不來——這正是產品的核心功能。
  2. **評分沒用到真實訊號**：真實廣告的同創意數、各國刊登數、Shopify 店家數都還沒進評分。
  3. **沒有每日排程**：回測需要 4–8 週歷史，晚一天開始就晚一天能驗證評分。
- 選項：(A) 照 ROADMAP 順序繼續接其他來源（TikTok 公開頁、Shopify 單一店家）；(B) 先完成「發現 → 評分 → 每日累積」的閉環。
- 決定：B。新增 ROADMAP「Phase 2R」並放在最前面。產品探索 v1 用 Meta Ad Library 公開網站做品類關鍵字掃描，以 landing page 網址分組成候選產品（比標題比對可靠，因為同一商品頁就是同一商品）。
- 理由：閉環完成後，每天自動累積的真實資料本身就是最有價值的資產；之後接上的每個新來源都只是增加訊號。
- 後果：TikTok Creative Center、單一 Shopify 店家查詢順延；需要使用者在 GitHub Secrets 設定 `DATABASE_URL`，並 push repo，排程才會實際執行。

## ADR-008：回顧輪 30——部署前先加站台存取保護（2026-10-10，狀態：採用）
- 背景：真實資料閉環（探索 → 證據 → 評分 → 每日排程 → 健康度）與主要頁面已完成；剩下的資料來源都在等使用者的金鑰或決策。使用者將部署到 Vercel，但 ADR-006 的 Meta 公開網頁資料限個人研究使用，公開網站會讓任何人看到這些資料。
- 檢視：
  - 價值瓶頸不在程式：每日排程尚未啟用（需使用者 push + 設定 secret），動能與回測都無法開始累積；CJ 金鑰是毛利唯一缺口。
  - 技術債：排名查詢會載入全部產品再篩選（目前規模可接受，Phase 6 加 index/分頁）；`vite-tsconfig-paths` 可改用 Vite 內建設定；沒有全站導覽；e2e 只有 4 個。
- 決定：新增 Phase 4A，優先做「站台密碼保護」（`SITE_PASSWORD`；未設定時開放，方便本機開發），再做全站導覽與詳情頁補強。多使用者帳號與付費（Phase 5）延後到要對外營運時。
- 後果：部署前使用者需在 Vercel 設定 `SITE_PASSWORD`（寫入 HUMAN_TODO / DEPLOY.md）。

## ADR-009：Watchlist 先做單一清單（2026-10-10，狀態：採用）
- 背景：網站目前只有使用者本人使用（ADR-008 的站台密碼），還沒有帳號系統。
- 選項：(A) 等 Phase 5 帳號系統完成再做收藏；(B) 先做全站共用的單一收藏清單；(C) 存在瀏覽器 localStorage。
- 決定：B。`watchlist` 資料表以 `product_id` 為主鍵；加入時記下當時分數；dedupe 合併重複產品時，收藏移到存活產品。
- 理由：個人使用不需要多使用者；存在資料庫才能讓每日排程之後寄送分數變動通知，localStorage 做不到。
- 後果：Phase 5 加入帳號時，`watchlist` 要加 `user_id` 並改成複合主鍵，既有資料歸給第一個帳號。

## ADR-010：回顧輪 40——部署前先做安全強化（2026-10-10，狀態：採用）
- 背景：Phase 4A 與 Phase 4 大部分介面已完成（詳情頁毛利、廣告瀏覽、Watchlist、手機版、深色模式）。資料來源與回測仍卡在使用者（push + `DATABASE_URL` secret、`CJ_API_KEY`、TikTok 決策）。
- 檢視：
  - **安全**：站台只靠一組共用密碼（ADR-008），登入沒有次數限制，部署後可被無限次猜密碼；沒有安全標頭，網頁可被嵌入 iframe，也可能被搜尋引擎收錄。Server Actions（例如 Watchlist）以頁面路徑 POST，已在 proxy 保護範圍內。
  - **相依套件**：production `npm audit` 有 7 個 high，全部來自 `shadcn` CLI（braces 的巢狀 glob DoS），網站執行時不會用到 → 移到 devDependencies。
  - **技術債**：`vite-tsconfig-paths` 已可用 Vite 內建功能取代（本輪完成）；排名頁在記憶體篩選，目前規模可接受，設定 2,000 筆門檻。
  - **評分**：v1.1 的 momentum 與回測都需要每日歷史，在每日排程啟用前無法改進；不調整評分。
- 決定：新增 Phase 4B「部署前安全強化」，排在無障礙與 i18n 之前：登入防暴力破解（用既有 Postgres 記錄，不加外部服務）、安全標頭與 noindex。
- 理由：部署由使用者決定、隨時可能發生，安全缺口的代價遠高於介面改善；兩項都不需要金鑰或付費。
- 後果：ROADMAP 新增 Phase 4B；DEPLOY.md 將加入密碼強度建議。

## ADR-011：介面多語系（英文 / 繁體中文）用 `[lang]` 路由 + cookie 改寫（2026-10-10，狀態：採用）
- 背景：使用者用繁體中文，產品目標客群是英語系賣家，兩種語言都需要。Next.js 16 開啟 Cache Components，頁面靠預渲染的靜態外殼加串流。
- 選項：
  - (A) 網址加語言前綴（`/zh-TW/products`），所有內部連結都要帶語言；
  - (B) 不改路由，只用 cookie 決定語言：在 layout 讀 cookie 會讓整個外殼變成動態，失去預渲染；
  - (C) 頁面放在 `app/[lang]`，每種語言各自預渲染；proxy 依 `locale` cookie 把沒有前綴的網址改寫（rewrite）到 `/en/...` 或 `/zh-TW/...`。
- 決定：C。語言用 `next/root-params` 的 `lang()` 在任何 Server Component 取得；字典是 TypeScript 物件，用型別強制每種語言都有同樣的 key。來源資料（廣告文字、產品標題）不翻譯。
- 理由：網址與既有連結都不用改，兩種語言都保有預渲染外殼；直接開 `/zh-TW/...` 也能用（可分享特定語言的連結）。
- 後果：路由檔案移到 `src/app/[lang]/`；新頁面要放在 `[lang]` 底下；切換語言會重新載入頁面（避免客戶端快取到舊語言）。網站目前有密碼保護、不會被 CDN 公開快取，之後若開放公開快取，需確認快取鍵包含改寫後的路徑。

## ADR-012：產品售價只用廣告主自己的商品頁；搜尋結果是「同類商品」（2026-10-10，狀態：採用）
- 背景：Shopify Global Catalog 有兩種資料：(1) 用廣告的 landing URL 查詢廣告主自己的商品頁（`shopify_catalog_lookup`），就是這個產品；(2) 用產品標題搜尋到的商品（`shopify_catalog`），是其他店家的同類商品。原本兩者混在一起，排名表售價、價格篩選、毛利、詳情頁「販售的店家」都把 (2) 當成這個產品。示範資料庫中 (2) 有 3,704 筆（44 個產品），(1) 只有 26 筆（26 個產品）。
- 選項：(A) 維持混用；(B) 有 (1) 用 (1)，沒有時退回 (2) 的中位數；(C) 售價只用 (1)，沒有就顯示「—」，(2) 只用於競爭程度與市場參考。
- 決定：C。
- 理由：核心原則「只用真實資料、不推估」——(2) 的中位數不是這個產品的價格，拿來算毛利或篩價格會誤導；(2) 的店家數仍是有效的競爭訊號（飽和度），但要明確說是「同類商品」。
- 後果：有售價的產品從 43 個降到 26 個（其餘 17 個原本顯示的是同類商品中位數）；Ear Cleaner 從 $30.72（同類中位數）改為 $34.99（廣告主實際售價）。要提高售價覆蓋率，需對更多產品執行 `collect advertiser_stores`（廣告主商品頁查詢）。

