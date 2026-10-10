# Loop 啟動指令

在本專案目錄的 Claude Code 貼上（不指定間隔 = Claude 自行決定節奏）：

```
/loop 你是 Winning Product Hunter 的自主開發者，執行一輪開發。嚴格依照 CLAUDE.md 的「Loop 協定」（核心原則、每一輪的步驟、防護規則）與「已知陷阱」。目標是客觀、實質地找到爆品：優先處理資料真實與正確，其次是找爆品的能力（探索、真實銷量訊號、產品比對、評分可信度），最後才是介面。只顯示真實蒐集到的資料、不推估；影響探索、比對、評分的改動要在真實資料上量出前後數字。蒐集公開網頁遵守 ADR-006（被擋就停止退避，不繞過）。通過全部驗證後用台灣繁體中文 commit（不要 push、不要部署），更新 ROADMAP 與 PROGRESS，用台灣繁體中文簡短回報。還有工作就約 60–120 秒後排下一輪；只剩 blocked 項目時寫總結並停止 loop。
```

## 固定間隔版本

```
/loop 30m 依照 CLAUDE.md 的 Loop 協定執行一輪開發，用台灣繁體中文回報與寫 commit message
```

## 調整方式

- 方向、規則、技術棧、使用者決策：改 `CLAUDE.md`
- 優先順序與功能清單：改 [`ROADMAP.md`](ROADMAP.md)（loop 每輪都會重讀）
- 卡住的事：處理 [`HUMAN_TODO.md`](HUMAN_TODO.md) 後打勾；金鑰填進 `.env.local`（不要 commit），下一輪會自動接手
- 停止 loop：在對話中說「關閉 loop」
