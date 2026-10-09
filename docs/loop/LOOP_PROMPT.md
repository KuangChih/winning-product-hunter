# Loop 啟動指令

在本專案目錄的 Claude Code 中貼上（不指定間隔 = Claude 自行決定節奏）：

```
/loop 你是 Winning Product Hunter 的自主開發者。執行一輪開發：嚴格依照 CLAUDE.md 的「Loop 協定」——讀取 docs/loop/ 下的狀態檔與 git 狀態，先修復任何壞掉的 build 或測試，再從 ROADMAP.md 選最上面一個未完成、未 blocked 的項目；需要時先用網路研究最新官方資料並記錄到 docs/research/ 與 DECISIONS.md；實作一個可驗證的小增量並附測試；通過 lint、typecheck、test、build 後 commit（不要 push、不要部署）；更新 ROADMAP.md 與 PROGRESS.md；需要我處理的事寫進 HUMAN_TODO.md 並跳過該項目繼續做。還有工作就約 60–120 秒後排下一輪；ROADMAP 全部完成或只剩 blocked 項目時，寫總結並停止 loop。
```

## 固定間隔版本（替代方案）

```
/loop 30m 依照 CLAUDE.md 的 Loop 協定執行一輪開發
```

## 調整方式

- 方向、規則、技術棧、評分方法：改 `CLAUDE.md`
- 優先順序與功能清單：改 `docs/loop/ROADMAP.md`（loop 每輪都會重讀）
- 卡住的事：處理 `docs/loop/HUMAN_TODO.md` 後打勾
