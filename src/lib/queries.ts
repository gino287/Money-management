import { and, asc, desc, eq, getTableColumns, gte, ilike, isNotNull, lt, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { db, dbGeneration, resetDb } from '@/db';
import {
  categories,
  settlements,
  transactions,
  users,
  type CategoryKind,
  type Settlement,
  type TransactionKind,
  type User,
} from '@/db/schema';

import { currentMonth, daysAgoISO, monthRange, shiftMonth } from './format';

/**
 * 每一支查詢的第一個參數都是 userId，而且是必填的。
 *
 * 這是整個多人改造裡唯一真正重要的設計決定。另一個做法是讓查詢自己去讀
 * cookie、自己算出「現在是誰」，呼叫端什麼都不用改 —— 那樣改動小得多，
 * 但是**漏掉一支就是把別人的帳給錯的人看**，而且不會有任何錯誤訊息，
 * 只會安靜地多出幾筆不是你的資料。
 *
 * 改成必填參數之後，少傳一支 TypeScript 就編不過。改動大，但漏不掉。
 * cron 與 LINE webhook 沒有 cookie 可讀，這個做法它們也用得上。
 */

/** 分類快取的失效標籤。寫入端（actions/categories.ts）要用同一個字串 */
export const CATEGORIES_TAG = 'categories';

/**
 * 分類快取是分人的。
 *
 * 媽媽改一個分類不該把 Gino 的快取一起沖掉 —— 他下一次開首頁就要多等
 * 一支查詢，而那支正好是全系統被打最兇、也最容易逾時的那一支。
 */
export const categoriesTag = (userId: string) => `${CATEGORIES_TAG}:${userId}`;

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
const loadCategories = (userId: string) =>
  unstable_cache(
    async () =>
      read('分類清單', () =>
        db
          .select()
          .from(categories)
          .where(eq(categories.userId, userId))
          .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name)),
      ),
    // userId 進 key，兩個人的清單才不會共用同一格快取
    ['categories', userId],
    { tags: [categoriesTag(userId)] },
  )();

/**
 * 外層再包一層 React cache：同一次請求裡 layout 跟 page 都要用時只會走一次。
 * activeOnly 在 JS 這邊過濾，這樣兩種呼叫方式共用同一份快取。
 */
export const getCategories = cache(async (userId: string, opts: { activeOnly?: boolean } = {}) => {
  const all = await loadCategories(userId);
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
  userId: string,
  filters: TransactionFilters = {},
  limit?: number,
): Promise<TransactionRow[]> {
  const conditions = [eq(transactions.userId, userId)];

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
    .where(and(...conditions))
    // 同一天記的多筆按建立時間排，補記時順序才符合直覺
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

  return read('交易明細', () => (limit ? query.limit(limit) : query));
}

/** 查不到跟「不是你的」回一樣的東西 —— 別人有沒有這筆帳不關你的事 */
export async function getTransaction(
  userId: string,
  id: string,
): Promise<TransactionRow | undefined> {
  const [row] = await read('單筆交易', () =>
    db
      .select(transactionSelect)
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
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
export async function getCategoryUsage(userId: string): Promise<Map<string, number>> {
  const rows = await read('分類使用次數', () =>
    db
      .select({
        categoryId: transactions.categoryId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.categoryId),
  );

  return new Map(rows.map((r) => [r.categoryId, r.count]));
}

export type SettlementRow = Settlement & {
  /** 已經收回（或已經還掉）多少 —— 從綁在這個項目上的交易加總來的 */
  received: number;
};

/**
 * 待結清清單，含「已經收回多少」。
 *
 * 分次收回（借出 1,000、昨天還 500、今天再 500）不在這張表上改數字，
 * 而是每一次都記成真的一筆帳再綁回來。這裡把它們加總 ——
 * 待結清頁看到的「已收 1,000／共 1,000」永遠跟明細對得起來，
 * 不會出現「這裡寫收回了，明細裡卻沒有那筆錢」。
 */
export const getSettlements = cache(async (userId: string, status?: 'open' | 'settled') => {
  const rows = await read('待結清清單', () =>
    db
      .select({
        ...getTableColumns(settlements),
        received: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number),
      })
      .from(settlements)
      /*
       * 收回的那幾筆交易也要限定同一個人。
       *
       * 光靠 settlement_id 對得起來看似就夠了 —— 但那等於相信「別人的交易
       * 絕對不會指到我的待結清項目」。把條件寫進 join 條件裡，這件事就從
       * 「相信」變成「不可能」，代價只是多一個 and。
       */
      .leftJoin(
        transactions,
        and(eq(transactions.settlementId, settlements.id), eq(transactions.userId, userId)),
      )
      .where(
        status
          ? and(eq(settlements.userId, userId), eq(settlements.status, status))
          : eq(settlements.userId, userId),
      )
      .groupBy(settlements.id)
      .orderBy(asc(settlements.status), desc(settlements.openedAt)),
  );
  return rows as SettlementRow[];
});

/**
 * 首頁與導覽列該不該為了這一筆吵人。
 *
 * 只有三種要吵：這個月到期的、已經過期的、沒寫預計時間的。
 * 押金要等到 2027 年退租才拿得回來，天天在首頁擋路只會讓人為了讓它閉嘴
 * 而按下結清 —— 那是在資料上說謊，而且是系統逼的。
 *
 * 沒寫時間的**故意**要吵：連自己都說不出什麼時候會回來的錢，才最容易被忘記。
 */
export function isDue(item: Pick<Settlement, 'dueMonth'>, month = currentMonth()): boolean {
  return item.dueMonth === null || item.dueMonth <= month;
}

/**
 * 單一分類。每次寫入交易都會呼叫它做驗證（見 actions/transactions.ts 的 parse），
 * 所以直接從快取好的清單裡找，不要再往資料庫跑一趟。
 * 清單是完整的（沒有濾掉停用的），所以「找不到就是真的不存在」仍然成立。
 */
export async function getCategory(userId: string, id: string) {
  return (await loadCategories(userId)).find((c) => c.id === id);
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
export async function getLastLineTransaction(
  userId: string,
  withinHours = 12,
): Promise<TransactionRow | undefined> {
  const [row] = await read('LINE 最後一筆', () =>
    db
      .select(transactionSelect)
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
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
export async function countTransactionsOn(userId: string, date: string): Promise<number> {
  const [row] = await read('當日筆數', () =>
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.date, date))),
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
export async function getMonthlyTotals(userId: string, months = 6): Promise<MonthTotals[]> {
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
      .where(and(eq(transactions.userId, userId), gte(transactions.date, start)))
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

/**
 * 「這個月還可以花多少」。
 *
 * Gino 的舊 Excel 每個月都手算這個數字（交接摘要那句「可用餘額約 $4,251／月（扣固定支出後）」），
 * 那是整份檔案裡最實用的一格 —— 總支出只說了過去，這個數字才能拿來決定今天要不要外食。
 *
 * 收入為什麼可能用估的：Gino 的收入不規律（生活費、工讀、補助分開入帳，
 * 而且常常月底才補登錄）。月初收入還是 0 的時候直接算，會得到「可用 −5,700」
 * 這種嚇人又沒意義的數字，所以那時改用前三個月有收入的月份的平均，並且標明是估的。
 *
 * 兩邊都沒有就回 null（整個區塊不顯示）—— 猜一個數字給人看比不給更糟。
 */
export type Budget = {
  /** 拿來算的收入 */
  income: number;
  /** 收入是用前幾個月估的，不是這個月真的入帳的 */
  incomeIsEstimate: boolean;
  fixed: number;
  /** 已經花掉的變動支出 */
  spent: number;
  /** 收入扣掉固定支出，這個月可以自由花的錢 */
  available: number;
  /** 還剩多少 */
  left: number;
  /** 這個月還剩幾天（含今天）。過去的月份是 null */
  daysLeft: number | null;
  /** 剩下的錢平均每天還能花多少。已經透支或不是本月就是 null */
  perDay: number | null;
  /** 上個月有、這個月還沒記的固定支出。已經先從可用額度扣掉了 */
  pendingFixed: number;
};

export function deriveBudget(
  trend: MonthTotals[],
  month: string,
  daysLeft: number | null,
  /**
   * 還沒記的固定支出（房租那種）。一定要先扣掉 ——
   * 房租還沒記的時候說「這個月還可以花 20,445」是騙人的，那一萬一千塊已經有主了。
   */
  pendingFixed = 0,
): Budget | null {
  const current = trend.find((t) => t.month === month);
  if (!current) return null;

  const past = trend.filter((t) => t.month < month && t.income > 0).slice(-3);
  const incomeIsEstimate = current.income === 0 && past.length > 0;
  const income = incomeIsEstimate
    ? Math.round(past.reduce((sum, t) => sum + t.income, 0) / past.length)
    : current.income;

  if (income === 0) return null;

  const available = income - current.fixedExpense - pendingFixed;
  const left = available - current.variableExpense;

  return {
    income,
    incomeIsEstimate,
    fixed: current.fixedExpense + pendingFixed,
    pendingFixed,
    spent: current.variableExpense,
    available,
    left,
    daysLeft,
    perDay: daysLeft && daysLeft > 0 && left > 0 ? Math.floor(left / daysLeft) : null,
  };
}

/**
 * 每個月的結餘累加起來 —— 也就是「存款是在往上還是往下」。
 *
 * 單月結餘看不出趨勢：三月 −3,532 看起來還好，但連續六個月都 −3,000 就是另一回事了。
 * Gino 的交接摘要裡有一句「存款約 20~30 萬，慢慢在減少中」，那個「慢慢」原本只是感覺，
 * 這條線把它變成看得到的斜率。
 *
 * 暫付款不算進去：那是先墊出去、之後會回來的錢，算進來會讓押金那個月憑空掉兩萬。
 */
export type CumulativePoint = { month: string; net: number; total: number };

export function deriveCumulative(trend: MonthTotals[]): CumulativePoint[] {
  let total = 0;
  return trend.map((t) => {
    const net = t.income - t.variableExpense - t.fixedExpense;
    total += net;
    return { month: t.month, net, total };
  });
}

export type FixedItem = { name: string; previous: number; current: number };

/**
 * 固定支出對帳：上個月有、這個月還沒記的。
 *
 * 房租、壇費每個月都要付，但正因為每個月都一樣，最容易忘記記
 * （Gino 的 8 月交接摘要就寫著「月租 11,000 尚未入帳」）。
 *
 * 刻意不做成「自動每月幫你記一筆」：金額會變（壇費從 650 變成 700 過），
 * 自動記會安靜地記錯，而記錯的固定支出比漏記更難發現。提醒讓人自己按，
 * 才會順手看一眼金額對不對。
 *
 * 兩個月一次查完，不要分兩支 —— 首頁與月結算頁的查詢數都要斤斤計較。
 */
export async function getFixedCheck(userId: string, month: string): Promise<FixedItem[]> {
  const previous = shiftMonth(month, -1);
  const start = `${previous}-01`;
  const end = monthRange(month).end;

  const monthExpr = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await read('固定支出對帳', () =>
    db
      .select({
        month: monthExpr,
        name: categories.name,
        amount: sql<number>`sum(${transactions.amount})`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.kind, 'expense'),
          eq(transactions.isFixed, true),
          gte(transactions.date, start),
          lt(transactions.date, end),
        ),
      )
      .groupBy(monthExpr, categories.name),
  );

  const names = [...new Set(rows.map((r) => r.name))].sort();
  return names.map((name) => ({
    name,
    previous: rows.find((r) => r.month === previous && r.name === name)?.amount ?? 0,
    current: rows.find((r) => r.month === month && r.name === name)?.amount ?? 0,
  }));
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
export async function getCategoryBreakdown(userId: string, month: string): Promise<CategorySlice[]> {
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
          eq(transactions.userId, userId),
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

export type DayTotals = {
  /** YYYY-MM-DD */
  date: string;
  expense: number;
  income: number;
  count: number;
  communalCount: number;
};

/**
 * 首頁那一支「每天花多少」的查詢要往回撈幾天。
 *
 * 75 天不是隨便挑的：`derivePulse` 要算「上個月同一天為止花了多少」，
 * 最壞情況是今天 31 號、上個月也有 31 天，需要往回蓋到上個月 1 號＝ 62 天。
 * 給到 75 有餘裕，順便讓「連續記帳」數得到兩個半月。
 * 一天一列，75 列的聚合對資料庫來說跟一列沒兩樣。
 */
export const PULSE_DAYS = 75;

/**
 * 近 N 天每天的小結。
 *
 * 一支查詢餵四個地方：招呼底下那行「今天花了多少」、七天小柱狀圖、
 * 連續記帳天數、跟上個月同一天的比較。
 * 首頁的查詢是排隊跑的（原因見 (app)/page.tsx 的長註解），能合併就合併。
 *
 * 沒有帳的日子也要出現在結果裡，否則圖上會少一根柱子、看起來像資料掉了，
 * 而且連續天數會把「那天沒記」誤算成連著的。
 */
export async function getDailyTotals(userId: string, days = PULSE_DAYS): Promise<DayTotals[]> {
  const wanted: string[] = [];
  for (let i = days - 1; i >= 0; i--) wanted.push(daysAgoISO(i));

  const dayExpr = sql<string>`to_char(${transactions.date}, 'YYYY-MM-DD')`;
  const rows = await read('每日統計', () =>
    db
      .select({
        date: dayExpr,
        expense:
          sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'expense'), 0)`.mapWith(
            Number,
          ),
        income:
          sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.kind} = 'income'), 0)`.mapWith(
            Number,
          ),
        count: sql<number>`count(*)`.mapWith(Number),
        communalCount: sql<number>`count(*) filter (where ${transactions.isCommunal})`.mapWith(
          Number,
        ),
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.date, wanted[0])))
      .groupBy(dayExpr),
  );

  const found = new Map(rows.map((r) => [r.date, r]));
  return wanted.map(
    (date) => found.get(date) ?? { date, expense: 0, income: 0, count: 0, communalCount: 0 },
  );
}

export type Pulse = {
  today: DayTotals;
  /** 最近七天，舊到新 */
  week: DayTotals[];
  /** 連續記帳幾天 */
  streak: number;
  /** 這個月到今天為止的支出 */
  monthToDate: number;
  /** 上個月到同一天為止的支出。撈回來的天數不夠蓋到上個月 1 號就是 null */
  lastMonthToDate: number | null;
  daysElapsed: number;
  daysInMonth: number;
  /** 照目前的速度，這個月大概會花多少。資料太少或月底了就是 null */
  projection: number | null;
};

/**
 * 把每日小結換算成首頁要顯示的幾個數字。純函式，不碰資料庫。
 *
 * 暫付款不算進任何一個支出數字（規格書 2.2），這在 getDailyTotals 的
 * `filter (where kind = 'expense')` 就擋掉了，這裡不必再處理。
 */
export function derivePulse(daily: DayTotals[]): Pulse {
  const today = daily[daily.length - 1];

  /*
   * 連續記帳天數。今天還沒記的話從昨天起算 ——
   * 早上八點就跟人家說「連續中斷了」太苛，一天根本還沒過完。
   * 昨天也沒有才算真的斷掉。
   */
  let streak = 0;
  let i = daily.length - 1;
  if (daily[i].count === 0) i--;
  for (; i >= 0 && daily[i].count > 0; i--) streak++;

  const month = today.date.slice(0, 7);
  const previous = shiftMonth(month, -1);
  const daysElapsed = Number(today.date.slice(8));

  // 「到第幾天為止」用日期的日數比對，不是往回數幾天 ——
  // 月份長度不一樣，往回數 30 天在 2 月會跨到上上個月去
  const upTo = (m: string) =>
    daily
      .filter((d) => d.date.startsWith(m) && Number(d.date.slice(8)) <= daysElapsed)
      .reduce((sum, d) => sum + d.expense, 0);

  const monthToDate = upTo(month);
  // 撈回來的區間沒蓋到上個月 1 號的話，加出來的數字會偏低，那寧可不講
  const lastMonthToDate = daily[0].date <= `${previous}-01` ? upTo(previous) : null;

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  /*
   * 月底預估＝目前的日均 × 這個月的天數。
   * 前兩天不預估：1 號吃一頓大餐就會推出一個嚇死人的數字，那不是資訊是噪音。
   * 月底最後一天也不預估，那時候「預估」就等於實際，講了是廢話。
   */
  const projection =
    daysElapsed >= 3 && daysElapsed < daysInMonth && monthToDate > 0
      ? Math.round((monthToDate / daysElapsed) * daysInMonth)
      : null;

  return {
    today,
    week: daily.slice(-7),
    streak,
    monthToDate,
    lastMonthToDate,
    daysElapsed,
    daysInMonth,
    projection,
  };
}

/* ------------------------------------------------------------ 使用者 */

/**
 * LINE 上這個人是我們的誰。
 *
 * 一支 LINE 官方帳號就能服務全家人 —— 每一則 webhook 本來就帶著發話者的
 * userId，查得到就用那個人的身分記帳，查不到就當作沒看到。
 * 不需要一個人開一支 bot（2026-08-26 Gino 問過的問題）。
 *
 * 停用的人查不出來：停用之後 LINE 也應該一起失效，否則等於留了一道後門。
 */
export async function getUserByLineId(lineUserId: string): Promise<User | undefined> {
  const [user] = await read('LINE 使用者', () =>
    db
      .select()
      .from(users)
      .where(and(eq(users.lineUserId, lineUserId), eq(users.isActive, true)))
      .limit(1),
  );
  return user;
}

/**
 * 憑證上的那個人是誰。每一頁都會問一次（見 src/lib/session.ts）。
 *
 * 一定要走 read()：這是全站唯一每個請求都跑的查詢，它要是卡住，
 * 卡住的就是每一頁。read() 的三秒逾時與連線池重建正是為了這種情況存在的
 * （理由見這支檔案開頭 read 的長註解）。
 *
 * 停用的人查不出來 —— 憑證有九十天效期，停用之後不該還能靠舊憑證繼續用。
 */
export async function getUserById(id: string): Promise<User | undefined> {
  const [user] = await read('目前使用者', () =>
    db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isActive, true)))
      .limit(1),
  );
  return user;
}

/** 每日提醒用：所有綁了 LINE、而且還在用的人 */
export async function getLineUsers(): Promise<User[]> {
  return read('要提醒的人', () =>
    db
      .select()
      .from(users)
      .where(and(eq(users.isActive, true), isNotNull(users.lineUserId)))
      .orderBy(asc(users.createdAt)),
  );
}
