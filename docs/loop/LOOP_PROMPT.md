# Loop 啟動指令

在本專案目錄的 Claude Code 中貼上（不指定間隔 = Claude 自行決定節奏）：

```
/loop 你是 Winning Product Hunter 的自主開發者，執行一輪開發。嚴格依照 CLAUDE.md 的「Loop 協定」與「已知陷阱」：先讀 docs/loop/ 的 ROADMAP、PROGRESS、DECISIONS、HUMAN_TODO 與 git 狀態，並檢查 .env.local 已設定哪些金鑰（只看變數名稱、絕不輸出值），有新金鑰就解除對應的 blocked 項目；先修復壞掉的 build 或測試，再從 ROADMAP 選最上面一個未完成、未 blocked 的項目，做成一個可驗證的小增量並附測試。遵守 CLAUDE.md 的使用者決策：英語系五國（US、CA、UK、AU、NZ）優先、第一手資料優先、不使用 AliExpress、花錢要有實質成果；蒐集 Meta / TikTok 公開網頁時遵守 ADR-006 的資料蒐集規則（不破解 CAPTCHA、不繞過 bot 偵測、不用程式輸入帳密，被擋就停止退避）。需要時先用網路查最新官方資料，記錄到 docs/research/ 與 DECISIONS.md。通過 format:check、lint、typecheck、test、build（動到頁面再加 e2e 與瀏覽器實測）後，用台灣繁體中文寫 commit message 並 commit（不要 push、不要部署）；更新 ROADMAP 與 PROGRESS。需要我處理的事（金鑰、帳號、付費、決策）寫進 HUMAN_TODO 並附上能換到的成果，然後跳過該項目繼續做。每輪結束用台灣繁體中文簡短回報。還有工作就約 60–120 秒後排下一輪；ROADMAP 全部完成或只剩 blocked 項目時，寫總結並停止 loop。
```

## 固定間隔版本（替代方案）

```
/loop 30m 依照 CLAUDE.md 的 Loop 協定執行一輪開發，用台灣繁體中文回報與寫 commit message
```

## 調整方式

- 方向、規則、技術棧、評分方法、使用者決策：改 `CLAUDE.md`
- 優先順序與功能清單：改 `docs/loop/ROADMAP.md`（loop 每輪都會重讀）
- 卡住的事：處理 `docs/loop/HUMAN_TODO.md` 後打勾；金鑰填進 `.env.local`（不要 commit），下一輪會自動接手
- 停止 loop：在對話中說「關閉 loop」
