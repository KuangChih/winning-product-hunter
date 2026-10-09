# 需要你處理的事項

Loop 遇到只有你能做的事（申請 API key、建立帳號、付費、法律判斷、部署）會寫在這裡，並繼續做其他項目。
處理完後把項目打勾，並把金鑰填進 `.env.local`（不要 commit），下一輪 loop 會自動接手。

- [ ] 建立 Vercel 專案並連結 GitHub repo（loop 不會 push 或部署）
- [ ] 建立 Postgres 資料庫（Neon 或 Supabase），提供 `DATABASE_URL`
- [ ] **法律確認**：Meta Ad Library API 條款據報限制把資料用於轉售型產品；請確認能否在付費 SaaS 中使用（見 `docs/research/data-sources.md`、ADR-001）
- [ ] 申請 API 存取（不急，loop 會先用 fixture）：
  - Meta 開發者帳號 + 身分驗證 → `META_ACCESS_TOKEN`
  - SerpApi 帳號 → `SERPAPI_KEY`
  - AliExpress Affiliate（含 Advanced API / hot product 權限）→ `ALIEXPRESS_APP_KEY`、`ALIEXPRESS_APP_SECRET`、`ALIEXPRESS_TRACKING_ID`
  - TikTok Commercial Content API 申請 → `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`
  - Google Trends API alpha 申請（可選）
  - 第二批：Apify（`APIFY_TOKEN`）、Keepa（`KEEPA_API_KEY`）、CJ Dropshipping（`CJ_API_KEY`）
