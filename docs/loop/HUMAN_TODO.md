# 需要你處理的事項

Loop 遇到只有你能做的事（申請金鑰、建立帳號、付費、決策、部署）會寫在這裡，然後繼續做其他項目。
處理完後打勾，把金鑰填進 `.env.local`（不要 commit），下一輪 loop 會自動接手。

## 1. 部署與每日排程（最重要）

- [ ] **啟用每日自動蒐集**：越早開始，越早能驗證評分（廣告動能需要 5 天以上歷史，回測需要 4–8 週）
  1. push 到 GitHub：`git push -u origin main`
  2. GitHub repo → Settings → Secrets and variables → Actions → 新增 secret `DATABASE_URL`（Neon 連線字串，與 Vercel 相同）
  3. Actions 分頁的「Daily pipeline」按 **Run workflow** 先手動跑一次
  - 成果：每天 06:00 UTC 自動探索新產品、補證據、重新評分，開始累積歷史資料
  - 費用：私有 repo 每月 2,000 分鐘免費額度，這個排程每月約 300–450 分鐘，$0
  - 注意：GitHub 是機房 IP，Meta 比較可能擋；被擋時該步驟會失敗並寄信通知，其他步驟照跑
- [ ] 建立 Vercel 專案、加入 Neon 資料庫（步驟見 [`DEPLOY.md`](../DEPLOY.md)；loop 不會 push 或部署）
- [ ] **部署前在 Vercel 設定 `SITE_PASSWORD`**（Production 與 Preview，至少 16 個隨機字元）。Meta 公開網頁資料限個人研究使用（ADR-006、ADR-008），沒設定的話任何人都看得到

## 2. 申請帳號與金鑰（依優先順序，皆免費）

1. [ ] **CJ Dropshipping** → `CJ_API_KEY`：建立帳號 → 安裝「API」app → 個人中心 API → Add API
   - 成果：供應成本、各國運費與運送天數（算毛利），以及 Trending 標記與 90 天銷量（真實銷量訊號）
   - **目前最卡關的金鑰**：已有廣告主實際售價（例：Instant Posture Corrector 64.90 USD），只差供貨成本就能算毛利；毛利是 7 項子分數之一
2. [ ] **Google Cloud 專案 + OAuth client**：下面三個 Google 服務共用
3. [ ] **Google Merchant Center**（需已驗證網站與商品 feed，且達到資格門檻，步驟見下方）
   - 成果：美加英澳紐等 11 國的 Google Shopping 每週／每月熱銷排名與需求變化，目前找到最強的第一手需求訊號
4. [ ] **Pinterest 商業帳號 + 開發者 app** → `PINTEREST_APP_ID`、`PINTEREST_APP_SECRET`
   - 成果：US、CA、GB、AU+NZ 的搜尋趨勢與成長率
5. [ ] **Google Ads 管理員帳號 + developer token**（需申請 Basic access）→ `GOOGLE_ADS_DEVELOPER_TOKEN`
   - 成果：產品關鍵字的月搜尋量與趨勢
6. [ ] **Meta 身分驗證（facebook.com/ID）+ Meta 開發者 app** → `META_ACCESS_TOKEN`
   - 成果：UK + EU 廣告的持續天數、創意變體數、觸及人數（官方 API 獨有）
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
- [ ] **收藏產品的分數變動要不要寄 Email？**（選填，不急）Watchlist 頁已會標出變動 5 分以上的產品。要每天自動寄信的話，建議 [Resend](https://resend.com)（免費方案每月 3,000 封，$0），註冊後把 `RESEND_API_KEY` 與收件信箱 `ALERT_EMAIL_TO` 加進 `.env.local` 與 GitHub Secrets。
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
