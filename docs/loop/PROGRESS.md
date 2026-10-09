# Progress Log

每輪追加一筆，最新的放最下面。格式：

```
## <YYYY-MM-DD HH:mm> — <任務>
- 完成：
- 驗證：lint ✅/❌ typecheck ✅/❌ test ✅/❌ build ✅/❌
- commit：<hash>
- 下一步：
```

## 2026-10-09 — 輪 1：資料來源研究
- 完成：`docs/research/data-sources.md`、ADR-001（官方 API + 授權第三方資料商；EU 廣告資料當代理指標）；HUMAN_TODO 新增 API 申請清單與 Meta 條款法律確認。
- 驗證：尚無程式碼（Phase 1 才建專案），品質閘門不適用。
- commit：初始 commit（含 loop 狀態檔）
- 下一步：競品研究 `docs/research/competitors.md`

## 2026-10-09 — 輪 2：競品研究
- 完成：`docs/research/competitors.md`。結論：競品評分全是黑盒子、資料新鮮度與準確度常被抱怨、多為單一來源；我們以「透明評分 + 新鮮度標示 + 跨來源佐證 + 早期訊號 + 公開回測」差異化。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：評分方法與產品實體對應研究 `docs/research/scoring.md`

## 2026-10-09 — 輪 3：評分方法研究
- 完成：`docs/research/scoring.md`（Winning Score v0 規格、robust 趨勢偵測、三層實體對應、回測計畫）、ADR-002。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：架構 ADR（資料庫、排程/抓取執行位置、驗證方案）

## 2026-10-09 — 輪 4：架構 ADR
- 完成：ADR-003（Next.js on Vercel + Neon/pgvector + Drizzle；ingestion/評分為 Node CLI jobs 由 GitHub Actions 排程；Better Auth）；CLAUDE.md 技術棧同步更新。Phase 0 完成。
- 驗證：尚無程式碼，品質閘門不適用。
- commit：見 git log
- 下一步：Phase 1 建立 Next.js 專案骨架
