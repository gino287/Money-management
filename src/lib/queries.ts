import { and, asc, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  categories,
  settlements,
  transactions,
  type CategoryKind,
  type TransactionKind,
} from '@/db/schema';

import { monthRange } from './format';

export type TransactionRow = {
  id: string;
  date: string;
  amount: number;
  kind: TransactionKind;
  note: string | null;
  isFixed: boolean;
  isCommunal: boolean;
  isEstimated: boolean;
  categoryId: string;
  categoryName: string;
};

const transactionSelect = {
  id: transactions.id,
  date: transactions.date,
  amount: transactions.amount,
  kind: transactions.kind,
  note: transactions.note,
  isFixed: transactions.isFixed,
  isCommunal: transactions.isCommunal,
  isEstimated: transactions.isEstimated,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
};

export async function getCategories(opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(categories)
    .where(opts.activeOnly ? eq(categories.isActive, true) : undefined)
    .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name));
}

export type TransactionFilters = {
  month?: string;
  categoryId?: string;
  kind?: TransactionKind;
  estimatedOnly?: boolean;
  search?: string;
};

export async function getTransactions(
  filters: TransactionFilters = {},
  limit?: number,
): Promise<TransactionRow[]> {
  const conditions = [];

  if (filters.month) {
    const { start, end } = monthRange(filters.month);
    conditions.push(gte(transactions.date, start), lt(transactions.date, end));
  }
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.estimatedOnly) conditions.push(eq(transactions.isEstimated, true));
  if (filters.search) conditions.push(ilike(transactions.note, `%${filters.search}%`));

  const query = db
    .select(transactionSelect)
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    // 同一天記的多筆按建立時間排，補記時順序才符合直覺
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

  return limit ? query.limit(limit) : query;
}

export async function getTransaction(id: string): Promise<TransactionRow | undefined> {
  const [row] = await db
    .select(transactionSelect)
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.id, id))
    .limit(1);
  return row;
}

export type MonthSummary = {
  variableExpense: number;
  fixedExpense: number;
  advance: number;
  income: number;
  /** 收入 −（變動＋固定支出）。暫付款不算進來，它還不是真正的花費 */
  net: number;
  communalCount: number;
  estimatedCount: number;
  count: number;
};

/**
 * 月結算。規格書 2.2 的三條紅線都在這裡：
 * 固定與變動分開、暫付款不併入一般支出、開伙記 0 元但要看得到次數。
 *
 * 一個月的筆數頂多幾百筆，在 JS 算比拼 SQL 聚合好讀也好改。
 */
export function summarize(rows: TransactionRow[]): MonthSummary {
  const summary: MonthSummary = {
    variableExpense: 0,
    fixedExpense: 0,
    advance: 0,
    income: 0,
    net: 0,
    communalCount: 0,
    estimatedCount: 0,
    count: rows.length,
  };

  for (const row of rows) {
    if (row.isCommunal) summary.communalCount += 1;
    if (row.isEstimated) summary.estimatedCount += 1;

    if (row.kind === 'income') summary.income += row.amount;
    else if (row.kind === 'advance') summary.advance += row.amount;
    else if (row.isFixed) summary.fixedExpense += row.amount;
    else summary.variableExpense += row.amount;
  }

  summary.net = summary.income - summary.variableExpense - summary.fixedExpense;
  return summary;
}

/** 給分類管理頁顯示「這個分類用過幾次」，判斷能不能安心停用 */
export async function getCategoryUsage(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(transactions)
    .groupBy(transactions.categoryId);

  return new Map(rows.map((r) => [r.categoryId, r.count]));
}

export async function getSettlements(status?: 'open' | 'settled') {
  return db
    .select()
    .from(settlements)
    .where(status ? eq(settlements.status, status) : undefined)
    .orderBy(asc(settlements.status), desc(settlements.openedAt));
}

/** 分類的預設 isFixed，新增交易時用來帶值 */
export async function getCategory(id: string) {
  const [row] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return row;
}

export function categoryKindFor(kind: TransactionKind): CategoryKind {
  // 暫付款是錢先出去，用支出側的分類
  return kind === 'income' ? 'income' : 'expense';
}
