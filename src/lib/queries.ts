import { and, asc, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { db, dbGeneration, resetDb } from '@/db';
import {
  categories,
  settlements,
  transactions,
  type CategoryKind,
  type TransactionKind,
} from '@/db/schema';

import { currentMonth, monthRange, shiftMonth } from './format';

/** 分類快取的失效標籤。寫入端（actions/categories.ts）要用同一個字串 */
export const CATEGORIES_TAG = 'categories';

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

/**
 * 重建連線池的時候，正在舊池子上跑的查詢會收到這個。
 * 那不是資料庫的問題，是我們自己把它腳下的連線抽掉了，所以重試不該算次數 ——
 * 只重試一次的話，剛好撞上重建的那支查詢就直接讓整頁 500。
 */
function isOurFault(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  const cause = ((error as { cause?: Error })?.cause?.message) ?? '';
  return `${message} ${cause}`.includes('CONNECTION_ENDED');
}

async function read<T>(label: string, run: () => Promise<T>): Promise<T> {
  let attempt = 0;
  // 總次數設上限，免得無限重試。正常情況下第一次就成功
  for (let loop = 0; loop < 4; loop++) {
    attempt++;
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

      if (isOurFault(error)) {
        /*
         * 這條連線是被我們自己重建時抽掉的，不算它失敗。
         *
         * 但一定要等一下再重試：沒有間隔的話四次會全擠在同一個毫秒，
         * 一起撞上「舊池子正在收、新池子還沒站穩」的那個空窗，四次一起死。
         * 實測過沒有間隔時這裡會連吃四次同樣的錯然後放棄。
         */
        attempt--;
        await new Promise((r) => setTimeout(r, 120 * (loop + 1)));
        console.warn(`[db] ${label} 的連線被重建砍到，等一下換新的池子再跑`);
        continue;
      }

      if (attempt >= 2) throw error;
      console.warn(`[db] ${label} 失敗，重試一次：${(error as Error).message.slice(0, 100)}`);
      // 重試不能再用同一批連線 —— 壞掉的通常是整組，不是剛好那一條
      resetDb(generation, `${label} 沒有回應`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`查詢重試多次仍失敗（${label}）`);
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
 * 分類清單跨請求快取。
 *
 * 這是全系統被打最兇的一支查詢：每一頁都要、每次 AI 解析也要、每次寫入驗證也要。
 * 但分類幾乎不會變（Gino 大概一個月動一次），每次都去資料庫問一遍很浪費 ——
 * 在這台電腦上它也正是最常逾時、然後拖垮整頁的那一支。
 * 《實作計畫.md》第 6 節本來就列了這一條。
 *
 * 新增／改名／停用時會呼叫 revalidateTag('categories') 立刻失效，
 * 所以不會有「改了看不到」的情況（見 src/app/actions/categories.ts）。
 *
 * 用 unstable_cache 而不是 Next 16 建議的 'use cache'：後者要在 next.config
 * 打開 cacheComponents，那會改變整個 app 的渲染語意（靜態外殼 + 串流），
 * 不是為了快取一份分類清單就該動的東西。等真的要整體改造時再一起換。
 */
const loadCategories = unstable_cache(
  async () =>
    read('分類清單', () =>
      db
        .select()
        .from(categories)
        .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name)),
    ),
  ['categories'],
  { tags: [CATEGORIES_TAG] },
);

/**
 * 外層再包一層 React cache：同一次請求裡 layout 跟 page 都要用時只會走一次。
 * activeOnly 在 JS 這邊過濾，這樣兩種呼叫方式共用同一份快取。
 */
export const getCategories = cache(async (opts: { activeOnly?: boolean } = {}) => {
  const all = await loadCategories();
  return opts.activeOnly ? all.filter((c) => c.isActive) : all;
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

/**
 * 由 SQL 聚合出來的月度數字直接組成月結算。
 *
 * 首頁只是要顯示「這個月花多少」，不需要當月每一筆的內容 ——
 * 撈整個月的明細回來只為了加總，在這台電腦上是最容易逾時的那種查詢。
 * 明細頁還是走 summarize()，因為那裡本來就要顯示每一筆。
 */
export function summarizeTotals(totals: MonthTotals): MonthSummary {
  return {
    variableExpense: totals.variableExpense,
    fixedExpense: totals.fixedExpense,
    advance: totals.advance,
    income: totals.income,
    net: totals.income - totals.variableExpense - totals.fixedExpense,
    communalCount: totals.communalCount,
    estimatedCount: totals.estimatedCount,
    count: totals.count,
  };
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

/**
 * 單一分類。每次寫入交易都會呼叫它做驗證（見 actions/transactions.ts 的 parse），
 * 所以直接從快取好的清單裡找，不要再往資料庫跑一趟。
 * 清單是完整的（沒有濾掉停用的），所以「找不到就是真的不存在」仍然成立。
 */
export async function getCategory(id: string) {
  return (await loadCategories()).find((c) => c.id === id);
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

export type MonthTotals = {
  month: string;
  variableExpense: number;
  fixedExpense: number;
  income: number;
  advance: number;
  communalCount: number;
  estimatedCount: number;
  count: number;
};

/**
 * 近 N 個月的統計，給趨勢圖用。
 *
 * 在 SQL 裡聚合而不是把整年的交易撈回來自己算 —— 這支是為了畫圖，
 * 不需要每一筆的內容，撈回來只是浪費頻寬。
 * （單月的月結算仍然走 summarize()，那邊本來就已經有那個月的完整明細。）
 *
 * 沒有帳的月份也要出現在結果裡，否則圖上會少一根柱子、看起來像資料掉了。
 */
export async function getMonthlyTotals(months = 6): Promise<MonthTotals[]> {
  const wanted: string[] = [];
  for (let i = months - 1; i >= 0; i--) wanted.push(shiftMonth(currentMonth(), -i));
  const start = `${wanted[0]}-01`;

  const monthExpr = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await read('月度統計', () =>
    db
      .select({
        month: monthExpr,
        variableExpense: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'expense' and not ${transactions.isFixed}), 0)`.mapWith(
          Number,
        ),
        fixedExpense: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'expense' and ${transactions.isFixed}), 0)`.mapWith(
          Number,
        ),
        income: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'income'), 0)`.mapWith(
          Number,
        ),
        advance: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'advance'), 0)`.mapWith(
          Number,
        ),
        communalCount: sql<number>`count(*) filter (where ${transactions.isCommunal})`.mapWith(
          Number,
        ),
        estimatedCount: sql<number>`count(*) filter (where ${transactions.isEstimated})`.mapWith(
          Number,
        ),
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(transactions)
      .where(gte(transactions.date, start))
      .groupBy(monthExpr),
  );

  const found = new Map(rows.map((r) => [r.month, r]));
  return wanted.map(
    (month) =>
      found.get(month) ?? {
        month,
        variableExpense: 0,
        fixedExpense: 0,
        income: 0,
        advance: 0,
        communalCount: 0,
        estimatedCount: 0,
        count: 0,
      },
  );
}

export type CategorySlice = {
  categoryId: string;
  name: string;
  amount: number;
  count: number;
  isFixed: boolean;
};

/**
 * 某個月各分類花了多少，給佔比圖用。
 *
 * 只算支出：暫付款是先墊出去、之後會回來的錢，混進「這個月花在哪」會誤導
 * （規格書 2.2）。開伙是 0 元，自然不會出現在圖上，次數另外顯示。
 */
export async function getCategoryBreakdown(month: string): Promise<CategorySlice[]> {
  const { start, end } = monthRange(month);

  return read('分類佔比', () =>
    db
      .select({
        categoryId: categories.id,
        name: categories.name,
        isFixed: categories.isFixed,
        amount: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number),
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.kind, 'expense'),
          gte(transactions.date, start),
          lt(transactions.date, end),
        ),
      )
      .groupBy(categories.id, categories.name, categories.isFixed)
      .having(sql`sum(${transactions.amount}) > 0`)
      .orderBy(desc(sql`sum(${transactions.amount})`)),
  );
}
