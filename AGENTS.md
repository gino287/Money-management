<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 這個專案

Gino 的個人記帳系統。開工前先讀 `記帳系統_規格書.md`（不能變的規則）與 `實作計畫.md`（技術決定與分期）。

## 不能踩的線

規格書第 2.2 節的資料慣例是 Gino 記帳好幾個月累積下來的，動到就是改壞：

- **暫付款（`kind: 'advance'`）不算進一般支出**，月結算要獨立呈現
- **固定與變動支出分開計算**，不要合併成一個「總支出」數字
- **開伙記 `amount: 0` 且 `isCommunal: true`**，不是不記
- **估算金額（`isEstimated`）修正採直接覆蓋**，舊值寫進 `transaction_revisions`
- **待結清項目沒結清就要一直看得到**，這是過去漏記過的痛點
- **分類不可寫死 enum**，停用走 `isActive: false`，永遠不要刪

## 慣例

- 日期一律 `YYYY-MM-DD` 字串，經 `src/lib/format.ts` 處理。伺服器跑 UTC，「今天」永遠指台北時間
- 讀取放 `src/lib/queries.ts`，寫入放 `src/app/actions/`。不要把查詢放進 `'use server'` 檔案
- Server Action 是公開端點，一律重新驗證輸入
- UI 文案用繁體中文
