import { and, asc, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';
import { cache } from 'react';

import { db, dbGeneration, resetDb } from '@/db';
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

/**
 * 讀取查詢的保命包裝。
 *
 * 走 Supabase 的 pooler 時，偶爾會發生「查詢送出去了、回應永遠不回來」——
 * 資料庫端其實沒有在跑那支查詢（用 pg_stat_activity 查過是空的），
 * 但程式這邊會一直等，等到資料庫兩分鐘的 statement timeout 才收到錯誤。
 * 使用者看到的就是一片黑、一直轉。
 *
 * 所以自己設一道 3 秒上限：超過就放棄，整組連線丟掉重建，再重試一次。
 * 正常查詢在 Vercel 上是個位數毫秒、在家裡的電腦上是四十幾毫秒，
 * 最慢的一次（全新連線 + 冷啟動）也不到 1 秒，
 * 所以 3 秒代表「這條連線已經死了」，不是「資料庫很忙」。
 *
 * 「死了」不是誇飾：實測過把重建關掉，那些逾時的查詢一支都沒有回來過，
 * 連遲到都沒有。而且整個池子會一起死，連 /api/health 都不回。
 * 有重建的時候驗收腳本 29/30 通過，關掉重建只跑得完 3 項。
 *
 * 只包讀取。寫入不能這樣重試 —— 沒收到回應不代表沒寫進去，重試會變成記兩筆。
 */
const READ_TIMEOUT_MS = 3_000;

async function read<T>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const generation = dbGeneration();
    const startedAt = Date.now();
    let gaveUp = false;
    const running = run();
    // 被放棄的那一支之後才失敗的話，不能讓它變成沒人接的 rejection 把行程打掛。
    // 順便留一行紀錄：知道它到底是「慢」還是「真的永遠不回來」，差很多。
    running.then(
      () => {
        if (gaveUp) console.warn(`[db] ${label} 在放棄後第 ${Date.now() - startedAt}ms 才回來`);
      },
      (error) => {
        if (gaveUp) {
          console.warn(
            `[db] ${label} 在放棄後第 ${Date.now() - startedAt}ms 才失敗：${(error as Error).message.slice(0, 60)}`,
          );
        }
      },
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        running,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`查詢逾時（${label}）`)), READ_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      gaveUp = true;
      if (attempt >= 2) throw error;
      console.warn(`[db] ${label} 失敗，重試一次：${(error as Error).message.slice(0, 100)}`);
      // 重試不能再用同一批連線 —— 壞掉的通常是整組，不是剛好那一條
      resetDb(generation, `${label} 沒有回應`);
    } finally {
      clearTimeout(timer);
    }
  }
}

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

/**
 * 用 React 的 cache 包起來，同一次請求裡 layout 跟 page 都要用時只會查一次。
 * 少一支查詢就少一條連線，首頁一次要查好幾樣，這件事有差。
 */
export const getCategories = cache(async (opts: { activeOnly?: boolean } = {}) => {
  return read('分類清單', () =>
    db
      .select()
      .from(categories)
      .where(opts.activeOnly ? eq(categories.isActive, true) : undefined)
      .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name)),
  );
});

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

  return read('交易明細', () => (limit ? query.limit(limit) : query));
}

export async function getTransaction(id: string): Promise<TransactionRow | undefined> {
  const [row] = await read('單筆交易', () =>
    db
      .select(transactionSelect)
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(eq(transactions.id, id))
      .limit(1),
  );
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
  const rows = await read('分類使用次數', () =>
    db
      .select({
        categoryId: transactions.categoryId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(transactions)
      .groupBy(transactions.categoryId),
  );

  return new Map(rows.map((r) => [r.categoryId, r.count]));
}

export const getSettlements = cache(async (status?: 'open' | 'settled') => {
  return read('待結清清單', () =>
    db
      .select()
      .from(settlements)
      .where(status ? eq(settlements.status, status) : undefined)
      .orderBy(asc(settlements.status), desc(settlements.openedAt)),
  );
});

/** 分類的預設 isFixed，新增交易時用來帶值 */
export async function getCategory(id: string) {
  const [row] = await read('單一分類', () =>
    db.select().from(categories).where(eq(categories.id, id)).limit(1),
  );
  return row;
}

export function categoryKindFor(kind: TransactionKind): CategoryKind {
  // 暫付款是錢先出去，用支出側的分類
  return kind === 'income' ? 'income' : 'expense';
}

/**
 * LINE 記的最後一筆，給「改成 200」「刪掉」用。
 *
 * 限定 source='line' 而且是最近才記的：在 LINE 上講「改成 200」，意思一定是
 * 「改我剛剛在 LINE 講的那筆」，不會是改網頁上手動記的東西。
 * 超過這個時間就不給改，避免隔了一天回一句「刪掉」把舊帳刪掉。
 */
export async function getLastLineTransaction(withinHours = 12): Promise<TransactionRow | undefined> {
  const [row] = await read('LINE 最後一筆', () =>
    db
      .select(transactionSelect)
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.source, 'line'),
          gte(transactions.createdAt, new Date(Date.now() - withinHours * 3_600_000)),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(1),
  );
  return row;
}

/** 某一天記了幾筆，每日提醒用來判斷「今天到底記了沒」 */
export async function countTransactionsOn(date: string): Promise<number> {
  const [row] = await read('當日筆數', () =>
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(transactions)
      .where(eq(transactions.date, date)),
  );
  return row?.count ?? 0;
}
