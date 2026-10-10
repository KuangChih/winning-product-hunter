# Roadmap

由 loop 維護。由上往下做；項目太大就拆成子項目。標記：`[ ]` 待辦、`[x]` 完成、`[blocked: …]` 卡住（寫明原因）。
完成的項目細節見 [`PROGRESS.md`](PROGRESS.md) 與 git log。

## 已完成摘要

| 階段                       | 內容                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 研究與架構         | 資料來源、競品、評分方法研究；ADR-001～003                                                                                                                                 |
| Phase 1 專案骨架           | Next.js 16 + Tailwind + shadcn/ui、Drizzle schema、Vitest / Playwright、CI                                                                                                 |
| Phase 2A 垂直切片（ADR-004） | `SourceAdapter` + fixture、實體對應 v0、評分 v0、排名頁與詳情頁、`npm run seed`                                                                                             |
| Phase 2R 真實資料閉環（ADR-007） | Meta Ad Library 產品探索、評分 v1（真實訊號）、`npm run pipeline`、每日排程、資料來源健康度頁                                                                              |
| Phase 2B 第一手資料（ADR-005） | 國家維度、移除 AliExpress、Shopify Global Catalog（搜尋 + 廣告主商品頁查詢）、ECB 匯率、Meta Ad Library 公開網站蒐集器（ADR-006）                                           |
| Phase 2C / 3 資料品質與評分 | 實體對應 v1（商品照片 dHash 去重）、廣告動能（評分 v1.1）                                                                                                                  |
| Phase 4 / 4A / 4B 介面與安全 | Landing page、排名頁搜尋篩選與 7 個子分數欄、廣告資料庫、Watchlist、站台密碼、防暴力破解、安全標頭、RWD、深色模式、無障礙（axe 0 違規）、中英文介面（ADR-008～011） |

## Vercel 網頁觸發探索 + UI/UX 改版（使用者 2026-10-10 要求，最優先）

- [x] M1 資料層強化（runner 的前置）：`pipeline_runs` 等 schema、可中斷的 HTTP / rate limiter、分批寫入、`collection_attempts` 防止重挑、照片只用廣告主自己的、評分查詢縮減
- [ ] M2 可續跑的 pipeline runner（純邏輯 + CLI）
- [ ] M3 Vercel 觸發：routes、proxy、cron（ADR-013）
- [ ] M4 介面殼層、探索頁、移除樣本資料
- [ ] M5 產品列表、首頁儀表板、排名效能
- [ ] M6 詳情頁、廣告、收藏
- [ ] M7 文件收尾

## Phase 4C — 找爆品能力強化（最優先；使用者 2026-10-10 要求：要能客觀、實質找到爆品）

- [x] 追蹤廣告主：找到的電商店家，定期查它在 Ad Library 的其他廣告
- [x] 資料品質 A：Meta 廣告只掛到它連到的產品（846 則中 173 則錯掛 → 0）；`npm run repair -- ad-attachments [--apply]`
- [x] 資料品質 B（ADR-012）：售價只用廣告主自己的商品頁，搜尋結果改稱「同類商品」
- [ ] 售價覆蓋率：目前只有 26 / 208 個產品有廣告主自己的售價；讓每日排程對所有「有商品頁網址、還沒查過」的產品執行廣告主商品頁查詢，並在資料來源頁顯示覆蓋率
- [ ] 產品探索擴充：
  - [ ] 關鍵字自動延伸：從已探索到的產品標題 / 商品代號抽出候選關鍵字；依每個關鍵字「找到幾個有潛力的新產品」分配掃描次數，產出低的自動淘汰
  - [ ] 不限品類的廣泛掃描：用 dropshipping 廣告常見用語（例如免運、限時折扣）掃描，先實測 Ad Library 對這類搜尋的回應再決定
  - [ ] 衡量探索成效：每日新產品數、後來進入高分的比例，寫進資料來源頁（追蹤廣告主與關鍵字掃描分開統計）
- [ ] 詳情頁顯示「這個產品的廣告來自 N 個不同網域」，網域過多時警示可能混入不同產品
- [ ] 真實銷量訊號（Shopify Global Catalog 沒有銷量）：研究並逐一接上能反映實際賣出的第一手來源——CJ 90 天銷量（需金鑰）、Google Merchant Center 熱銷排名（需申請）、TikTok Shop 商品頁公開售出數、Amazon 排名；每個來源標示「實際訂單 / 排名 / 推估」等級，先寫研究文件再實作
- [ ] 照片比對 v2：CLIP 類圖片向量（transformers.js，在 GitHub Actions 免費執行），能處理裁切、旋轉、修圖；人工標註約 200 組配對量測準確率與漏抓率來定門檻；不確定的配對列為「可能重複」讓使用者確認，不自動合併
- [ ] 詳情頁的店家評分標示「店家自報，可能不實」（評分不計入 Winning Score）

## 等待金鑰、決策或資料量

- [ ] [blocked: human — 需要 `CJ_API_KEY`] CJ Dropshipping API v2 adapter：Trending 商品、90 天銷量、各國運費與運送時間、各倉庫存 → 供應成本與需求訊號
- [ ] [blocked: human — 需要 `CJ_API_KEY`、Pinterest / Merchant Center] 評分 v2：margin 扣除 CJ 運費（到岸毛利）、demandTrend 改用 Pinterest / Google Best sellers
- [ ] [blocked: human — 需要 Merchant Center] Google Merchant API Best sellers adapter：每週 / 每月熱銷排名、`relative_demand` 與變化（11 國）
- [ ] [blocked: human — 需要 Pinterest 開發者 app] Pinterest Trends API adapter（US、CA、GB、AU+NZ）
- [ ] [blocked: human — 需要 developer token] Google Ads API Keyword Planner adapter：關鍵字月搜尋量與趨勢
- [ ] [blocked: human — 需要 `META_ACCESS_TOKEN`] Meta Ad Library API adapter（UK + EU）：廣告持續天數、創意變體、觸及人數
- [ ] [blocked: human — 需要 TikTok API 核准] TikTok Commercial Content API adapter（UK + EU）
- [ ] [blocked: 決策] TikTok 美國資料：公開 Creative Center 需頁面簽章（不偽造）且缺少商品識別；見 HUMAN_TODO 的選項
- [ ] [blocked: 部署] 改用自己的 Shopify UCP agent profile（`SHOPIFY_UCP_AGENT_PROFILE`）
- [ ] [blocked: 時間 — 需每日 pipeline 累積 4–8 週真實歷史] 回測：驗證分數能否提前抓到後來真的爆的產品，結果寫進 `research/scoring.md`
- [ ] [blocked: human — 需要 `RESEND_API_KEY`，選填] Watchlist 分數變動 Email 通知

## Phase 4 — 介面（之後補）

- [ ] 排名頁類別篩選（需要類別資料）
- [ ] 廣告素材縮圖（需確認 Meta 圖片網址的有效期限與熱連結限制）

## Phase 5 — 帳號與商業化

- [ ] 註冊登入（多使用者，Better Auth；個人使用階段沿用站台密碼）；`watchlist` 加 `user_id`（ADR-009）
- [ ] 方案與額度限制；Stripe 訂閱（test mode）
- [ ] 管理後台：來源健康度、ingestion 狀態、手動重跑
- [ ] 對外開放前重新評估 ADR-006（公開網頁蒐集）與各平台資料再散布條款

## Phase 6 — 上線準備

- [ ] 效能：排名頁目前載入全部產品後在記憶體篩選，真實產品超過約 2,000 筆（每日排程約 2 個月後）前改成資料庫端篩選與分頁；快取、DB index、錯誤監控、log
- [ ] 安全檢查（`/security-review`）、rate limiting
- [ ] 隱私權政策 / 服務條款頁草稿（標示需法律審閱）
- [ ] 完整 E2E 測試通過
