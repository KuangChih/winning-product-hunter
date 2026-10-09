# Winning Product Hunter — 專案指南（給 Claude Code）

這個專案由 Claude Code 透過 `/loop` 自主迭代開發。每一輪都必須先讀這份檔案，再依照「Loop 協定」工作。

## 產品目標

一個給 Dropshipping 賣家使用的 SaaS 網站，**客觀地**找出「當下真正正在熱賣」的產品，部署在 Vercel。

核心原則：

- **證據優先**：每個被標為熱賣的產品，都要能顯示「為什麼」——來源、原始訊號、時間序列，使用者可以點進去驗證（例如原始廣告連結）。
- **多來源交叉驗證**：單一來源的熱度不可信。分數需要跨來源佐證（廣告、社群、搜尋、市集）。
- **看速度，不只看總量**：「正在變熱」比「曾經很熱」更有價值；同時要對「已飽和」做懲罰。
- **不捏造資料**：沒有真實資料時用明確標示為 mock/fixture 的資料，UI 上也要標示，絕不把假資料當真的呈現給使用者。

## 資料來源（初始假設，loop 需研究並以 ADR 修正）

| 來源            | 可能的取得方式                                                                   | 訊號                                                 |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Meta Ad Library | 官方 Ad Library API（商業廣告覆蓋範圍有限，主要 EU/DSA）、授權第三方資料商       | 廣告投放天數、同產品廣告變體數、投放廣告主數量、地區 |
| TikTok          | Creative Center Top Ads / Top Products、Commercial Content API、授權第三方資料商 | 觀看/按讚/分享速度、CTR 排名、熱門 hashtag           |
| Google          | Ads Transparency Center、Google Trends、Shopping 結果（經由 SerpApi 等授權 API） | 搜尋趨勢斜率、廣告主數量                             |
| 市集            | Amazon Best Sellers / Movers & Shakers、AliExpress 聯盟 API、CJ Dropshipping API | BSR 變化、訂單數成長、供貨價格                       |
| Shopify 店家    | 公開的 `/products.json`、商店偵測                                                | 新品上架、跨店重複販售                               |

**合規規則（不可違反）**：優先使用官方 API 與授權資料商；遵守各平台 ToS 與 robots.txt；不繞過登入牆、CAPTCHA 或反爬機制；不儲存個人資料。若某來源只能靠違反 ToS 取得，就記錄在 ADR 中並改用替代方案。

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

1. **讀狀態**：`CLAUDE.md`、`docs/loop/ROADMAP.md`、`docs/loop/PROGRESS.md` 最後幾筆、`docs/loop/DECISIONS.md`、`git status`、`git log --oneline -10`。
2. **修復優先**：若上一輪留下壞掉的 build / 測試失敗 / 未提交的半成品，這一輪先處理它。
3. **選一個任務**：從 ROADMAP 取最上面一個未完成、未被 blocked 的項目。太大就先拆成子項目寫回 ROADMAP，只做第一個。一輪 = 一個可驗證的小增量。
4. **需要時先研究**：涉及外部 API、平台政策、演算法選擇時，先用 WebSearch/WebFetch 查最新官方文件，結論寫成 `docs/research/<主題>.md`，重大選擇寫進 `DECISIONS.md`（ADR 格式：背景／選項／決定／理由）。
5. **實作**：遵守既有程式風格；新功能附測試；外部來源先做 fixture 模式。
6. **驗證（品質閘門，全部通過才算完成）**：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`；動到頁面時加跑 `npm run e2e`。UI 變更要實際啟動 dev server 用瀏覽器檢查。
7. **提交**：`git add` + `git commit`（訊息說明做了什麼與為什麼）。commit message 一律使用台灣慣用的繁體中文，重要關鍵字與專有名詞可保留英文。**不要 push、不要部署**——由使用者決定。
8. **更新狀態**：勾選 ROADMAP、在 PROGRESS.md 追加一筆（日期、完成內容、驗證結果、下一步）。發現新工作就加進 ROADMAP 適當位置。
9. **需要人類的事不要卡住**：API key、帳號、付費、法律判斷等寫進 `docs/loop/HUMAN_TODO.md`，把該項目標成 `[blocked: human]`，改做下一個項目。
10. **排下一輪**：還有工作 → `ScheduleWakeup` 約 60–120 秒；全部項目完成或只剩 blocked 項目 → 在 PROGRESS.md 寫總結並停止 loop。

### 防護規則

- 連續 3 輪在同一問題上失敗：停下來，把問題寫進 HUMAN_TODO.md，改做其他項目。
- 不刪除使用者資料、不 force push、不改寫 git 歷史、不修改系統設定。
- 不把真實機密寫進程式碼或 commit。
- 每 10 輪做一次「回顧輪」：重新審視架構、評分方法、技術債，更新 ROADMAP 優先順序。
