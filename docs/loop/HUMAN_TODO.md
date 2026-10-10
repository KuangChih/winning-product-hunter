# 需要你處理的事項

Loop 遇到只有你能做的事（申請 API key、建立帳號、付費、法律判斷、部署）會寫在這裡，並繼續做其他項目。
處理完後把項目打勾，並把金鑰填進 `.env.local`（不要 commit），下一輪 loop 會自動接手。

## 部署

- [ ] 建立 Vercel 專案並連結 GitHub repo（loop 不會 push 或部署，步驟見 `docs/DEPLOY.md`）
- [ ] 在 Vercel 加入 Neon 資料庫（會自動設定 `DATABASE_URL`）
- [ ] **啟用每日自動蒐集**（最重要：越早開始，越早能驗證評分）
  1. push 到 GitHub：`git push -u origin main`
  2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret：名稱 `DATABASE_URL`，值為 Neon 的連線字串（與 Vercel 上的相同）
  3. 到 Actions 分頁的「Daily pipeline」按 **Run workflow** 先手動跑一次確認
  - 成果：之後每天 06:00 UTC 自動探索新產品、補 Shopify 證據並重新評分，開始累積回測需要的歷史資料
  - 費用：私有 repo 每月有 2,000 分鐘免費額度，這個排程每次約 10–15 分鐘，每月約 300–450 分鐘，在免費額度內
  - 注意：GitHub 的伺服器是機房 IP，Meta 比較可能擋；被擋時該步驟會失敗並寄信通知你，其他步驟照跑

## 需要你決定

- [x] Meta Ad Library 資料可用於付費 SaaS（2026-10-10 確認）
- [x] CJ Dropshipping 可以使用（2026-10-10 確認）
- [x] 要蒐集 Meta / TikTok 公開廣告網站（2026-10-10 決定，界線見 ADR-006）
- [x] 使用者有 Shopify 商店，認定個人研究使用不違反條款（2026-10-10）
- [ ] 申請 Google Merchant Center（步驟見下方「Google Merchant Center 申請步驟」）

## 申請帳號與金鑰（依優先順序）

每一項都列出能換到的成果。全部都是免費帳號，除非另外註明。

1. [ ] **CJ Dropshipping**（免費）：建立帳號 → 安裝「API」app → Add API → `CJ_API_KEY`
   - 成果：每個產品的供應成本、各國運費與運送天數（算毛利），以及 Trending 標記與 90 天銷量（需求訊號）。
2. [x] ~~Shopify 開發者帳號 + agent profile~~：Global Catalog 實測不需要帳號或金鑰即可使用（2026-10-10），已串接。部署到 Vercel 後我會改用我們自己的 agent profile。
   - 成果：各國的零售價中位數（算毛利）、有幾家店在賣（飽和度）、店家網域。
3. [ ] **Google Cloud 專案 + OAuth client**（免費）：後面三個 Google 服務共用
4. [ ] **Google Merchant Center**（免費，但需有已驗證網站與商品 feed，且達到資格門檻）：連結到 Google Cloud 專案
   - 成果：美加英澳紐等 11 國的 Google Shopping 每週/每月熱銷排名與需求變化，這是目前找到最強的第一手需求訊號。
5. [ ] **Pinterest 商業帳號 + 開發者 app**（免費）→ `PINTEREST_APP_ID`、`PINTEREST_APP_SECRET`
   - 成果：US、CA、GB、AU+NZ 的搜尋趨勢與成長率。
6. [ ] **Google Ads 管理員帳號 + developer token**（免費，需申請 Basic access）→ `GOOGLE_ADS_DEVELOPER_TOKEN`
   - 成果：產品關鍵字的月搜尋量與趨勢。
7. [ ] **Meta 身分驗證（facebook.com/ID）+ Meta 開發者 app** → `META_ACCESS_TOKEN`
   - 成果：UK + EU 廣告的持續天數、創意變體數、廣告主與 landing page 網域。
8. [ ] **TikTok for Developers + Commercial Content API 申請**（需審核）→ `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`
   - 成果：UK + EU 的 TikTok 廣告資料。
9. [ ] **Google Trends API alpha 申請**（審核時間不定，先申請放著）

## Google Merchant Center 申請步驟

因為你已經有 Shopify 商店，最簡單的方式是透過 Shopify 的 **Google & YouTube** app：

1. 先確認 Shopify 商店符合條件：有設定付款方式、商店沒有設密碼、有退款政策與服務條款頁、有聯絡資訊。
2. 在 Shopify App Store 安裝 **Google & YouTube**（Google LLC 出品）。
3. 在 app 裡用你的 Google 帳號登入，選擇「建立新的 Merchant Center 帳號」。商店網域會自動驗證與認領（同一個網域只能屬於一個 Merchant Center 帳號）。
4. 完成後，Shopify 商品會自動同步到 Merchant Center。到 [merchants.google.com](https://merchants.google.com) 確認商品已核准。
5. 在 Merchant Center 找 **Best sellers**（市場洞察）報表，確認你的帳號看得到。Google 沒有公開資格門檻；第三方資料說可能需要有在跑 Shopping 廣告，看不到的話請告訴我。
6. 看得到之後再做 API 串接（我會帶你做）：在同一個 Google Cloud 專案啟用 **Merchant API**，用 Merchant Center 管理員帳號完成一次性的開發者註冊（`registerGcp`）。

## 暫不需要（之後視成果再決定）

- Zendrop（MCP 實測需帳號，可能需 Pro 方案約 $49–59/月）：等 CJ 接好後再評估是否值得。
- StoreLeads Pro（$250/月起）：只有在美加澳紐的店家資料明顯不足時，才考慮買一個月。
- SerpApi、Apify、Keepa：屬於中間商，依 ADR-005 暫不採用。
