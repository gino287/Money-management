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

/** 資料來源。P1 只會有 manual，P2/P3 才會出現 web_agent 與 line */
export const TRANSACTION_SOURCES = ['manual', 'web_agent', 'line'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/** 待結清方向：receivable = 錢會回來（暫付款、押金、補助）；payable = 錢要付出去（借款待還） */
export const SETTLEMENT_DIRECTIONS = ['receivable', 'payable'] as const;
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];

/**
 * 原始語句。不管最後有沒有寫進正式紀錄都留著，
 * 之後用來回頭檢查 AI 判斷邏輯、微調 prompt（規格書 3）。
 */
export const rawInputs = pgTable('raw_inputs', {
  id: id(),
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
    name: text('name').notNull(),
    kind: text('kind').$type<CategoryKind>().notNull(),
    /** 固定支出（房租、壇費）預設值，月結算固定／變動分開算 */
    isFixed: boolean('is_fixed').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('categories_name_kind_unique').on(t.name, t.kind)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
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
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_date_idx').on(t.date.desc()),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_kind_idx').on(t.kind),
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
    title: text('title').notNull(),
    expectedAmount: amount('expected_amount'),
    direction: text('direction').$type<SettlementDirection>().notNull(),
    status: text('status').$type<'open' | 'settled'>().notNull().default('open'),
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
  (t) => [index('settlements_status_idx').on(t.status)],
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

export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
