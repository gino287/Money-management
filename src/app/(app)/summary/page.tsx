import Link from 'next/link';

import { CategoryBreakdown } from '@/components/CategoryBreakdown';
import { CompareLine } from '@/components/CompareLine';
import { TrendChart } from '@/components/TrendChart';
import { currentMonth, formatAmount, formatMonth, shiftMonth } from '@/lib/format';
import {
  derivePulse,
  getCategoryBreakdown,
  getDailyTotals,
  getMonthlyTotals,
  getSettlements,
  getTransactions,
  summarize,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function SummaryPage({ searchParams }: PageProps<'/summary'>) {
  const params = await searchParams;
  const raw = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = /^\d{4}-\d{2}$/.test(raw ?? '') ? raw! : currentMonth();

  // 一支一支查，理由見首頁那段註解
  const rows = await getTransactions({ month });
  const trend = await getMonthlyTotals(6);
  const slices = await getCategoryBreakdown(month);
  const open = await getSettlements('open');

  const summary = summarize(rows);
  const totalExpense = summary.variableExpense + summary.fixedExpense;
  const isThisMonth = month === currentMonth();

  /*
   * 跟上個月比。這個月跟過去的月份要用不同的比法：
   *
   * 這個月還沒過完，拿它的總額去比上個月的總額，永遠都會「比較少」——
   * 那不是省了錢，只是還沒花完，是會騙人的數字。所以本月比的是
   * 「到今天為止」對「上個月到同一天為止」，多查一支每日統計來算。
   * 翻到過去的月份就沒這個問題，兩邊都是完整的月，直接從趨勢資料拿。
   */
  const previous = shiftMonth(month, -1);
  const previousTotals = trend.find((t) => t.month === previous);
  const pulse = isThisMonth ? derivePulse(await getDailyTotals()) : null;

  const compare = isThisMonth
    ? { current: pulse!.monthToDate, previous: pulse!.lastMonthToDate, label: '上個月同一時候' }
    : {
        current: totalExpense,
        // 趨勢圖只撈近半年，翻得夠遠就沒有上個月的資料可以比，那就不顯示
        previous: previousTotals
          ? previousTotals.variableExpense + previousTotals.fixedExpense
          : null,
        label: '上個月',
      };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <Link
          href={`/summary?month=${shiftMonth(month, -1)}`}
          className="flex size-9 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:text-text"
          aria-label="上個月"
        >
          ←
        </Link>
        <div className="text-center">
          <h1 className="text-sm">{formatMonth(month)}</h1>
          {!isThisMonth && (
            <Link href="/summary" className="text-[0.7rem] text-text-faint hover:text-text-muted">
              回到本月
            </Link>
          )}
        </div>
        <Link
          href={`/summary?month=${shiftMonth(month, 1)}`}
          className="flex size-9 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:text-text"
          aria-label="下個月"
        >
          →
        </Link>
      </header>

      {/* 這個月花了多少 —— 整頁的主角 */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-gradient-to-b from-surface to-surface-2/40 p-5">
        <p className="text-xs text-text-faint">這個月花了</p>
        <p className="tabular mt-1 text-[2.75rem] leading-none">{formatAmount(totalExpense)}</p>

        {totalExpense > 0 ? (
          <>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bg-expense/70"
                style={{ width: `${(summary.variableExpense / totalExpense) * 100}%` }}
              />
              <div
                className="bg-expense/30"
                style={{ width: `${(summary.fixedExpense / totalExpense) * 100}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-muted">
              <Legend dot="bg-expense/70" label="變動" value={summary.variableExpense} />
              <Legend dot="bg-expense/30" label="固定" value={summary.fixedExpense} />
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-text-faint">這個月還沒有支出</p>
        )}

        <CompareLine {...compare} />

        <p className="mt-4 border-t border-border pt-3 text-xs text-text-faint">
          共 {summary.count} 筆
          {isThisMonth && pulse?.projection
            ? `　·　照這個速度，月底大概 ${formatAmount(pulse.projection)}`
            : ''}
          {summary.communalCount > 0 && `　·　開伙 ${summary.communalCount} 次`}
          {summary.estimatedCount > 0 && `　·　${summary.estimatedCount} 筆估算`}
        </p>
      </section>

      {/* 收入、暫付款、淨額。三者刻意不加總成一個數字（規格書 2.2） */}
      <section className="grid grid-cols-3 gap-2">
        <Stat label="收入" value={summary.income} tone="text-income" />
        <Stat
          label="暫付款"
          value={summary.advance}
          tone="text-advance"
          hint="會回來的錢"
        />
        <Stat
          label="收支淨額"
          value={Math.abs(summary.net)}
          tone={summary.net >= 0 ? 'text-income' : 'text-expense'}
          prefix={summary.net >= 0 ? '+' : '−'}
        />
      </section>

      <section>
        <h2 className="mb-3 px-1 text-sm text-text-muted">近半年</h2>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <TrendChart data={trend} activeMonth={month} hrefFor={(m) => `/summary?month=${m}`} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="text-sm text-text-muted">花在哪</h2>
          <Link
            href={`/transactions?month=${month}`}
            className="text-xs text-text-faint hover:text-text-muted"
          >
            看明細 →
          </Link>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <CategoryBreakdown slices={slices} month={month} />
        </div>
      </section>

      {/* 匯出。用 <a> 而不是 <Link>：這是下載檔案，不是換頁 */}
      <a
        href={`/api/export?month=${month}`}
        className="block rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3.5 text-center text-sm text-text-muted transition-colors hover:text-text"
      >
        把 {formatMonth(month)} 匯出成 CSV
      </a>

      {open.length > 0 && (
        <Link
          href="/settlements"
          className="block rounded-[var(--radius-lg)] border border-estimated/25 bg-surface px-4 py-3.5 text-sm transition-colors hover:border-estimated/50"
        >
          <span className="text-estimated">還有 {open.length} 筆沒結清</span>
          <span className="ml-2 text-xs text-text-faint">
            押金、代墊、借出去的錢 —— 結清了再手動確認
          </span>
        </Link>
      )}
    </div>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {label}
      <span className="tabular text-text">{formatAmount(value)}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
  prefix = '',
  hint,
}: {
  label: string;
  value: number;
  tone: string;
  prefix?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface px-3 py-3">
      <p className="text-[0.7rem] text-text-faint">{label}</p>
      <p className={`tabular mt-1 truncate text-base ${value > 0 ? tone : 'text-text-faint'}`}>
        {value > 0 ? `${prefix}${formatAmount(value)}` : '—'}
      </p>
      {hint && value > 0 && <p className="mt-0.5 text-[0.65rem] text-text-faint">{hint}</p>}
    </div>
  );
}
