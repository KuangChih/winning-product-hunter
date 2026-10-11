# Meta 官方 Ad Library API（英國／歐盟）研究

2026-10-11，依官方文件整理。**還沒有 `META_ACCESS_TOKEN`，沒有任何真實請求**；程式與測試都依文件格式寫成，拿到 token 後要先做第五節的實測再當成正式結論。決策見 ADR-015。

## 一、為什麼要接

- Vercel 上 Meta Ad Library **網站**回 HTTP 403（Meta 擋了機房 IP），依 ADR-006 不繞過。官方 API 是另一個服務（Graph API），用 token 認證，從 Vercel 呼叫是正常用途，第一手、免費。
- 範圍限制：官方 API 只提供「過去 1 年在英國或歐盟投放」的所有類型廣告；其他地區只有社會議題、選舉、政治廣告。**美國、加拿大、澳洲、紐西蘭的商業廣告 API 完全沒有**；挪威不在歐盟，也沒有。
- 對本專案目標市場：英國（第一優先五國之一）＋德國、法國、瑞典、比利時、西班牙（第二優先）可以拿到。

## 二、官方文件（2026-10-11 查閱）

- [ads_archive（查詢端點）](https://developers.facebook.com/docs/graph-api/reference/ads_archive/)、[ArchivedAd（回傳物件）](https://developers.facebook.com/docs/graph-api/reference/archived-ad/)、[Ad Library API 說明與申請](https://www.facebook.com/ads/library/api/)、[Graph API 速率限制](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)。
- 文件頁顯示的 Graph API 版本：**v26.0**（程式用 `https://graph.facebook.com/v26.0/ads_archive`）。

### 查詢參數（本專案使用的）

| 參數                   | 文件說明                                                     | 我們的值                                        |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `ad_reached_countries` | 必填，`ALL` 或 ISO 國碼陣列                                  | `["GB","DE","FR","SE","BE","ES"]`（一次查全部） |
| `ad_type`              | `ALL`（預設）、`POLITICAL_AND_ISSUE_ADS` 等                  | `ALL`                                           |
| `ad_active_status`     | `ACTIVE`（預設）、`ALL`、`INACTIVE`                          | `ACTIVE`                                        |
| `search_terms`         | 最多 100 字元，空白代表 AND                                  | 本次 run 的關鍵字                               |
| `search_type`          | `KEYWORD_UNORDERED`（預設）、`KEYWORD_EXACT_PHRASE`          | `KEYWORD_UNORDERED`                             |
| `fields`、`limit`、`after` | ads_archive 頁面沒寫；是 Graph API 通用參數（欄位選擇、分頁） | 見下表的欄位；`limit=100`；目前只取第一頁       |

其他文件參數（未使用）：`search_page_ids`（≤10 個粉專）、`ad_delivery_date_min/max`、`languages`、`publisher_platforms`、`media_type`、`unmask_removed_content`。

### 回傳欄位（ArchivedAd，本專案請求的）

| 欄位                          | 文件說明（摘要）                                               | 用途                                                      |
| ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `id`                          | 廣告的 Library ID                                              | `externalId` 為 `api` 前綴加 ID；公開連結 `ads/library/?id=<id>` |
| `page_id` / `page_name`       | 投放廣告的粉專                                                 | 廣告主（評分的廣告主數）                                  |
| `ad_creation_time`            | 廣告建立時間（不是投放時間）                                   | 沒有開始投放時間時的備用                                  |
| `ad_delivery_start_time`      | 廣告主設定的開始投放時間（UTC）                                | 廣告持久度、14 天新增                                     |
| `ad_delivery_stop_time`       | 廣告主設定的停止時間；空白＝一直投放到手動停止或預算用完       | `endedAt`（未來的時間＝排定的結束，仍算投放中）           |
| `ad_creative_bodies`          | 每張卡片的內文                                                 | 只存證據                                                  |
| `ad_creative_link_titles`     | 每張卡片 CTA 區的標題                                          | **產品分組**（正規化後的標題）                            |
| `ad_creative_link_captions`   | 每張卡片 CTA 區的說明文字                                      | **產品分組**（顯示的網域）                                |
| `ad_creative_link_descriptions` | 每張卡片 CTA 區的連結描述                                    | 只存證據                                                  |
| `publisher_platforms`         | 出現的平台（Facebook、Instagram…）                             | 只存證據                                                  |
| `languages`                   | 廣告語言（ISO 639-1）                                          | 只存證據                                                  |
| `eu_total_reach`              | 歐盟的估計觸及（int32），只限投放到歐盟的廣告                  | metric `eu_total_reach`                                   |
| `total_reach_by_location`     | 依地區的估計觸及，`list<KeyValue:string,int32>`，目前支援 EU、BR、UK | 只有鍵為 `UK` 的數字才存成 metric `uk_total_reach` |

- **不請求** `ad_snapshot_url`：網址含 access token，不可儲存或顯示。程式就算收到也會丟掉。
- 只有政治廣告才有的欄位（`spend`、`impressions`、`demographic_distribution`…）不使用。英國／歐盟才有的 `target_ages`、`target_gender`、`target_locations`、`age_country_gender_reach_breakdown` 目前不使用（`target_locations` 的物件格式文件沒有展開，拿到 token 後可評估用來判斷是哪個歐盟國家）。

### 錯誤碼

- ads_archive 文件列出：`613` 超過速率限制、`100` 參數錯誤、`2500` 查詢解析錯誤、`1009` 參數驗證失敗、`190` OAuth token 無效。
- Graph API 速率限制文件：`4` app 達上限、`17` 使用者達上限、`32` 粉專 API 上限、`613` 特定 API 的自訂上限。User token 的每小時上限**不公開**（文件說為了隱私隱藏），同一個使用者在所有 app 的呼叫一起算。回應可能帶 `X-App-Usage` 標頭（`call_count` 等百分比）。
- Ad Library API 沒有公開具體的速率數字。

### 申請條件（Ad Library API 頁）

1. 到 facebook.com/ID 完成身分與所在地確認（刊登社會議題／政治廣告用的那一種，審核可能要幾天）。
2. 建立 Meta for Developers 帳號並同意 Platform Policy。
3. 回到 Ad Library API 頁按「Access the API」建立 app。
4. 用 Graph API Explorer 以這個 app 產生 user access token，換成長效 token（約 60 天）。頁面沒有指定 token 類型；這是常見做法，要實測確認。

## 三、本專案的做法（ADR-015）

- **一個關鍵字一次請求**：`ad_reached_countries` 一次放英國＋五個歐盟目標國，每 run 最多 10 次請求、間隔 2 秒、先記帳再送出、只取第一頁（100 則）、不自動重試。不依國家拆開，是為了把請求數壓在每 run 10 次。
- **國家**：一次查多國時，API 不說廣告到了哪一國；只有 `total_reach_by_location` 的 UK 觸及 > 0 時標成 `GB`，其他不標國家（歐盟觸及說不出是哪一國）。所以「市場覆蓋」不會被高估，但歐盟國家的覆蓋目前算不到。
- **產品分組**（官方 API 沒有商品頁網址）：每則廣告所有卡片的 `link_caption` 必須是同一個網域、`link_title` 正規化後必須是同一個標題（輪播多商品、一則廣告多網域都不分組）；產品鍵 `meta-api:<網域>|<正規化標題>`。標題至少 2 個內容字、不是 CTA（Shop now…）或樣板（`{{…}}`）；網域不能是 Facebook、Instagram、WhatsApp、短網址等。
- **有潛力的門檻**：跟網站版相同（`DISCOVERY_RULES`）：≥ 2 則廣告，或有廣告已投放 ≥ 14 天。
- **掛到網站版產品**（保守）：(1) 網站版已存了同一個 Library ID 的廣告 → 掛到那個產品（若這些廣告分屬不同產品就整組略過）；(2) 否則同一個店家網域（產品的商品頁或其網站版廣告的 landing host）＋ 同一個 Shopify handle（優先）或標題 Jaccard ≥ 0.6；同一家店有兩個以上一樣像的產品就略過，**不掛、也不另建**（避免重複產品）。
- **不覆蓋網站版**：externalId 用 `api|<id>`，跟網站版（`<id>`）是不同紀錄；網站版的 `raw`、`landing_url`、國家、廣告掛產品、repair 都不受影響。
- **不重複計算**：評分以「來源 + Library ID」去重（網站版紀錄為主，API 紀錄補上國家與觸及）；廣告動能的每日廣告數 SQL、詳情頁的廣告數、廣告頁列表也都去重。
- **錯誤**：190 → 停止這次 run 的官方 API、不退避（要使用者換 token）；613／4／17／32／429 → 停止並對這個出口退避（provider `ad_library_api`，6 → 12 → 24 小時…，跟網站版的退避互不影響）；其他 4xx（例如還沒有 API 權限）→ 停止、不退避；5xx／網路 → 記錄後繼續下一個關鍵字。錯誤訊息不含 token 與請求網址。

## 四、可信度

- 觸及人數（`eu_total_reach`、UK 觸及）是 **Meta 自己的估計**（平台公開計數），不是訂單或銷量；目前只存起來在詳情頁顯示，**沒有計入分數**，等累積資料後再評估。
- 開始投放時間是廣告主設定的時間；跟網站版一樣用來算持久度。
- `link_caption` 是「說明文字」，文件沒有保證一定是網域；我們只接受看起來像網域的值，其他廣告不分組。

## 五、拿到 token 後要實測的事（少量請求，遵守 ADR-006）

1. 用一個關鍵字（例如 `led face mask`）、`ad_reached_countries=["GB"]` 請求一次，確認：200 回應、`data` 陣列、`paging.cursors.after` 的格式。
2. `ad_creative_link_captions` 實際是不是網域（大小寫、有沒有 `www.`、有沒有路徑）；多少比例的廣告能分組（有網域＋有產品標題）。
3. `total_reach_by_location` 的 JSON 形狀是不是 `[{"key":"UK","value":123}]`、鍵名是不是 `UK`（程式只接受這個形狀；形狀不同就不存 UK 觸及）。`eu_total_reach` 是否只出現在歐盟廣告。
4. 同一則廣告在網站（`ad_archive_id`）與 API（`id`）的 ID 是否相同（目前依文件「Library ID」推定相同；去重依賴這一點）。
5. 一次放 6 個國家的 `ad_reached_countries` 是否正常（文件是陣列，但沒有寫多國的語意）。
6. 回應標頭 `X-App-Usage` 的數字，決定每 run 10 次是否太多或太少。
7. 量測：在示範資料庫複本跑一次，記錄新增幾個英國／歐盟產品、掛到既有產品幾個、略過幾組，寫回本文件與 PROGRESS。

## 六、限制

- 美國、加拿大、澳洲、紐西蘭、挪威拿不到（官方範圍）。
- 沒有商品頁網址與創意變體數；同一家店的不同產品只能靠廣告標題分開，標題寫得很行銷（例如「50% OFF Today」）的廣告會被分錯組或丟掉。
- 沒有圖片（`ad_snapshot_url` 含 token 不能用），所以官方 API 建立的產品沒有照片，照片去重無法作用。
- 一次查多國時，歐盟廣告不知道是哪一國。
- token 約 60 天過期，過期時探索頁會顯示「Meta 拒絕了存取權杖」，要使用者換新的。
