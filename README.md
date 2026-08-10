# 記帳

Gino 的個人記帳系統。規則看 `記帳系統_規格書.md`，技術決定與分期看 `實作計畫.md`。

---

## 第一次設定

### 1. 開一個 Supabase 資料庫

1. 到 <https://supabase.com> → **Start your project** → 用 GitHub 登入
2. **New project**
   - Name：`ledger`（隨意）
   - Database Password：**自己設一組並記下來**，等一下要用
   - Region：選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，離台灣近
3. 等 1～2 分鐘建好
4. 左下 **Project Settings** → **Database** → 找到 **Connection string** → 切到 **Transaction pooler**（網址結尾是 `:6543`）
5. 複製那串網址，把裡面的 `[YOUR-PASSWORD]` 換成第 2 步設的密碼

> 一定要用 Transaction pooler（6543），不要用 Direct connection（5432）。
> Vercel 是 serverless，直連會把資料庫連線數吃光。

### 2. 填環境變數

把 `.env.example` 複製成 `.env.local`，填四個值：

```bash
cp .env.example .env.local
```

| 變數 | 怎麼來 |
|---|---|
| `DATABASE_URL` | 上一步複製的連線字串 |
| `APP_PASSWORD` | 自己想一組登入密碼 |
| `AUTH_SECRET` | 跑 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEEPSEEK_API_KEY` | P2 才用得到，先留空 |

### 3. 建表、灌分類

```bash
npm install
npm run db:push    # 建立五張資料表
npm run db:seed    # 灌入規格書上的分類
```

### 4. 跑起來

```bash
npm run dev
```

開 <http://localhost:3000>，用 `APP_PASSWORD` 登入。

---

## 部署到 Vercel

1. 在 GitHub 網頁建一個 **private** repo（不要勾任何初始化選項）
2. 接上並推上去：
   ```bash
   git remote add origin https://github.com/<你的帳號>/<repo 名>.git
   git push -u origin main
   ```
3. 到 <https://vercel.com> 用 GitHub 登入 → **Add New → Project** → 選這個 repo
4. 展開 **Environment Variables**，把 `.env.local` 裡的 `DATABASE_URL`、`APP_PASSWORD`、`AUTH_SECRET` 三個都填進去
5. **Deploy**

部署完會拿到一個網址。iPhone 用 Safari 打開 → 分享 → **加入主畫面**，之後從主畫面圖示點進去就是全螢幕。

> 不能用 Chrome 加主畫面，iOS 上只有 Safari 支援。

---

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 本機開發 |
| `npm run build` | 建置（部署前確認能過） |
| `npm run db:push` | 把 `src/db/schema.ts` 的改動同步到資料庫 |
| `npm run db:seed` | 灌預設分類（重跑不會覆蓋既有的） |
| `npm run db:studio` | 開瀏覽器直接看／改資料庫內容 |
| `node scripts/make-icons.mjs` | 重新產生 PWA 圖示（改了設計才需要） |

---

## 目前進度

- [x] **P0** 骨架、資料模型、密碼登入
- [x] **P1** 手動記帳、明細與篩選、事後修改（留稽核）、分類管理、待結清追蹤、PWA
- [ ] **P2** 口語輸入（DeepSeek）
- [ ] **P3** LINE Bot、每日提醒、桌面快捷鍵、離線記帳佇列
- [ ] **P4** 視覺化與月結算頁
- [ ] **P5** 舊 Excel 匯入、匯出
