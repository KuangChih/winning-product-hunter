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

**資料蒐集規則（ADR-006）**：

- 優先使用官方 API；官方 API 拿不到的資料（例如美國的 Meta / TikTok 廣告），依使用者 2026-10-10 的決定，可以蒐集**公開網頁**（Meta Ad Library 網站、TikTok Creative Center 等）。現階段平台由使用者個人研究使用；若之後對外開放或收費，必須重新評估並記錄 ADR。
- **不可做（任何情況都不做）**：破解或代解 CAPTCHA、繞過反爬或 bot 偵測（含 proxy 輪替、偽造瀏覽器指紋）、用自動化程式輸入帳號密碼登入、蒐集或儲存個人資料。
- 被擋（CAPTCHA、403/429、要求登入）時就停止並退避，記錄在 ingestion_runs，不嘗試繞過。
- 請求要節制：低頻率、隨機間隔、每次執行有總量上限；遵守 robots.txt 之外的蒐集都要在 ADR 記錄理由。

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
- 排程：ingestion 與評分寫成 Node CLI jobs（`src/jobs`），預設由 GitHub Actions 排程執行；Vercel Cron 只做輕量觸發（ADR-003）
- 驗證：Better Auth（ADR-003）；付費：Stripe（後期）
- 測試：Vitest（單元）+ Playwright（E2E）
- 所有機密只透過環境變數，並列在 `.env.example`

## Loop 協定（每一輪都照做）

1. **讀狀態**：`CLAUDE.md`、`docs/loop/ROADMAP.md`、`docs/loop/PROGRESS.md` 最後幾筆、`docs/loop/DECISIONS.md`、`docs/loop/HUMAN_TODO.md`、`git status`、`git log --oneline -10`。檢查 `.env.local` 有哪些變數已設定（只看變數名稱，絕不輸出或記錄值）：使用者補上金鑰後，原本 `[blocked: human]` 的項目就解除封鎖。
2. **修復優先**：若上一輪留下壞掉的 build / 測試失敗 / 未提交的半成品，這一輪先處理它。
3. **選一個任務**：從 ROADMAP 取最上面一個未完成、未被 blocked 的項目。太大就先拆成子項目寫回 ROADMAP，只做第一個。一輪 = 一個可驗證的小增量。
4. **需要時先研究**：涉及外部 API、平台政策、演算法選擇時，先用 WebSearch/WebFetch 查最新官方文件，結論寫成 `docs/research/<主題>.md`，重大選擇寫進 `DECISIONS.md`（ADR 格式：背景／選項／決定／理由）。
5. **實作**：遵守既有程式風格；新功能附測試；外部來源先做 fixture 模式。
6. **驗證（品質閘門，全部通過才算完成）**：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`；動到頁面時加跑 `npm run e2e`。UI 變更要實際啟動 dev server 用瀏覽器檢查。
7. **提交**：`git add` + `git commit`（訊息說明做了什麼與為什麼）。commit message 一律使用台灣慣用的繁體中文，重要關鍵字與專有名詞可保留英文。**不要 push、不要部署**——由使用者決定。
8. **更新狀態**：勾選 ROADMAP、在 PROGRESS.md 追加一筆（日期、完成內容、驗證結果、下一步）。發現新工作就加進 ROADMAP 適當位置。
9. **需要人類的事不要卡住**：API key、帳號、付費、法律判斷等寫進 `docs/loop/HUMAN_TODO.md`，把該項目標成 `[blocked: human]`，改做下一個項目。付費項目必須寫明費用與能換到的具體成果（花錢原則），由使用者決定。
10. **回報**：每輪結束用台灣繁體中文簡短回報：完成了什麼、驗證結果、commit、需要使用者做的事（如果有）。
11. **排下一輪**：還有工作 → `ScheduleWakeup` 約 60–120 秒；全部項目完成或只剩 blocked 項目 → 在 PROGRESS.md 寫總結並停止 loop。

### 防護規則

- 連續 3 輪在同一問題上失敗：停下來，把問題寫進 HUMAN_TODO.md，改做其他項目。
- 不刪除使用者資料、不 force push、不改寫 git 歷史、不修改系統設定。
- 不把真實機密寫進程式碼或 commit。
- 每 10 輪做一次「回顧輪」：重新審視架構、評分方法、技術債，更新 ROADMAP 優先順序。
- 蒐集公開網頁時嚴守「資料蒐集規則」（ADR-006）：被擋就停止退避，不嘗試繞過。

### 已知陷阱（前幾輪踩過的坑）

- Next.js 16 的 API 與訓練資料不同，寫 Next.js 程式前先讀 `AGENTS.md` 與 `node_modules/next/dist/docs/`。
- `package.json` 不是 ESM：用 tsx 執行的腳本不能用 top-level await；CLI job 一律用 `src/jobs/run-job.ts` 的 `runJob`，結束時會關閉資料庫連線（PGlite 不關會讓程序卡住）。
- CLI job 開頭 `import "@/lib/load-env"`，才會跟 Next.js 一樣讀到 `.env.local`。
- PGlite 必須列在 `next.config.ts` 的 `serverExternalPackages`，否則 wasm 路徑會壞掉。
- CSS 或設定改了但畫面沒變：先刪 `.next` 再重啟 dev server；瀏覽器分頁若連著已關閉的 dev server，要重新開頁面。
- 修改 `src/db/schema.ts` 後要 `npm run db:generate` 並 commit `drizzle/`；Vercel 部署時 `vercel-build` 會自動套用 migration。
- 長時間執行的指令加 `timeout`，避免整輪卡住。
