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
- [x] M2 可續跑的 pipeline runner（純邏輯 + CLI）：工作單位、lease + fencing、Meta 請求先記帳再送出、每日 3 次掃描、依 egress 退避；GitHub 每日排程移除（Vercel Cron 在 M3 接上前沒有每日自動蒐集）
- [x] M3 Vercel 觸發：routes、proxy、cron（ADR-013）；部署後實測（Meta 是否擋 Vercel IP、自我接續是否遇到 508）見 HUMAN_TODO
- [x] M4 介面殼層、探索頁、移除樣本資料（e2e 偶發已在 M5 查明：預設 10 個 worker 讓唯一的 `next start` 執行緒飽和，改用 4 個 worker）
- [x] M5 產品列表、首頁儀表板、排名效能（只讀最新評分批次；58,647 筆評分歷史時 92→33 ms；每頁 30 筆 + 真實總數；桌機精簡表格 / 手機卡片；首頁儀表板）
- [x] M6 詳情頁、廣告、收藏（摘要卡 + 重點數字 + 分數直條列 + 證據分區收合；詳情資料查詢中位數 16.4→10.5 ms；廣告卡片、收藏響應式清單、子分數縮寫說明）
- [x] M7 文件收尾（ADR-013 最終行為、DEPLOY 端到端步驟、HUMAN_TODO、CLAUDE.md 已知陷阱、整體 review）
- [ ] [blocked: human — 需要部署] 部署後實測：Meta 是否擋 Vercel 機房 IP、tick 自我接續是否遇到 508、Neon HTTP driver 下的 lease / 競態（見 HUMAN_TODO 第 1 項）
  - 2026-10-11：Vercel 第一次探索顯示「Meta 擋下了這台伺服器」，但當時不知道 Meta 實際回了什麼
  - [x] Meta 回應診斷：分成驗證碼 / 要求登入 / 403 / 429（被擋、退避）與頁面沒有內嵌結果 / 讀不出來（不算被擋、只停這次執行），診斷寫進 `ingestion_runs.error`、步驟錯誤與退避原因，探索頁白話說明 + 技術細節
  - [ ] [blocked: human — 需要下一次 Vercel 執行的「技術細節」] 依實際分類決定 Vercel 上的 Meta 策略（HUMAN_TODO 第 1 項）
  - [x] 2026-10-11：Vercel 實際回 HTTP 403。CJ 官方 API 探索（ADR-014）：Meta 被擋時照常從 CJ 找有訂單的商品並建立產品（`cj:<pid>`）、token 加密快取、點數／限流退避、探索頁步驟與提示、評分 v1.2（CJ 訂單數 + 證據太少上限 50 分）
  - [ ] [blocked: human — 需要在 Vercel Production 加 `CJ_API_KEY` 並 Redeploy] 正式站實測 CJ 步驟（HUMAN_TODO 第 0.1 節）
  - [x] Meta 官方 Ad Library API 探索（英國／歐盟，ADR-015）：runner 步驟「搜尋 Meta 官方 API（英國／歐盟）」（不受網站版退避影響、每 run ≤ 10 次、613 退避／190 停止）、網域＋標題分組成產品（`meta-api:`）、保守掛到網站版產品、`api|<id>` 不覆蓋網站版、評分與介面依 Library ID 去重、觸及人數顯示；全部依官方文件格式的 fixture 測試
  - [ ] [blocked: human — app 尚未取得 Ad Library API 權限 (code 10)；`.env.local` 已有 `META_ACCESS_TOKEN`，但請求回 code 10，見 HUMAN_TODO 第 0 節] 官方 API 真實請求實測（`docs/research/meta-ad-library-api.md` 第五節：`link_caption` 是否為網域、`total_reach_by_location` 形狀、網站與 API 的 ID 是否相同、多國查詢），在複本量測新增／掛上／略過的產品數，再到 Vercel 實測
  - [ ] 官方 API 後續（實測之後）：依 `target_locations` 判斷歐盟國家（現在一次查多國只標得出英國）；觸及人數是否納入評分（先累積資料、回測）；需要時取第二頁（`after` 游標）

## Phase 4C — 找爆品能力強化（最優先；使用者 2026-10-10 要求：要能客觀、實質找到爆品）

- [x] 追蹤廣告主：找到的電商店家，定期查它在 Ad Library 的其他廣告
- [x] 資料品質 A：Meta 廣告只掛到它連到的產品（846 則中 173 則錯掛 → 0）；`npm run repair -- ad-attachments [--apply]`
- [x] 資料品質 B（ADR-012）：售價只用廣告主自己的商品頁，搜尋結果改稱「同類商品」
- [x] **資料品質 C：廣告主商品頁紀錄被搜尋結果覆蓋**（M2 量測發現）：Shopify 搜尋（`shopify_catalog`）與廣告主商品頁查詢（`shopify_catalog_lookup`）的 `externalId` 都是 `${p.id}|${country}`、source 都是 `shopify`，搜尋結果碰到已查過的廣告主商品時會覆蓋那一筆，ADR-012 的售價就不見了。示範資料庫複本跑一次 pipeline：lookup 紀錄 77 → 73。修正後要量：同樣跑一次 lookup 紀錄數不減少、有廣告主售價的產品數前後對比，並提供 repair 把被覆蓋的重新查回（2026-10-11 完成：lookup 改用 `lookup|` 前綴的 externalId + migration 0010 改名既有紀錄；`npm run repair -- store-listings`）
- [ ] 售價覆蓋率：目前只有 26 / 208 個產品有廣告主自己的售價；讓每日排程對所有「有商品頁網址、還沒查過」的產品執行廣告主商品頁查詢，並在探索頁的資料來源健康度顯示覆蓋率
- [ ] 產品探索擴充：
  - [ ] 關鍵字自動延伸：從已探索到的產品標題 / 商品代號抽出候選關鍵字；依每個關鍵字「找到幾個有潛力的新產品」分配掃描次數，產出低的自動淘汰
  - [ ] 不限品類的廣泛掃描：用 dropshipping 廣告常見用語（例如免運、限時折扣）掃描，先實測 Ad Library 對這類搜尋的回應再決定
  - [ ] 衡量探索成效：每日新產品數、後來進入高分的比例，寫進資料來源頁（追蹤廣告主與關鍵字掃描分開統計）
- [x] 詳情頁顯示「這個產品的廣告來自 N 個不同網域」，網域過多時警示可能混入不同產品（M6；示範資料庫 208 個產品中 11 個超過 1 個網域）
- [ ] 詳情頁「市場」與排名頁一樣取所有證據的國家（含同類商品搜尋結果的國家），可能比實際投放市場多；評估改成只算廣告與廣告主商品頁並量測差異
- [ ] 廣告 `countries` 合併：同一則廣告在多國被找到時，`source_items` 只留最後一個國家（影響 marketReach 與「市場」）；改成聯集，並量測改動前後各產品的市場數與分數差異
- [ ] `groupAdsByLanding` 同一則廣告跨國重複計數：同一 ad id 在不同國家的搜尋結果會被算成多則，可能讓「有潛力」門檻與擴量訊號偏高；改成依 ad id 去重並量測受影響的產品數
- [ ] 廣告動能雜訊：一天最多 3 次 Meta 掃描（ADR-013）會讓「每日觀測到的廣告數」偏高；改成只用每日排程（cron）的觀測或依日去重，並在示範資料庫量測分數差異
- [ ] Meta 請求間隔加隨機抖動：CLAUDE.md 規則寫「隨機間隔」，目前固定 5 秒（M2 之前也是固定）
- [x] **CJ 請求節奏**（2026-10-11）：實測 CJ 每秒上限（被拒的請求不佔額度、1 秒後即恢復）→ 間隔 1.5 秒、從每個 HTTP 請求（含 token）的送出時間算並先寫入狀態；`1600200` 等 3 秒重送最多 3 次、不退避；只有點數用完才退避。複本連續 3 次探索 154 個 CJ 請求 0 次被拒
- [x] **同款照片比對 v1（ADR-016）**：Shopify 搜尋結果的照片與產品照片相同（dHash）→「其他店家賣的同款商品」，沒有廣告主售價時用同款店家售價中位數當售價（毛利、排名頁售價、詳情頁）；評分 v1.3「證據太少」上限只算需求訊號；CJ 供貨價改取規格區間最高價。Vercel 情境（只有 CJ 產品）：有毛利 0 → 4 / 18、同款店家 5 家
- [ ] 同款照片比對後續：
  - [x] CJ 規格比對（ADR-017）：全部同價／與同款店家選項對得上的規格／對不上用最貴規格並標示；4 個有售價的產品中 3 個對到店家選項（抱枕 22 → 10 個規格、最高價 9.95 → 4.86）
  - [ ] 規格比對 v2：店家選項與 CJ 規格名稱不同字（"Large" vs "60cm"、件數）時對不上；評估用 Shopify 規格的價格／圖片對應
  - [ ] 同款店家數是否納入評分（跨店販售 = 需求？）：先累積資料、回測再決定；目前只顯示與用於售價
  - [ ] 搜尋查詢：CJ 長標題的前 20 筆不一定含同款；評估用前 6 個字或 CJ 商品的關鍵字再查一次（每個產品多 5 次 Shopify 請求），量測同款店家數的增加
  - [x] 既有 Meta 產品同款比對（2026-10-11 量測，不需改程式：runner 已對所有有照片 hash 的產品比對）：可比對產品 0 → 39、22 個產品找到 37 組同款店家、有售價 76 → 84 / 208；人工抽查 10 組全對
  - [x] 產品照片覆蓋（2026-10-11）：原因是 120 個產品從未查過廣告主商品頁、廣告沒存圖片；商品頁查詢加上「有無 www.」兩種網址（同一請求）→ 132 個待查產品找到 0 → 16、廣告主售價 76 → 92、售價覆蓋 84 → 99、有照片 88 → 102
  - [ ] 商品頁轉址到其他網域／handle（抽查 30 家中約 1/10）：先連店家網站取最終網址再查目錄（實測 9 個中 7 個找到）；需先確認 robots 與節制
  - [ ] 每次探索只查 20 個廣告主商品頁：示範資料庫有 132 個待查；改成一個請求查多個產品（最多 50 個網址）以加快覆蓋
  - [ ] 廣告素材圖 hash（僅本機／GitHub 出口有效，Meta 網站在 Vercel 被擋）：蒐集當下算 hash、只存 hash，輪播與情境圖要保守處理並量誤判
  - [ ] [blocked: human — CJ 帳號需 Level 3 才能用以圖搜商品（實測 401）] Meta 產品找 CJ 供貨：標題搜尋＋照片比對實測 0 / 20（同一商品不同顏色主圖認不出），目前不實作；之後可比對 CJ 各規格圖片
- [ ] CJ 探索後續（ADR-014）：
  - [ ] CJ 產品在 Shopify collect 排在最後（還沒有分數時排序用 -1，200 多個 Meta 產品排在前面），補「跨店販售」證據前要調整挑選順序並量測
  - [ ] CJ 訂單數的統計期間：寄信問 CJ，或每天觀測同一商品的 `orderCount` 變化推算；確認後更新說明文字
  - [x] **只用真實銷量挑 CJ 候選**（使用者 2026-10-12 規定）：移除 Trending 請求與上架數門檻／排序；關鍵字相關度前 20 筆中在售的最多 12 個全部查詳情（每次 ≤ 120 個）；步驟改名「搜尋 CJ 有真實訂單的商品」。同日同關鍵字實測：建立產品 18 → 3、詳情 40 → 120、耗時 111 → 208 秒
  - [ ] [blocked: 決策] CJ 產出變少（18 → 3）：要不要加大詳情預算（每 100 個約 150 秒、0 點）、每個關鍵字查第 2 頁、或增加關鍵字數；需要使用者決定時間預算
  - [x] ~~CJ `listedNum` 納入飽和懲罰~~：上架數不是銷量，依 2026-10-12 規定不計分
  - [ ] 關鍵字自動延伸也套用到 CJ（CJ 列表 50 點／次，額度很寬）
- [ ] 真實銷量訊號（Shopify Global Catalog 沒有銷量）：研究並逐一接上能反映實際賣出的第一手來源——CJ 訂單數（2026-10-11 已接上，ADR-014）、Google Merchant Center 熱銷排名（需申請）、TikTok Shop 商品頁公開售出數、Amazon 排名；每個來源標示「實際訂單 / 排名 / 推估」等級，先寫研究文件再實作
- [ ] 照片比對 v2：CLIP 類圖片向量（transformers.js，在 GitHub Actions 免費執行），能處理裁切、旋轉、修圖；人工標註約 200 組配對量測準確率與漏抓率來定門檻；不確定的配對列為「可能重複」讓使用者確認，不自動合併
- [ ] 詳情頁的店家評分標示「店家自報，可能不實」（評分不計入 Winning Score）

## 等待金鑰、決策或資料量

- [x] CJ Dropshipping API v2 adapter（2026-10-11，ADR-014）：Trending 與關鍵字列表、商品詳情（訂單數、上架數、上架時間）、供貨價；`soldOut`（90 天銷量）實測全是 null
- [x] CJ 運費試算（ADR-017）：`cj_freight` 單位、每次探索 ≤ 20 次（200 點）、寄到美國 15 天內最便宜、`cj_landed_costs`；評分 v1.4 毛利改到岸毛利（缺任何一項是「—」）
- [ ] 到岸毛利後續：其他四國（GB／CA／AU／NZ）的運費與各國售價；CJ 美國倉（`startCountryCode=US`）是否更便宜；毛利滿分門檻 40% 要回測
- [ ] [blocked: human — 需要 Pinterest / Merchant Center] 評分 v2：demandTrend 改用 Pinterest / Google Best sellers
- [ ] [blocked: human — 需要 Merchant Center] Google Merchant API Best sellers adapter：每週 / 每月熱銷排名、`relative_demand` 與變化（11 國）
- [ ] [blocked: human — 需要 Pinterest 開發者 app] Pinterest Trends API adapter（US、CA、GB、AU+NZ）
- [ ] [blocked: human — 需要 developer token] Google Ads API Keyword Planner adapter：關鍵字月搜尋量與趨勢
- [x] Meta Ad Library API adapter（UK + EU，fixture 測試）：`createMetaAdsApiAdapter`，token 不進任何儲存或錯誤訊息（2026-10-11；官方 API 沒有 landing page 與創意變體數，不能取代網站版探索）
- [ ] [blocked: human — 需要 `META_ACCESS_TOKEN`] 官方 API 補強觸及人數（廣告主）：對網站版找到、投放到 UK / EU 的廣告主用 `search_page_ids` 查 API。寫入路徑已由 ADR-015 解決（`api|<id>` 獨立紀錄、評分依 Library ID 去重），剩下的是挑選廣告主與請求預算
- [ ] [blocked: human — 需要 TikTok API 核准] TikTok Commercial Content API adapter（UK + EU）
- [ ] [blocked: 決策] TikTok 美國資料：公開 Creative Center 需頁面簽章（不偽造）且缺少商品識別；見 HUMAN_TODO 的選項
- [ ] [blocked: 部署] 改用自己的 Shopify UCP agent profile（`SHOPIFY_UCP_AGENT_PROFILE`）
- [ ] [blocked: 時間 — 需每日 pipeline 累積 4–8 週真實歷史] 回測：驗證分數能否提前抓到後來真的爆的產品，結果寫進 `research/scoring.md`
- [ ] [blocked: human — 需要 `RESEND_API_KEY`，選填] Watchlist 分數變動 Email 通知

## Phase 4 — 介面（之後補）

- [ ] 排名頁類別篩選（需要類別資料）
- [ ] 廣告素材縮圖（需確認 Meta 圖片網址的有效期限與熱連結限制）
- [ ] 收藏清單的取消按鈕名稱都是「★ 已收藏」，螢幕閱讀器無法分辨是哪個產品；按鈕名稱加上產品名

## Phase 5 — 帳號與商業化

- [ ] 註冊登入（多使用者，Better Auth；個人使用階段沿用站台密碼）；`watchlist` 加 `user_id`（ADR-009）
- [ ] 方案與額度限制；Stripe 訂閱（test mode）
- [ ] 管理後台：來源健康度、ingestion 狀態、手動重跑
- [ ] 對外開放前重新評估 ADR-006（公開網頁蒐集）與各平台資料再散布條款

## Phase 6 — 上線準備

- [ ] 效能：排名頁目前載入全部產品後在記憶體篩選（M5 已改成只讀最新評分批次，208 個產品約 30 ms），真實產品超過約 2,000 筆（每日排程約 2 個月後）前改成資料庫端篩選與分頁；快取、DB index、錯誤監控、log
- [ ] 評估 Vercel Workflow（durable steps）取代自建 runner 的 tick 自我接續：部署實測後若 508 迴圈偵測或接續失敗常發生再做；需確認與 Next 16 + cacheComponents 相容
- [ ] 產品照片下載只擋字面上的私有 IP，網域名稱解析到私有 IP（DNS rebinding）擋不到；在 Vercel 上風險低，對外開放前補上解析後檢查
- [ ] 安全檢查（`/security-review`）、rate limiting
- [ ] 隱私權政策 / 服務條款頁草稿（標示需法律審閱）
- [ ] 完整 E2E 測試通過
