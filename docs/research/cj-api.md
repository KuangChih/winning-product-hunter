# CJ Dropshipping API v2 實測（2026-10-11）

> 目的：確認 CJ 官方 API 能不能在 Meta 被擋時（Vercel 機房 IP 回 403）當作**不依賴 Meta 的探索來源**，以及它實際回傳哪些銷量訊號。結論寫進 ADR-014。
> 方法：讀官方文件，再用使用者的 `CJ_API_KEY` 打**少量**真實請求（研究階段共 1 次 token、5 次商品列表、21 次商品詳情、1 次商品查詢），另外 3 次探索單位實測 50 點的列表各 1 次，之後在 3 個示範資料庫複本各跑一次完整探索（51、47、51 次請求，各 550 點）。金鑰與 token 從未印出或寫進檔案；錄下的回應只保留用得到的欄位，沒有帳號資訊（`src/ingestion/sources/__recordings__/cj-*.json`）。

## 一、端點與實測結果

| 用途 | 端點 | 點數（官方） | 實測 |
| --- | --- | --- | --- |
| 取得 token | `POST /authentication/getAccessToken`，body `{ apiKey }` | 0 | 回 `accessToken`、`accessTokenExpiryDate`（約 180 天後）、`refreshToken`、`openId`。24 小時內重複呼叫回同一組 token。文件寫 QPS=1；舊版文件寫每 5 分鐘 1 次 → **我們存進資料庫重複使用，到期前 7 天才重取** |
| 商品列表 | `GET /product/listV2` | 50 / 次 | 實際扣 50 點（`pointsInfo.usedToday` 0 → 50 → 100 → 150）。`totalRecords` 上限 6000 |
| 商品詳情（銷量） | `POST /product/productDetail/query`，body `{ id }` | 未列出 = 0 | **實測 0 點**（連續 21 次 `usedToday` 不變）。欄位是全小寫 |
| 商品查詢 | `GET /product/query?pid=` | 10 / 次 | 實際扣 10 點；沒有銷量欄位，只有 `listedNum`、`sellPrice`、變體與庫存 |

每個回應都帶 `pointsInfo: { total, usedToday, remaining }`。帳號每日 50,000 點（UTC 0 點重置、每分鐘回補 1/1440），`remaining` 在用量很小時一直顯示 50000。

**限速**：免費帳號 1 QPS（每 IP 10 req/s、每 IP 最多 3 個帳號）。我們每次請求間隔 1.1 秒，研究與量測都沒有遇到限流。

**錯誤碼**（官方全域錯誤表 + 點數規則頁）：`1600001` 無權限 / token 無效、`1600003` refresh token 失效、`1601000` 找不到使用者（金鑰錯）、`1600200` 呼叫超過上限、`1600000` 系統忙碌、HTTP 429 + `code: 429` + 「Insufficient API points」= 點數用完。

## 二、`listV2` 實際回傳（文件與實際不同的地方）

- 每筆商品有 `id`、`nameEn`、`sku`、`bigImage`、`sellPrice`（可能是區間 `"0.74 -- 6.48"`）、`nowPrice`（折扣價，可能是 `"0.52-3.89"` 或 null）、`listedNum`（幾個 CJ 使用者把商品上架到自己的店）、`saleStatus`（`"3"` = 販售中）、`threeCategoryName`、`warehouseInventoryNum` 等。
- **`createAt` 實際都是 null**（文件說是毫秒時間）；商品上架 CJ 的時間要從詳情的 `createdate`（字串毫秒）拿。
- **沒有銷量欄位**；Trending 只能當篩選條件（`productFlag=0`），回應裡沒有 trending 標記。
- `orderBy=1`（上架數）＋關鍵字：結果很快偏離主題（例：`acupressure mat` 排在前面的是寵物涼墊、狗窩）。`orderBy=0`（最佳比對）前 5–7 筆相關、之後也開始偏離 → 關鍵字只看最佳比對的前 10 筆。
- Trending 的時間篩選（`timeStart`，文件寫「上架時間」）：近 180 天只有 7 個 trending 商品、近 365 天 18 個、近 730 天 132 個；但篩出來的商品詳情 `createdate` 多在 5–9 年前，篩的顯然不是商品建立時間，而且大多沒有訂單 → 不用這個篩選。不限時間時上架數最高的是老商品（例：Magic Shadow 加濕器 2020 年上架、23,657 個店上架），但它們多數仍有近期訂單。

## 三、`productDetail/query` 的銷量欄位（最重要的發現）

- 文件說 `soldOut` = 近 90 天銷量。**實測 21 個商品＋三次量測共 116 個詳情，`soldOut` 全部是 null**。
- 有值的是 `orderCount`（文件：「這個 SPU 的訂單數」，**未寫統計期間**）、`totalQuantity`（這些訂單的件數）、`totalRefundQuantity`、`qualityDisputeRate`（= 退款件數 ÷ `totalQuantity`，例 8 ÷ 166 = 4.82%）、`latestPaymentDate`（最近一筆付款的毫秒時間）、`listed`。
- 期間推測：2020 年上架、23,657 個店上架的商品只有 137 筆訂單；`orderCount = 0` 的商品 `latestPaymentDate` 一定是 null；有訂單的商品最近一筆付款都在 2 個月內。→ **看起來是近期窗口的計數，但 CJ 沒公開期間**，所以我們標成「CJ 訂單數（CJ 未公開統計期間）」，不當成 90 天銷量。
- 研究樣本的 `orderCount`：0、0、0、2、7、11、13、20、26、29、110、137、155、193、234、682、7,422（另有 1 個全部 null）。

## 四、可信度與限制

- 可信度等級：**平台計數**（CJ 自己系統的訂單數與上架數），不是店家自報，也不是整個市場的銷量；只算經由 CJ 下的單。
- `listedNum` 是「上架」不是「賣出」，而且是累計，越老的商品越高 → 只用來挑選要查詳情的商品，以及顯示；不當成熱度。
- CJ 的商品頁（`cjdropshipping.com/product/<slug>-p-<id>.html`）有反爬驗證頁，程式不讀取，只當成給使用者點的連結（格式依 CJ 網站慣例，自動化無法驗證能否開啟）。
- ToS：API 資料用於個人研究；若對外開放或收費，要重新確認 CJ 的條款（HUMAN_TODO）。

## 五、我們的用法與量測（ADR-014）

- 每次探索：CJ trending（不限時間，依上架數取前 10）＋本次的關鍵字（每個依上架數排序的前 20 筆中取上架數最高的 3 個），最多 11 次列表（550 點）＋ 40 次詳情（0 點）。
- 門檻（`src/discovery/cj.ts`）：查詳情需 `listedNum ≥ 50`；建立產品需 `orderCount`（或有值時的 `soldOut`）≥ 50 **且**最近一筆付款在 30 天內（還在賣，不是過去的爆品）。
- 三種挑選方式在示範資料庫複本上的比較（Meta 模擬被擋，同一組 10 個關鍵字）：

| 挑選方式 | 請求 | 列表商品 | 查詳情 | 建立產品 |
| --- | --- | --- | --- | --- |
| A：全部列表合併後取上架數前 40（trending 近 180 天） | 51 | 507 | 40 | 13 |
| B：trending 近 365 天取 10 ＋ 關鍵字最佳比對前 10 筆取 3 | 47 | 218 | 36 | 3 |
| **C（採用）**：trending 不限時間取 10 ＋ 關鍵字依上架數前 20 筆取 3 | 51 | 250 | 40 | **19** |

  - A 的 40 個詳情：訂單數 ≥ 50 的 17 個，其中 4 個最近一筆付款已超過 30 天（38–55 天）→ 13 個。B 的 trending 近 365 天 10 個中 7 個沒有任何訂單。
  - C 的 19 個：訂單數 77–7,422；最近付款 3–28 天前；上架 CJ 約 3–9 年。關鍵字依上架數排序時會出現不同主題的商品（例：`acupressure mat` 找到寵物涼墊），但它們確實有訂單，`raw.candidate.foundBy` 記錄是哪個請求找到的。

## 參考

- [CJ Developers — Product](https://developers.cjdropshipping.com/en/api/api2/api/product.html)
- [CJ Developers — Authentication](https://developers.cjdropshipping.com/en/api/api2/api/auth.html)
- [CJ Developers — Access Frequency Restrictions](https://developers.cjdropshipping.com/en/api/start/limit.html)
- [CJ Developers — API Points Resource Rules](https://developers.cjdropshipping.com/en/api/api2/standard/points.html)
- [CJ Developers — Global Error Codes](https://developers.cjdropshipping.cn/en/api/api2/standard/ps-code.html)
