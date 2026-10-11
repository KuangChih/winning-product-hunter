# 需要你處理的事項

Loop 遇到只有你能做的事（申請金鑰、建立帳號、付費、決策、部署）會寫在這裡，然後繼續做其他項目。
處理完後打勾，把金鑰填進 `.env.local`（不要 commit），下一輪 loop 會自動接手。

## 0. 申請 Meta 官方 Ad Library API 權杖 `META_ACCESS_TOKEN`（2026-10-11 新增，最優先）

Meta 網站擋了 Vercel（HTTP 403），我們不繞過。合規又能在 Vercel 上拿到 Meta 廣告的方法只有官方 Ad Library API：探索已經加上「搜尋 Meta 官方 API（英國／歐盟）」步驟（ADR-015），**只差 token**。沒有 token 時這個步驟顯示「未設定」並跳過。

> **2026-10-11 狀態**：`.env.local` 已經有 `META_ACCESS_TOKEN`，但請求回 **code 10「app 沒有 Ad Library API 權限」**。token 本身可用，卡在 app 的權限：請確認第 1 步的身分與所在地確認已經**審核通過**，並且第 3 步是從 [Ad Library API](https://www.facebook.com/ads/library/api/) 頁面的「Access the API」建立／連結這個 app（不是一般的 Create App）。通過後重新產生 token 換進 `.env.local` 與 Vercel，再告訴我；在那之前 loop 不會再做 Meta 官方 API 的項目。

- [ ] 1. 到 [facebook.com/ID](https://www.facebook.com/ID) 完成身分與所在地確認（刊登社會議題／政治廣告用的那一種；審核可能要幾天）。
- [ ] 2. 到 [Meta for Developers](https://developers.facebook.com/) 按 Get Started 建立開發者帳號（同意 Platform Policy）。
- [ ] 3. 回到 [Ad Library API](https://www.facebook.com/ads/library/api/) 按「Access the API」→ My Apps → Create App。
- [ ] 4. 用 [Graph API Explorer](https://developers.facebook.com/tools/explorer/) 選這個 app 產生 User access token，**換成長效 token**（約 60 天過期；過期時探索頁會顯示「Meta 拒絕了存取權杖」，再換一次即可）。
- [ ] 5. 把 token 加進**本機 `.env.local`** 的 `META_ACCESS_TOKEN=`（不要 commit），**也加進 Vercel → Settings → Environment Variables → Production**，然後 Redeploy。
- [ ] 6. 告訴我已經加好：下一輪會先用少量真實請求實測（`docs/research/meta-ad-library-api.md` 第五節：網域欄位、觸及的格式、ID 是否與網站相同），在示範資料庫複本量測新增幾個英國／歐盟產品，再請你在 Vercel 按一次「開始探索」。
- 能換到：Meta 網站被擋時，仍能從**英國＋德國、法國、瑞典、比利時、西班牙**的 Meta 廣告找到正在投放的產品（每次探索最多 10 次請求），並看到 Meta 自己估計的**歐盟／英國觸及人數**（網站版沒有）。已存在的網站版產品會掛上同一則廣告的官方紀錄，不會重複計算。
- 費用：$0。
- 限制：美國、加拿大、澳洲、紐西蘭、挪威的商業廣告官方 API 沒有；官方 API 沒有商品頁網址與圖片，所以產品是用「廣告顯示的網域＋廣告標題」分組，比網站版粗。

## 0.1 在 Vercel 加入 CJ 金鑰（2026-10-11 新增）

Meta 擋了 Vercel（HTTP 403），所以正式站一直沒有產品。現在探索多了「搜尋 CJ 熱銷商品」步驟（ADR-014），Meta 被擋時照常從 CJ 找有訂單的商品。

- [ ] 1. **把 `main` push 到 GitHub**（loop 不會 push）。
- [x] 2. **Vercel → Settings → Environment Variables → Production** 新增 `CJ_API_KEY`（值與 `.env.local` 相同）。（2026-10-11 使用者已設定）
- [ ] 3. **Redeploy**（Deployments → 最新一筆 → Redeploy），讓變數生效；新的資料表 `api_tokens` 會自動建立。
- [ ] 4. 登入 → 「探索」頁 → 按「開始探索」，確認「搜尋 CJ 熱銷商品」步驟是「完成」、「產品」頁出現產品，把結果（或截圖）回報給我。
- 能換到：示範資料庫複本實測，Meta 被擋的情況下一次探索從 CJ 新增 19 個有真實訂單的產品（CJ 訂單數 ≥ 50 且 30 天內有付款），每個都附 CJ 訂單數、上架數、供貨價與 CJ 商品連結。
- 費用：$0（CJ API 免費；每次探索約 550 點＋運費試算最多 200 點，帳號每日 50,000 點）。
- 2026-10-11 之後的更新（同款照片比對、CJ 請求節奏、到岸毛利）都還沒 push：第 1、3、4 步照做即可，新的資料表（`cj_landed_costs` 等）會在部署時自動建立。
- 限制：CJ 的訂單數是 CJ 平台計數（CJ 未公開統計期間），不是整個市場；只有 CJ 證據的產品可信度低、最高 50 分。

## 1. 部署並在網站上取得真實資料（最重要）

網站上的「開始探索」按鈕與每日自動探索都已完成（ADR-013），但**要部署後才知道 Meta 會不會擋 Vercel 的機房 IP**，這件事 loop 沒辦法替你驗證。照順序做（細節見 [`DEPLOY.md`](../DEPLOY.md)）：

- [ ] 1. **把 `main` push 到 GitHub**，Vercel 會自動部署（loop 不會 push 或部署）。還沒建立 Vercel 專案的話，先照 DEPLOY 第 1、2 節匯入 repo 並加入 Neon。
  - 依本機紀錄，GitHub 上的 `main` 停在「資料品質 C」；探索頁、按鈕與介面改版（M4–M7）還沒 push，一般的 `git push` 即可（不需要 force push）。
- [ ] 2. **Vercel → Settings → Environment Variables（Production）**：
  - 新增 `CRON_SECRET`：至少 16 個隨機字元，建議 `openssl rand -hex 32` 產生的 64 字元。
  - 確認 `SITE_PASSWORD` 已設定（至少 16 個隨機字元；Preview 也要設）。**正式站沒設密碼時「開始探索」會拒絕執行**。
  - 確認 `DATABASE_URL` 存在（Neon 整合自動加入）。
- [ ] 3. **確認 Fluid compute 開啟**：Settings → Functions（新專案預設開啟）。不支援 60 秒上限的模式。
- [ ] 4. **重新部署**（Deployments → 最新一筆 → Redeploy），讓新的環境變數生效；migration 會自動套用。
- [ ] 5. 登入網站 → 「探索」頁 → 按**「開始探索」**，等 10–15 分鐘（可以離開頁面）。
- [ ] 6. **回報結果**（截圖或文字都可以）：
  - (a) Meta 有沒有擋：探索頁是否出現「Meta 擋下了這台伺服器」，或「搜尋 Meta 廣告」步驟是失敗 / 已跳過；
  - (b) 段與段的接續有沒有失敗：是否出現「交接給下一段失敗」，或 `/api/pipeline/status` 的 `run.lastKickError` 不是 `null`（特別是 `HTTP 508`）；
  - (c) 最後狀態（完成 / 部分完成 / 失敗）、新增幾個產品，以及「產品」頁有沒有出現產品。
  - 如果 Meta 擋了：Meta 網站搜尋自動退避（不繞過），Meta 官方 API（英國／歐盟，需要第 0 節的 `META_ACCESS_TOKEN`）與 CJ 探索（需要第 0.1 節的 `CJ_API_KEY`）照常。
- [ ] 7. **（2026-10-11 新增）Vercel 上 Meta 回了什麼**：第一次探索顯示「Meta 擋下了這台伺服器」，但舊版程式分不出原因。push 這次的更新並等退避結束（探索頁會寫暫停到幾點）後，再按一次「開始探索」，然後把探索頁「搜尋 Meta 廣告」步驟（或「Meta 擋下了這台伺服器」提示）裡的**「技術細節」整段貼給我**。內容只有 HTTP 狀態、最終網址（不含查詢字串）、頁面標題與幾個是/否標記，沒有個人資料。
  - 能換到：知道是「要求登入 / 驗證碼 / 403 / 429」（真的被擋，美國等市場靠 CJ 探索與 Meta 官方 API（英國／歐盟），或評估付費資料商）還是「頁面沒有內嵌廣告資料」（不算被擋，可能有別的作法），不再用猜的。費用 $0。
- 成果：網站上有真實產品；每天 06:00 UTC（台灣 14:00）左右自動探索新產品、補證據、重新評分（07–09 點的 cron 只負責接續卡住的探索），開始累積評分回測需要的歷史（廣告動能需要 5 天以上、回測需要 4–8 週）。
- 費用：預期在 Vercel Hobby 與 Neon 免費額度內，$0（每天最多 3 次探索、每次最多 40 段 function；實際用量部署後在 Vercel → Usage 確認）。
- 不再需要：GitHub Actions 的每日排程（已移除，只保留手動執行，當作 Meta 擋 Vercel 時的另一個出口）。

**選填（本機示範資料庫，`.data/dev`）**：兩個 repair 指令預設只預覽、不寫入，看完預覽再決定要不要加 `--apply`：

- `npm run repair -- product-images`：有 17 個產品的照片是「同類商品」的（錯圖），套用後改用廣告主自己的照片（複本實測：正確照片 23 → 74、錯圖 17 → 0）。
- `npm run repair -- store-listings`：找出廣告主商品頁紀錄曾被搜尋結果覆蓋的產品（複本預覽 11 個），套用後下次探索會重新查這些商品頁。

## 2. 申請帳號與金鑰（依優先順序，皆免費）

1. [x] **CJ Dropshipping** → `CJ_API_KEY`（2026-10-11 已提供，本機 `.env.local`；Vercel 見第 0.1 節）
   - 已接上：CJ 探索步驟、CJ 訂單數與上架數、供貨價（ADR-014、`docs/research/cj-api.md`）。運費試算（到岸毛利）還沒接。
   - [ ] **CJ 服務條款確認**：API 資料（供貨價、訂單數）目前只給你個人研究使用；若之後對外開放或收費，要先讀 CJ Terms of Service 中關於 API 資料展示給第三方的條款，或寄信 `developer@cjdropshipping.com` 確認。
2. [ ] **Google Cloud 專案 + OAuth client**：下面三個 Google 服務共用
3. [ ] **Google Merchant Center**（需已驗證網站與商品 feed，且達到資格門檻，步驟見下方）
   - 成果：美加英澳紐等 11 國的 Google Shopping 每週／每月熱銷排名與需求變化，目前找到最強的第一手需求訊號
4. [ ] **Pinterest 商業帳號 + 開發者 app** → `PINTEREST_APP_ID`、`PINTEREST_APP_SECRET`
   - 成果：US、CA、GB、AU+NZ 的搜尋趨勢與成長率
5. [ ] **Google Ads 管理員帳號 + developer token**（需申請 Basic access）→ `GOOGLE_ADS_DEVELOPER_TOKEN`
   - 成果：產品關鍵字的月搜尋量與趨勢
6. [ ] **Meta 身分驗證（facebook.com/ID）+ Meta 開發者 app** → `META_ACCESS_TOKEN`：已移到第 0 節（最優先），探索步驟已寫好（ADR-015）。
7. [ ] **TikTok for Developers + Commercial Content API 申請**（需審核）→ `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`
   - 成果：UK + EU 的 TikTok 廣告資料
8. [ ] **Google Trends API alpha 申請**（審核時間不定，先申請放著）

### Google Merchant Center 申請步驟

你已經有 Shopify 商店，最簡單的方式是透過 Shopify 的 **Google & YouTube** app：

1. 確認商店符合條件：有設定付款方式、沒有設商店密碼、有退款政策與服務條款頁、有聯絡資訊。
2. 在 Shopify App Store 安裝 **Google & YouTube**（Google LLC 出品）。
3. 在 app 裡用 Google 帳號登入，選「建立新的 Merchant Center 帳號」，商店網域會自動驗證與認領。
4. 商品會自動同步到 Merchant Center，到 [merchants.google.com](https://merchants.google.com) 確認已核准。
5. 在 Merchant Center 找 **Best sellers**（市場洞察）報表，確認看得到。Google 沒有公開資格門檻；第三方說可能需要有在跑 Shopping 廣告，看不到請告訴我。
6. 看得到之後再做 API 串接（我會帶你做）：在同一個 Google Cloud 專案啟用 **Merchant API**，用管理員帳號完成一次性的開發者註冊（`registerGcp`）。

## 3. 需要你決定

- [ ] **TikTok 資料要怎麼取得？**（見 [`tiktok-creative-center.md`](../research/tiktok-creative-center.md)）公開的 Creative Center 需要頁面簽章、且沒有商品網址，自建蒐集器價值低。
  - A. 只申請官方 Commercial Content API（免費，僅 UK + EU，需審核）——上方第 7 項
  - B. 另外付費用 Apify 的 TikTok actor 取得美國資料（約 $1.5–5 / 1,000 筆）：可換到美國 TikTok 熱門廣告與 TikTok Shop 商品銷量，補「社群互動」這項目前完全沒資料的訊號
  - 建議：先 A；真實資料累積兩週、確認評分缺口後再評估 B
- [ ] **收藏產品的分數變動要不要寄 Email？**（選填，不急）Watchlist 頁已會標出變動 5 分以上的產品。要每天自動寄信的話，建議 [Resend](https://resend.com)（免費方案每月 3,000 封，$0），註冊後把 `RESEND_API_KEY` 與收件信箱 `ALERT_EMAIL_TO` 加進 `.env.local` 與 Vercel 環境變數。
  - 成果：每日排程跑完後，收藏產品分數大幅變動時自動收到 Email

## 4. 暫不需要（之後視成果再決定）

- Zendrop（MCP 實測需帳號，可能需 Pro 方案約 $49–59/月）：CJ 接好後再評估
- StoreLeads Pro（$250/月起）：只有美加澳紐的店家資料明顯不足時，才考慮買一個月
- SerpApi、Apify、Keepa：屬於中間商，依 ADR-005 暫不採用

## 已完成

- [x] Meta Ad Library 資料可用於付費服務（2026-10-10 確認）
- [x] CJ Dropshipping 可以使用（2026-10-10 確認）
- [x] 蒐集 Meta / TikTok 公開廣告網站（2026-10-10 決定，界線見 ADR-006）
- [x] 有自己的 Shopify 商店，認定個人研究使用不違反條款（2026-10-10）
- [x] Shopify Global Catalog：實測不需帳號或金鑰即可使用，已串接（部署後改用自己的 agent profile）
