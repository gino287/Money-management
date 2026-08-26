import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * 金額一律 numeric(12,2)，加總交給 Postgres 做，前端只負責顯示。
 * 台幣實務上不會用到小數，但留兩位比事後改欄位型別便宜。
 */
const amount = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** 交易性質。暫付款獨立於一般支出，月結算不可混算（規格書 2.2） */
export const TRANSACTION_KINDS = ['expense', 'income', 'advance'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * 資料來源。P1 只會有 manual，P2/P3 才會出現 web_agent 與 line。
 * import 是 2026-03~08 舊 Excel 搬進來的那批（scripts/匯入.mjs），
 * 標著它才有辦法「整批退回去」：delete from transactions where source = 'import'。
 */
export const TRANSACTION_SOURCES = ['manual', 'web_agent', 'line', 'import'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/** 待結清方向：receivable = 錢會回來（暫付款、押金、補助）；payable = 錢要付出去（借款待還） */
export const SETTLEMENT_DIRECTIONS = ['receivable', 'payable'] as const;
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];

/**
 * 使用者。一個人一本完全獨立的帳：分類、交易、待結清、原始語句都掛在自己名下，
 * 彼此看不到對方的任何東西（2026-08-26 Gino 確認：媽媽要各記各的，不是共用一本）。
 *
 * 沒有註冊頁面，也沒有「邀請」流程 —— 這是家裡兩三個人在用的東西，
 * 開帳號走 `npm run user:add`，由握有資料庫連線的人手動開。
 * 公開的註冊入口對這個規模只有壞處：多一個誰都打得到的寫入端點。
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    /**
     * 登入時要輸入的名字，同時也是畫面上顯示的稱呼。
     *
     * 存的時候原樣保留（顯示要好看），登入比對時兩邊都轉小寫並去掉前後空白 ——
     * 手機鍵盤很愛自動把第一個字母變大寫，為了這個讓人登不進去太冤。
     * 唯一鍵是一般的 unique（區分大小寫），開帳號的工具會自己擋掉
     * 只有大小寫不同的名字，免得出現兩個都能用同一組字登入的帳號。
     */
    name: text('name').notNull(),
    /** PBKDF2 雜湊，格式見 src/lib/auth.ts。絕不存明文 */
    passwordHash: text('password_hash').notNull(),
    /**
     * 這個人的 LINE userId，綁了才能用 LINE 記帳、也才收得到每日提醒。
     * 沒綁就是 null —— LINE 是加值功能，不綁一樣可以用網頁記帳。
     */
    lineUserId: text('line_user_id').unique(),
    /** 停用而非刪除，理由跟分類一樣：帳還在，人只是不再登入 */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('users_name_unique').on(t.name)],
);

/**
 * 「這是誰的」。四張資料表都要有，而且都是 notNull ——
 * 可以為 null 的話，少寫一次 where 就會讓資料變成無主的，
 * 而無主的資料在多人系統裡等於「所有人都看得到」。
 *
 * onDelete 用 restrict 不是 cascade：刪掉一個人就等於刪掉他好幾個月的帳，
 * 那種事不該因為一句 `delete from users` 就安靜地發生。要停用請用 isActive。
 */
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' });

/**
 * 原始語句。不管最後有沒有寫進正式紀錄都留著，
 * 之後用來回頭檢查 AI 判斷邏輯、微調 prompt（規格書 3）。
 */
export const rawInputs = pgTable('raw_inputs', {
  id: id(),
  userId: userId(),
  text: text('text').notNull(),
  source: text('source').notNull(),
  parsed: jsonb('parsed'),
  model: text('model'),
  /** 使用者是否確認寫入。false 代表 AI 解析過但被退掉，仍有檢討價值 */
  accepted: boolean('accepted').notNull().default(false),
  createdAt: createdAt(),
});

/**
 * 分類。可自由新增／改名／停用，不寫死 enum（規格書 2.1）。
 * 停用一律走 isActive=false，不刪除，否則舊交易會失去分類。
 */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    kind: text('kind').$type<CategoryKind>().notNull(),
    /** 固定支出（房租、壇費）預設值，月結算固定／變動分開算 */
    isFixed: boolean('is_fixed').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  // 同名分類只是「不能在同一個人底下重複」。媽媽跟 Gino 各有一個「餐食」是正常的
  (t) => [unique('categories_user_name_kind_unique').on(t.userId, t.name, t.kind)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: userId(),
    date: date('date').notNull(),
    amount: amount('amount').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<TransactionKind>().notNull(),
    note: text('note'),
    /** 建立時從分類帶入預設值，可單筆覆寫 */
    isFixed: boolean('is_fixed').notNull().default(false),
    /** 開伙：金額記 0 但仍要留紀錄，月結算另外顯示次數（規格書 2.2） */
    isCommunal: boolean('is_communal').notNull().default(false),
    /** 估算金額，跟已確認的實際金額區分。之後有真實數字時直接覆蓋並留 revision */
    isEstimated: boolean('is_estimated').notNull().default(false),
    source: text('source').$type<TransactionSource>().notNull().default('manual'),
    rawInputId: uuid('raw_input_id').references(() => rawInputs.id, { onDelete: 'set null' }),
    /**
     * 這筆是某個待結清項目的收回（或償還）。
     *
     * 「借出去 1,000，昨天還 500、今天又 500」不另外記在待結清那張表上 ——
     * 每一次收回都是真的一筆收入，綁回來就算得出還剩多少。
     * 錢只有一份紀錄，待結清頁上的「已收 1,000」是算出來的，不是另外維護的數字。
     */
    settlementId: uuid('settlement_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  /*
   * 索引一律以 user_id 開頭。多人之後每一支查詢都必然帶著「這是誰的」，
   * 只建在 date 上的索引會先掃遍所有人的帳再篩人，白做一大半工。
   */
  (t) => [
    index('transactions_user_date_idx').on(t.userId, t.date.desc()),
    index('transactions_user_category_idx').on(t.userId, t.categoryId),
    index('transactions_user_kind_idx').on(t.userId, t.kind),
  ],
);

/**
 * 跨月待結清。暫付款、媽媽借款待追蹤、押金待回收、補助待回收都走這裡。
 * 規格書明講這類項目過去漏記過，所以只要還有 open 的，首頁就要一直看得到。
 * 結清一律手動確認，系統不自動轉帳（Gino 2026-08-10 確認）。
 */
export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    userId: userId(),
    title: text('title').notNull(),
    expectedAmount: amount('expected_amount'),
    direction: text('direction').$type<SettlementDirection>().notNull(),
    status: text('status').$type<'open' | 'settled'>().notNull().default('open'),
    /**
     * 大概什麼時候會回來（`YYYY-MM`，不知道就留 null）。
     *
     * 首頁只提醒「這個月到期、已經過期、沒寫時間」的三種。押金要等到 2027 年退租，
     * 天天在首頁擋路只會讓人為了讓它閉嘴而按下結清 —— 那是在資料上說謊，
     * 而且是系統逼的。沒結清的項目永遠不會消失（規格書 2.2），
     * 但「看得到」不等於「天天擋在路中間」。
     */
    dueMonth: text('due_month'),
    /** 起因的那筆交易，例如當初墊出去的暫付款 */
    originTransactionId: uuid('origin_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    /** 結清時對應的那筆收入或轉正支出 */
    settledByTransactionId: uuid('settled_by_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [index('settlements_user_status_idx').on(t.userId, t.status)],
);

/**
 * 修改稽核。估算金額拿到實際數字時採直接覆蓋，舊值存這裡
 * （Gino 2026-08-10 確認：主表只留一筆乾淨資料，但要查得到改過什麼）。
 */
export const transactionRevisions = pgTable(
  'transaction_revisions',
  {
    id: id(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transaction_revisions_tx_idx').on(t.transactionId)],
);

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
