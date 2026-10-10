# 評分方法與產品實體對應研究（2026-10-09）

業界沒有公開、經驗證的 winning score 公式（見 `competitors.md`）。下面是 v0 規格，所有門檻都是**待回測校正的假設**，Phase 3 回測後更新本檔。

## 1. 訊號與業界經驗法則

| 訊號 | 業界經驗 🟡 | 我們的解讀 |
|---|---|---|
| 廣告持續天數 | 30+ 天「值得注意」、60+ 天「可能獲利」、90+ 天「擴量中」；另有工具用 30–59/60–119/120+ 分三級 | 用飽和函數（越久越好但遞減），不是線性 |
| 廣告格式 | 靜態圖片廣告存活時間是影片的數倍 | 依格式分開正規化持續天數，避免偏誤 |
| 創意變體數 | 同品牌對同一產品不斷新增變體 = 正在優化已知贏家，比單看天數更強 | 「近 14 天新增變體數」作為擴量訊號 |
| 重複創意 / 廣告主數 | 90 天廣告若被很多人複製仍可能已飽和 | 進入飽和懲罰 |
| 毛利 | 毛利 > 30%；售價約為到岸成本 3 倍 | 毛利可行性子分數 |
| 物流 | 輕、耐摔、好包裝較佳；退貨與延遲侵蝕利潤 | v1 以重量/類別規則估算，資料不足時不計分 |

關鍵限制：**持續天數衡量的是存活力，不直接等於獲利**。所以必須與需求面（Trends、市集銷量）交叉佐證。

## 2. Winning Score v0 規格

每個子分數都正規化到 0–1，並記錄「是否有資料」。沒有資料的子分數**不計入、權重重新分配**，同時降低信心度（不把缺資料當 0 分）。

| 子分數 | 計算（v0） | 權重 |
|---|---|---|
| `longevity` | `1 - exp(-activeDays / τ)`，τ 依格式（影片 30、圖片 60）；取該產品前 3 個廣告平均 | 0.20 |
| `scaling` | 近 14 天新增廣告變體數 + 新廣告主數，取 log 後以全體產品百分位正規化 | 0.20 |
| `engagementVelocity` | 互動數時間序列的 robust z-score（median/MAD）之 7 日變化，截斷至 0–1 | 0.15 |
| `demandTrend` | Google Trends 序列的 Theil-Sen 斜率（相對於基線），百分位正規化 | 0.15 |
| `marketplace` | AliExpress 訂單成長率、Amazon BSR 改善幅度，百分位正規化 | 0.15 |
| `margin` | `(建議售價 - 供貨價 - 運費) / 建議售價`，30% → 0.5、60% → 1 | 0.15 |

```
base       = Σ wᵢ·sᵢ / Σ wᵢ（只計有資料的子分數）
corroboration = 1 + 0.1 × (獨立來源數 - 1)，上限 1.3
saturation = 1 - 0.5 × sat，sat ∈ [0,1] 由「廣告主數、販售店家數、首次出現天數」百分位組成
score      = clamp(100 × base × corroboration × saturation, 0, 100)
confidence = 有資料的權重總和 × 來源數因子（顯示為 低/中/高）
```

- 只有單一來源的產品標記「待驗證」，且分數上限 70。
- 所有權重與參數放在一個設定物件中，回測時可調；分數輸出必須帶完整拆解（子分數、權重、原始值、來源）供 UI 顯示。

## 3. 趨勢偵測（時間序列）

- 基線用 **median + MAD（×1.4826）** 的 robust z-score，計算時排除當前點避免自我影響。
- 速度/加速度前先平滑（EWMA），因為差分會放大雜訊。
- 「正在上升」需持續性：z > 門檻持續 k 個點，或 Mann-Kendall 檢定顯著且 Theil-Sen 斜率 > 0。
- 大量序列同時掃描時注意偽陽性，門檻由回測決定。

## 4. 產品實體對應（entity resolution）

同一產品在不同廣告、店家、市集有不同標題與圖片。採三層漏斗：

1. **候選產生（便宜）**：圖片 dHash/pHash（Hamming 距離 ≤ ~5 起步，需調整）+ 標題正規化後的 token blocking。dHash 對縮放/壓縮較穩定，適合抓「同一張圖被重新上傳」。
2. **語意比對**：CLIP 類圖片向量 + 文字向量的 cosine 相似度，抓「同一產品不同拍法、不同賣家」。雜湊無法處理裁切、旋轉、大幅調色，所以這層必要。
3. **決策**：規則 + 門檻合成分數，輸出 duplicate / same-product / related / different；低信心配對留給管理後台人工確認。

執行位置：向量計算不適合放 Vercel function，交給外部 worker 或託管 embedding API；向量存在 Postgres `pgvector`。門檻必須用**自建的標註配對資料集**校正。

## 5. 回測計畫（Phase 3）

- 定義「事後真的爆了」：例如 30 天後廣告主數 ≥ 3 倍且 Trends 斜率為正。
- 指標：Precision@50、提前天數（分數超過門檻 → 爆紅的天數差）、偽陽性率。
- 需累積至少數週的歷史快照，所以 ingestion 要從一開始就**保存時間序列快照，不能覆寫**。

## 參考來源

- 廣告持續天數：[Brandsearch：how long to run Facebook ads](https://brandsearch.co/blog/how-long-to-run-facebook-ads)、[90 天 durability filter](https://brandsearch.co/blog/facebook-ads-running-90-days-durability-filter)、[profitability check](https://brandsearch.co/blog/dropshipping-product-profitability-check)、[Omniconvert：ads that refuse to die](https://www.omniconvert.com/blog/ads-that-refuse-to-die/)、[Adligator](https://adligator.com/blog/found-winning-dropshipping-products-weekend-facebook-ads)、[TrendTrack](https://www.trendtrack.io/blog-post/how-to-use-ai-for-dropshipping)
- 產品條件：[EComposer](https://ecomposer.io/blogs/dropshipping/find-winning-product-for-dropshipping)、[Zendrop](https://www.zendrop.com/blog/car-vacuum-cleaner-analysis/)
- 圖片比對：[arXiv 1811.07996](https://arxiv.org/pdf/1811.07996)、[pHash vs dHash](https://ssojet.com/compare-hashing-algorithms/phash-vs-dhash)、[pHash in Python](https://ssojet.com/hashing/phash-in-python)、[Apify Image Similarity API](https://apify.com/johnvc/image-similarity-api)
- 趨勢偵測：[smoothed z-score（php-zscore）](https://root.packagist.org/packages/gtjamesa/php-zscore)、[delaynet z-score](https://delaynet.readthedocs.io/en/stable/guide/10_detrending/z_score/)；median/MAD、Mann-Kendall、Theil-Sen 為標準統計方法

## 6. v0 實作狀態（2026-10-09）

已實作於 `src/scoring/`（版本 `v0`）：longevity、scaling、demandTrend、marketplace（以訂單「水準」排名，成長率待有多次快照）、佐證乘數、飽和懲罰（活躍廣告主數與產品年齡的百分位平均）、單一來源上限 70、信心度。

尚缺：engagementVelocity（需 TikTok 資料）、margin（需零售價；廣告與 Shopify 店家價格接上後計算）。缺的子分數不計分並降低信心度，目前信心度上限約 0.7。

Fixture 排名（`2026-10-09`）：爆發中的新品 73.4 > 穩定上升 59.4 > 高原但飽和 52.8 > 下滑 29.5 > 冷門 24.4，符合樣本設計的故事。這只是合理性檢查，不是回測。

## 7. v1 實作（2026-10-10，ADR-007）

v1 改用真實訊號（`SCORING_VERSION = "v1"`）：

| 子分數 | 權重 | v1 計算 |
|---|---|---|
| longevity | 0.15 | 同 v0（投放最久 3 支廣告的存活度，依格式 τ、停投半權重） |
| scaling | 0.15 | 14 天新廣告 + 新廣告主 + 0.5 ×（每支刊登中廣告的 `creative_variants` − 1），排名 |
| marketReach（新） | 0.10 | 有刊登中廣告的國家，依市場層級加權（tier 1 = 1、tier 2 = 0.6），除以五個主要市場的總和，上限 1 |
| engagementVelocity | 0.15 | 仍無資料（TikTok） |
| demandTrend | 0.15 | 同 v0 |
| marketplace | 0.15 | CJ 90 天銷量（需 `CJ_API_KEY` 才有真實資料） |
| margin | 0.15 | **運費前毛利** =（Shopify 店家售價中位數，換算 USD − CJ 供貨價）/ 售價；60% 以上滿分，線性 |

飽和度改為三項百分位的平均：刊登中廣告主數、產品年齡，以及（有資料時）Shopify 販售店家數。

注意：margin 目前未扣運費與手續費；接上 CJ 運費試算後應改為到岸毛利。樣本產品的供貨價是 fixture，毛利偏高。

## 8. 實體對應 v1 實作（2026-10-10）

- dHash（9×8 灰階差分，64 bit）。合成圖測試：同一張圖縮放＋重新壓縮距離 ≤ 4；明顯不同的圖 > 10。
- 合併規則（`MERGE_RULES`）：距離 ≤ 2 直接視為同一商品；距離 ≤ 8 且標題 Jaccard ≥ 0.25 才合併。存活者為最早出現的產品。
- 本機示範資料庫實測：28 張真實商品照片，未合併任何產品；最接近的一組是「Noxa Neck And Shoulder Massager」與「Neckmassager」（距離 9、標題無共同 token），規則刻意保守。待真實資料累積後用人工標註配對校正門檻，並在 v2 加入 embedding 處理裁切與不同拍法。

## 9. Ad momentum（v1.1，2026-10-10）

原本的 `engagementVelocity`（社群互動速度）需要 TikTok 資料，一直沒有值。改為 `momentum`：每支廣告每次被蒐集都會留下當天的 snapshot，計算每天觀察到的廣告數，最新一天與前 4–14 天比較（median / MAD 的 robust z-score，基準持平時用 max(1, 10% × 中位數) 當尺度），再在產品間排名。歷史少於 5 天時不計分並顯示「需要 N 天資料」。TikTok 互動數據接上後，再另外加一項 engagement 子分數。
