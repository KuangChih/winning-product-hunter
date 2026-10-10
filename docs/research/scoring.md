# 評分方法與產品實體對應

業界沒有公開、經驗證的 winning score 公式（見 [`competitors.md`](competitors.md)）。以下所有門檻都是**待回測校正的假設**，回測完成後更新本檔。決策背景見 ADR-002、ADR-012。

## 1. 訊號與業界經驗法則

| 訊號                | 業界經驗 🟡                                                       | 我們的解讀                                     |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| 廣告持續天數        | 30+ 天值得注意、60+ 天可能獲利、90+ 天擴量中                      | 用飽和函數（越久越好但遞減），不是線性         |
| 廣告格式            | 圖片廣告存活時間是影片的數倍                                      | 依格式分開正規化持續天數                       |
| 創意變體數          | 同品牌對同一產品不斷新增變體 = 正在優化已知贏家，比單看天數更強   | 擴量訊號                                       |
| 重複創意 / 廣告主數 | 長青廣告若被很多人複製，仍可能已飽和                              | 飽和懲罰                                       |
| 毛利                | 毛利 > 30%；售價約為到岸成本 3 倍                                 | 毛利子分數                                     |

關鍵限制：**持續天數衡量的是存活力，不直接等於獲利**，必須與需求面（搜尋趨勢、市集銷量）交叉佐證。店家可自行操控的數字（評分、評論數）不計入分數。

## 2. 目前的 Winning Score（v1.1，`src/scoring/score.ts`）

每個子分數正規化到 0–1，並記錄是否有資料。**沒有資料的子分數不計入、權重重新分配**，同時降低信心度（不把缺資料當 0 分，也不推估補值）。

| 子分數        | 權重 | 計算                                                                                                                                  | 目前資料狀況                   |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `longevity`   | 0.15 | 投放最久 3 支廣告的 `1 - exp(-activeDays / τ)`，τ 依格式（影片 30、圖片 60），已停投的廣告半權重                                      | Meta Ad Library ✅             |
| `scaling`     | 0.15 | 14 天內新廣告 + 新廣告主 + 0.5 ×（每支刊登中廣告的 `creative_variants` − 1），在產品間排名                                             | Meta Ad Library ✅             |
| `marketReach` | 0.10 | 有刊登中廣告的國家，依市場層級加權（tier 1 = 1、tier 2 = 0.6），除以五個主要市場的總和，上限 1                                        | Meta Ad Library ✅             |
| `momentum`    | 0.15 | 每天觀察到的廣告數，最新一天對前 4–14 天的 robust z-score（median / MAD），在產品間排名；歷史少於 5 天不計分                          | 等每日排程累積                 |
| `demandTrend` | 0.15 | 搜尋趨勢序列的 Theil-Sen 斜率（相對基線），排名                                                                                       | 等 Pinterest / Merchant Center |
| `marketplace` | 0.15 | CJ 90 天銷量（`units_sold_90d`），排名                                                                                                | 等 `CJ_API_KEY`                |
| `margin`      | 0.15 | **運費前毛利** =（廣告主商品頁售價換算 USD − CJ 供貨價）/ 售價；60% 以上滿分，線性。售價只用廣告主自己的商品頁（ADR-012）             | 售價部分有；等 CJ 供貨價       |

```
base          = Σ wᵢ·sᵢ / Σ wᵢ（只計有資料的子分數）
corroboration = 1 + 0.1 × (獨立來源數 − 1)，上限 1.3
saturation    = 1 − 0.5 × sat，sat = 刊登中廣告主數、產品年齡、（有資料時）同類商品販售店家數 三項百分位的平均
score         = clamp(100 × base × corroboration × saturation, 0, 100)
```

- 只有單一來源的產品分數上限 70，標示「待驗證」。
- 信心度 = 有資料的權重總和 × 來源數因子；高 ≥ 0.8、中 ≥ 0.45，其餘為低。
- 每個子分數存下原始值、`basis`（英文說明）與 `explain`（說明代碼 + 參數，介面依語言顯示）。
- 權重與參數集中在 `SCORING_CONFIG`，回測時調整。

**已知缺口**：margin 未扣運費與手續費，接上 CJ 運費試算後改為到岸毛利；澳、紐、英、EU 的店面價通常含稅，計算毛利前應扣除。社群互動（TikTok）目前沒有資料來源，接上後另加 engagement 子分數。

## 3. 趨勢偵測

- 基線用 **median + MAD（×1.4826）** 的 robust z-score，計算時排除當前點；基準持平時用 max(1, 10% × 中位數) 當尺度。
- 速度、加速度前先平滑（EWMA），因為差分會放大雜訊。
- 「正在上升」需要持續性：z 超過門檻持續 k 個點，或 Mann-Kendall 檢定顯著且 Theil-Sen 斜率 > 0。
- 大量序列同時掃描時注意偽陽性，門檻由回測決定。

## 4. 產品實體對應

同一產品在不同廣告、店家有不同標題與圖片。三層漏斗：

1. **候選產生**：商品頁網址（同一商品頁 = 同一商品，跨店同 Shopify handle 合併）+ 圖片 dHash + 標題 token。
2. **語意比對**（v2，未做）：CLIP 類圖片向量 + 文字向量，處理裁切、旋轉、不同拍法。可用 transformers.js 在 GitHub Actions 免費計算。
3. **決策**：規則 + 門檻，不確定的配對列為「可能重複」讓使用者確認，不自動合併。門檻要用**人工標註的配對集**校正。

### 目前實作（v1）

- **Meta Ad Library 廣告只依商品頁網址掛到產品**，不用廣告文案做標題比對（標題比對曾把不同店家的產品混在一起）。
- dHash（9×8 灰階差分，64 bit）：同一張圖縮放 + 重新壓縮距離 ≤ 4，明顯不同的圖 > 10。
- 合併規則（`MERGE_RULES`）：距離 ≤ 2 直接合併；距離 ≤ 8 且標題 Jaccard ≥ 0.25 才合併；存活者為最早出現的產品，被合併的標記 `merged_into`。
- 實測：28 張真實商品照片 0 個合併（最接近的一組距離 9、標題沒有共同字），規則刻意保守。

## 5. 回測計畫

- 定義「事後真的爆了」：例如 30 天後廣告主數 ≥ 3 倍且搜尋趨勢斜率為正。
- 指標：Precision@50、提前天數（分數超過門檻到爆紅的天數差）、偽陽性率。
- 需要每日排程累積 4–8 週的快照（`signal_snapshots` 不可覆寫）。

## 6. 版本歷程

| 版本 | 日期       | 變更                                                                                                     |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------- |
| v0   | 2026-10-09 | 樣本資料上的初版：longevity、scaling、demandTrend、marketplace、佐證乘數、飽和懲罰、單一來源上限         |
| v1   | 2026-10-10 | 改用真實訊號：新增 marketReach、scaling 加入創意變體、首次計算毛利、飽和度加入販售店家數（ADR-007）     |
| v1.1 | 2026-10-10 | 以 `momentum`（廣告動能）取代一直沒有資料的 `engagementVelocity`；之後售價改為只用廣告主商品頁（ADR-012） |

## 參考來源

- 廣告持續天數：[Brandsearch：how long to run Facebook ads](https://brandsearch.co/blog/how-long-to-run-facebook-ads)、[90 天 durability filter](https://brandsearch.co/blog/facebook-ads-running-90-days-durability-filter)、[profitability check](https://brandsearch.co/blog/dropshipping-product-profitability-check)、[Omniconvert：ads that refuse to die](https://www.omniconvert.com/blog/ads-that-refuse-to-die/)
- 產品條件：[EComposer](https://ecomposer.io/blogs/dropshipping/find-winning-product-for-dropshipping)、[Zendrop](https://www.zendrop.com/blog/car-vacuum-cleaner-analysis/)
- 圖片比對：[arXiv 1811.07996](https://arxiv.org/pdf/1811.07996)、[pHash vs dHash](https://ssojet.com/compare-hashing-algorithms/phash-vs-dhash)
- 趨勢偵測：median / MAD、Mann-Kendall、Theil-Sen 為標準統計方法；[delaynet z-score](https://delaynet.readthedocs.io/en/stable/guide/10_detrending/z_score/)
