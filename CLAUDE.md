# Winning Product Hunter — 專案指南（給 Claude Code）

這個專案由 Claude Code 透過 `/loop` 自主迭代開發。每一輪都必須先讀這份檔案，再依照「Loop 協定」工作。

## 產品目標

一個給 Dropshipping 賣家使用的 SaaS 網站，**客觀地**找出「當下真正正在熱賣」的產品，部署在 Vercel。

核心原則：

- **證據優先**：每個被標為熱賣的產品，都要能顯示「為什麼」——來源、原始訊號、時間序列，使用者可以點進去驗證（例如原始廣告連結）。
- **多來源交叉驗證**：單一來源的熱度不可信。分數需要跨來源佐證（廣告、社群、搜尋、市集）。
- **看速度，不只看總量**：「正在變熱」比「曾經很熱」更有價值；同時要對「已飽和」做懲罰。
- **不捏造資料**：沒有真實資料時用明確標示為 mock/fixture 的資料，UI 上也要標示，絕不把假資料當真的呈現給使用者。

使用者決策（2026-10-10）：

- **目標市場**：全球，優先英語系五國（美國、加拿大、英國、澳洲、紐西蘭），其次歐洲（德國、法國、瑞典、比利時、西班牙、挪威）。地區相關功能與資料來源以英語系五國優先。
- **第一手資料優先**：優先從源頭取得資料（平台本身），中間商（SerpApi、Apify、Keepa 等）只在源頭無法取得時使用，並記錄理由。
- **花錢原則**：必要開銷可以花，但每項付費服務都要說明能換到什麼實質成果，沒有成果就不花。付費項目一律寫進 HUMAN_TODO 讓使用者決定。
- **Meta Ad Library 資料**：使用者確認可用於付費服務。
- **Meta / TikTok 公開廣告網站**：使用者決定要蒐集（美國等非 UK/EU 市場唯一的廣告來源），規則見下方「資料蒐集規則」。
- **Shopify**：使用者有自己的 Shopify 商店，認定個人研究使用不違反條款；讀取其他店家公開頁面時仍遵守節制規則。
- **供應商**：CJ Dropshipping 已確認可用。
- **供應商**：不使用 AliExpress（對 dropshipping 已過時），改用目前最熱門、有 API / MCP 的供應商平台（見 `docs/research/suppliers.md`）。

## 資料來源（初始假設，loop 需研究並以 ADR 修正）

| 來源            | 可能的取得方式                                                                   | 訊號                                                 |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Meta Ad Library | 官方 Ad Library API（商業廣告覆蓋範圍有限，主要 EU/DSA）、授權第三方資料商       | 廣告投放天數、同產品廣告變體數、投放廣告主數量、地區 |
| TikTok          | Creative Center Top Ads / Top Products、Commercial Content API、授權第三方資料商 | 觀看/按讚/分享速度、CTR 排名、熱門 hashtag           |
| Google          | Ads Transparency Center、Google Trends、Shopping 結果（經由 SerpApi 等授權 API） | 搜尋趨勢斜率、廣告主數量                             |
| 市集            | Amazon Best Sellers / Movers & Shakers、AliExpress 聯盟 API、CJ Dropshipping API | BSR 變化、訂單數成長、供貨價格                       |
| Shopify 店家    | 公開的 `/products.json`、商店偵測                                                | 新品上架、跨店重複販售                               |

**資料蒐集規則（ADR-006；執行地點與上限見 ADR-013）**：

- 優先使用官方 API；官方 API 拿不到的資料（例如美國的 Meta / TikTok 廣告），依使用者 2026-10-10 的決定，可以蒐集**公開網頁**（Meta Ad Library 網站、TikTok Creative Center 等）。現階段平台由使用者個人研究使用；若之後對外開放或收費，必須重新評估並記錄 ADR。
- **不可做（任何情況都不做）**：破解或代解 CAPTCHA、繞過反爬或 bot 偵測（含 proxy 輪替、偽造瀏覽器指紋）、用自動化程式輸入帳號密碼登入、蒐集或儲存個人資料。
- 被擋（CAPTCHA、403/429、要求登入）時就停止並退避，記錄在 ingestion_runs，不嘗試繞過。
- 請求要節制：低頻率、隨機間隔、每次執行有總量上限；遵守 robots.txt 之外的蒐集都要在 ADR 記錄理由。
- 目前的實作（ADR-013）：pipeline 可在 Vercel、本機、GitHub Actions（手動）執行；Meta 請求間隔 5 秒（跨 tick 也成立，先記帳再送出）、每次 run 最多 70 個、每個 UTC 日最多 3 次 Meta 掃描；被擋時依出口（`vercel` / `github` / `local`）退避 6 → 12 → 24 小時…最多 7 天。

## 評分方法（初始假設，需研究、回測、以 ADR 修正）

`Winning Score (0–100)` = 加權組合：

- **廣告持久度**：廣告持續投放越久 → 越可能有獲利（賠錢的廣告會被關掉）
- **擴量訊號**：近 7/14 天新增的廣告變體數、新廣告主數
- **社群互動速度**：互動數的成長率（而非總量）
- **需求趨勢**：Google Trends 斜率
- **市集佐證**：BSR 上升、訂單數成長
- **跨來源佐證加成**：出現在越多獨立來源加分越多
- **飽和懲罰**：廣告主過多 / 存在太久 → 扣分
- **利潤可行性**：供貨價 vs 售價的毛利空間

最難的技術問題是**跨來源的產品實體對應（entity resolution）**：同一產品在不同廣告/商店有不同標題與圖片。預期需要圖片感知雜湊 + 文字向量 + 規則的組合。

## 技術棧（預設，可經 ADR 變更）

- Next.js 16（App Router，`cacheComponents` 開啟）+ TypeScript（strict）+ Tailwind v4 + shadcn/ui。**寫 Next.js 程式前先讀 `AGENTS.md`**：這版 API 與訓練資料不同，以 `node_modules/next/dist/docs/` 為準
- Neon Postgres（含 pgvector）+ Drizzle ORM
- 資料抓取：每個來源一個 adapter，統一介面，皆支援 `fixture` 模式（無 API key 也能開發與測試）
- 排程：整條 pipeline 是可續跑的 runner（`src/pipeline/runner`，ADR-013）。正式環境在 Vercel 分段執行：`/discover` 的「開始探索」按鈕 + Vercel Cron（`vercel.json` 06–09 UTC 4 個，第 1 個開始、其餘恢復）；CLI（`npm run pipeline`）用同一個 runner；GitHub Actions 只保留手動執行
- 驗證：Better Auth（ADR-003）；付費：Stripe（後期）
- 測試：Vitest（單元）+ Playwright（E2E）
- 所有機密只透過環境變數，並列在 `.env.example`

## Loop 協定（每一輪都照做）

### 核心原則（使用者 2026-10-10 要求，優先於其他考量）

1. **目標是「客觀、實質地找到爆品」**，不是功能數量。選任務時的價值順序：
   1. 資料真實與正確（壞掉的蒐集、錯誤的數字、誤導的顯示）
   2. 找爆品的能力：產品探索（找得到、找得早）、真實銷量訊號、產品比對、評分可信度與回測
   3. 介面、文件、其他
2. **誠實原則**：
   - 只顯示真實蒐集到的資料；沒有資料顯示「—」或明確說明缺什麼，**絕不推估補值**、不把樣本資料當真的。
   - 每個訊號要標示可信度等級（實際訂單 / 排名 / 公開計數 / 店家自報），店家可自行操控的數字（評分、評論數）不得計入分數。
   - 回報時講清楚限制、未驗證的假設、做不到的事；不誇大成果。
3. **成效要量得出來**：影響探索、比對、評分的改動，必須在真實資料（示範資料庫或使用者提供的 Neon）上量出改動前後的數字（例如新產品數、合併數與準確率、高分產品數），寫進 PROGRESS；量不到就說明原因與之後怎麼量。

### 每一輪的步驟

1. **讀狀態**：`CLAUDE.md`、`docs/loop/ROADMAP.md`、`docs/loop/PROGRESS.md` 最後幾筆、`docs/loop/DECISIONS.md`、`docs/loop/HUMAN_TODO.md`、`git status`、`git log --oneline -10`。檢查 `.env.local` 有哪些變數（只看名稱，絕不輸出或記錄值）；使用者補上金鑰就解除對應的 `[blocked: human]` 項目。
2. **修復優先**：上一輪留下壞掉的 build、失敗的測試或未提交的半成品，先處理。
3. **選一個任務**：從 ROADMAP 取最上面一個未完成、未 blocked 的項目（目前 Phase 4C 最優先）。太大就拆成子項目寫回 ROADMAP，只做第一個。一輪 = 一個可驗證的小增量。發現某項其實被資料量、金鑰或決策卡住，就標上 `[blocked: …]` 並寫明原因，改做下一項。
4. **先研究再實作**：新資料來源、平台政策、演算法選擇，先查最新官方文件；新來源要先用少量真實請求實測回應（遵守 ADR-006），把實測結果、限制、可信度寫成 `docs/research/<主題>.md`；重大選擇寫 ADR（背景／選項／決定／理由）。
5. **實作**：遵守既有程式風格與「已知陷阱」；新功能附測試；外部來源保留 fixture 測試，但正式流程只用真實資料。
6. **驗證（全部通過才算完成）**：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`；動到頁面加跑 `npm run e2e` 並用瀏覽器實測（中英文都看），檢查 dev server log 沒有新錯誤。e2e 偶發失敗先重跑確認，連續失敗才當成問題。
7. **量測成效**：依核心原則 3，在真實資料上跑一次並記錄數字。
8. **提交**：`git add` + `git commit`，訊息用台灣繁體中文（專有名詞可保留英文），說明做了什麼與為什麼。**不要 push、不要部署**。
9. **更新狀態**：勾選 ROADMAP；PROGRESS.md 追加一筆（完成內容、成效數字、驗證結果、限制、下一步）。發現新工作就加進 ROADMAP 適當位置。
10. **需要使用者的事不要卡住**：金鑰、帳號、付費、決策寫進 HUMAN_TODO，附上「能換到什麼具體成果」與費用（花錢原則），把項目標成 `[blocked: human]`，改做下一項。
11. **回報**（台灣繁體中文，簡短、白話）：做了什麼 → 在真實資料上的效果（數字）→ 驗證結果與 commit → 限制或風險 → 需要使用者做的事（沒有就說沒有）。
12. **排下一輪**：使用者在對話中提出的要求優先處理；還有可做的項目 → `ScheduleWakeup` 約 60–120 秒；只剩 blocked 項目 → 在 PROGRESS.md 寫總結（完成了什麼、卡在哪、使用者做哪幾件事能解鎖）並停止 loop。

### 防護規則

- 連續 3 輪在同一問題上失敗：停下來，把問題寫進 HUMAN_TODO.md，改做其他項目。
- 不刪除使用者資料、不 force push、不改寫 git 歷史、不修改系統設定。
- 不把真實機密寫進程式碼或 commit；連線字串只能用環境變數。
- 每 10 輪做一次「回顧輪」：除了架構與技術債，必須回答「這個工具現在能不能客觀找到爆品？」——看探索成效、資料可信度、評分回測的數字，據此調整 ROADMAP 優先順序並寫 ADR。
- 蒐集公開網頁時嚴守「資料蒐集規則」（ADR-006）：被擋就停止退避，不嘗試繞過。

### 已知陷阱（前幾輪踩過的坑）

- Next.js 16 的 API 與訓練資料不同，寫 Next.js 程式前先讀 `AGENTS.md` 與 `node_modules/next/dist/docs/`。
- `package.json` 不是 ESM：用 tsx 執行的腳本不能用 top-level await；CLI job 一律用 `src/jobs/run-job.ts` 的 `runJob`，結束時會關閉資料庫連線（PGlite 不關會讓程序卡住）。
- CLI job 開頭 `import "@/lib/load-env"`，才會跟 Next.js 一樣讀到 `.env.local`。
- PGlite 必須列在 `next.config.ts` 的 `serverExternalPackages`，否則 wasm 路徑會壞掉。
- CSS 或設定改了但畫面沒變：先刪 `.next` 再重啟 dev server；瀏覽器分頁若連著已關閉的 dev server，要重新開頁面。
- 串流頁面（Suspense）用 `get_page_text` 可能只讀到 fallback（例如「Loading…」），內容其實已經渲染；以截圖或 `find` 確認，不要誤判成卡住。瀏覽器視窗在背景時 `innerText` 也可能只有 fallback，改用 `textContent` 或 `find`。
- 修改 `src/db/schema.ts` 後要 `npm run db:generate` 並 commit `drizzle/`；Vercel 部署時 `vercel-build` 會自動套用 migration。
- 長時間執行的指令加 `timeout`，避免整輪卡住。
- 單元測試出現大量剛好 20 秒的 timeout（PGlite 測試）：多半是同時啟動太多 PGlite，不是程式錯誤；`vitest.config.mts` 已設 `maxWorkers: "50%"`，不要拿掉。
- Cache Components 開啟時，客戶端元件用到 `usePathname` / `useSearchParams` 等 URL 資料必須包在 `<Suspense>` 裡（給一個不依賴 URL 的 fallback），否則動態路由會報「blocking-prerender-client-hook」。
- `generateMetadata` 讀資料庫前也要先 `await connection()`（跟頁面本體一樣），否則 dev log 會出現「blocking-prerender-current-time」（`Date.now()` while prerendering）。e2e 全綠也要看 `[WebServer]` 有沒有這類錯誤。
- 在 Windows 用 Python 改檔時，文字模式寫入會把換行變成 CRLF：用 `io.open(..., newline="
")`，或改完跑 `npx prettier --write`；用 `newline=""` 讀 CRLF 檔時，比對字串要含 `
`。能用 Edit 工具就用 Edit。
- Proxy matcher 的單元測試：文件寫 `unstable_doesProxyMatch`，但目前版本實際匯出的是 `unstable_doesMiddlewareMatch`（`next/experimental/testing/server`）。
- 頁面路由在 `src/app/[lang]/`（ADR-011）：新頁面放這裡、`PageProps<"/[lang]/...">`；Server Component 用 `getLocale()` / `getDictionary()`（`src/i18n`）取語言與字串，連結維持不帶語言前綴（proxy 依 cookie 改寫）；客戶端元件的字串由伺服器端以 props 傳入。
- dev server 剛啟動時若同時收到兩個請求（例如 preview 工具的 HEAD 探測加上瀏覽器的 GET），log 可能出現一次 `SyntaxError: Unexpected end of JSON input`（page `/en`）並回 500，之後都正常；這是 dev 首次編譯的競態，`next start` 同時打 6 個冷請求都是 200。看到時重新整理一次確認即可，不要當成程式錯誤。同類的 dev 偶發：e2e 平行跑時，偶爾一個沒帶語言 cookie 的請求拿到 `lang="zh-TW"`；`next start` 同時送 24 個中英文混合請求全部正確。e2e 偶發失敗時先重跑確認，連續失敗才當成真問題。
- 程式碼含反斜線（regex 如 `\s`、`\d`、`\\`）時，**不要**用 bash heredoc + node 字串取代去寫檔，反斜線會被吃掉；改用 Write / Edit 工具，寫完用 grep 確認。
- e2e 固定 4 個 worker（`playwright.config.ts`）：所有 worker 共用一個 `next start`，PGlite 與 SSR 在同一條執行緒，預設 10 個 worker 會讓它飽和、頁面停在載入畫面超過 5 秒（M5 查明，10 個並沒有比 4 個快）。不要調高。跑 e2e 時用 `DATABASE_URL=pglite:<示範資料庫複本>` 覆蓋，收藏的測試會寫入資料庫。
- 資料庫連線（`getDb`）必須放在 `globalThis`，不能只放模組變數：Next.js 把頁面和 route handler 分開打包，各有一份模組。用 PGlite 時兩份會把同一個目錄開成兩個互不相通的記憶體資料庫，頁面就看不到 route（例如探索的 tick）寫進去的資料，要重啟才會出現。
- Route handler（`src/app/api/**`）**不可 import `src/jobs/*`**：jobs 在 import 時會載入 `.env.local`（`load-env`）並由 `runJob` 結束時關閉資料庫連線。共用邏輯放在 `src/pipeline/*`（例如 `targets.ts`、`live-deps.ts`、`web.ts`），jobs 從那裡 re-export。
- `/api/internal/*`（tick 接續、Vercel Cron）被 `src/proxy.ts` 的 matcher 排除、不經網站密碼，各自檢查 Bearer token（`src/lib/internal-auth.ts`）；新增內部 route 一定要先驗證 token、失敗回 401/503（fail closed）。其他 `/api/*` 未登入時 proxy 回 401 JSON，不轉址、不做語言改寫。
- Tick 預算維持 120–250 秒（預設 200 秒）：預算 + 50 秒硬中止必須小於 Vercel 的 300 秒上限，一個 Meta 單位最長 45 秒、collect 單位 60 秒；調低會讓每個 tick 只做一個單位、撞到 40 個 tick 上限。測試或本機量測要強制分段時才用小預算。
- 本機量測 pipeline 或跑 e2e 一律用示範資料庫的**複本**（`DATABASE_URL=pglite:<複本路徑>`），不要直接寫 `.data/dev`；e2e 伺服器設了 `PIPELINE_DISABLED=1`，不會送出真實請求。
- CJ API（ADR-014、`docs/research/cj-api.md`）跟文件不一樣：`productDetail/query` 欄位全小寫、文件寫的 90 天銷量 `soldOut` 實測全是 null（用 `orderCount`，期間未公開）、`listV2` 的 `createAt` 是 null（上架時間在詳情的 `createdate` 字串）。`getAccessToken` 有頻率限制：token 存在 `api_tokens`（加密）重複使用，**不要**在測試或腳本裡反覆向 CJ 取 token；本機量測用複本時第一次會取一次。CJ 每秒 1 次是 CJ 那邊算的、取 token 也算：請求一律經 `createCjClient` 的 `beforeRequest`（runner 的 `counted` 依送出時間間隔 1.5 秒）；`1600200` 是當下的限流，重送即可、不要退避（只有點數用完才退避）。
- Meta 廣告有兩種紀錄（ADR-015）：網站版 `externalId = <Library ID>`（provider `ad_library_web`）、官方 API `externalId = api|<Library ID>`（provider `ad_library_api`）。同一則廣告兩筆都會存；計算廣告數、廣告主、持久度或列表時要依「來源＋Library ID」去重（`dedupeAds`、`dedupeAdRecords`、`metaLibraryId`），不要用 `source_items.id` 直接數。官方 API 不要請求或儲存 `ad_snapshot_url`（網址含 token）。
- Shopify 搜尋結果（`shopify_catalog`）是「同類商品」，只有照片與產品照片相同（`isSamePhoto` / `samePhotoOf`，`source_items.image_hash`）的才算同一個產品（ADR-016）。售價一律用 `productRetailPrice`（廣告主售價 → 同款店家中位數），不要自己挑 provider 算售價。`image_hash = "-"` 代表照片不能用，判斷前用 `isPhotoHash`（`hammingDistance` 會把短字串補 0，`"-"` 會被當成全 0）。Postgres 沒有 `min(uuid)`，需要時轉 `::text`。CJ 價格是規格區間，`parseCjPriceCents` 取最高價（不高估毛利）。毛利一律是到岸毛利（ADR-017）：售價 − `cj_landed_costs` 的規格供貨價 − 運費，用 `landedMargin`，缺一項就是 null，不要拿運費前的數字當毛利。
