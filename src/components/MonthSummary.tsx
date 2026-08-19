import Link from 'next/link';

import { formatAmount } from '@/lib/format';
import type { MonthSummary as Summary, MonthTotals } from '@/lib/queries';

import { TrendChart } from './TrendChart';

/**
 * 月結算卡片。規格書 2.2 要求固定與變動分開看、暫付款不混進一般支出，
 * 所以這裡刻意不給一個「總支出」數字 —— 那會把三者揉成一團。
 *
 * 版面原則：只顯示有值的東西。沒有收入的月份就不要放一行「收入 0」，
 * 手機螢幕小，一眼掃過去要先看到「這個月花了多少」，其餘都是配角。
 */
export function MonthSummary({
  summary,
  label = '本月',
  href,
  linkLabel = '看明細',
  trend,
  activeMonth,
}: {
  summary: Summary;
  /** 卡片左上角的小標，例如「8 月」 */
  label?: string;
  /** 右上角連去哪；不給就不顯示 */
  href?: string;
  linkLabel?: string;
  /** 給了就在卡片下半部畫近幾個月的趨勢 */
  trend?: MonthTotals[];
  activeMonth?: string;
}) {
  const totalExpense = summary.variableExpense + summary.fixedExpense;
  const hasSide = summary.income > 0 || summary.advance > 0;
  const hasFooter = summary.communalCount > 0 || summary.estimatedCount > 0;

  return (
    <div
      data-testid="month-summary"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-gradient-to-b from-surface to-surface-2/40"
    >
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-text-faint">{label}支出</p>
          {href && (
            <Link
              href={href}
              className="text-xs text-text-faint transition-colors hover:text-text-muted"
            >
              {linkLabel} →
            </Link>
          )}
        </div>

        <p className="tabular mt-1 text-[2.25rem] leading-none">{formatAmount(totalExpense)}</p>

        {/* 變動與固定的比例，一眼看出這個月的錢是「日常花掉」還是「本來就要付」 */}
        {totalExpense > 0 && (
          <>
            <div className="mt-3.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bg-expense/70"
                style={{ width: `${(summary.variableExpense / totalExpense) * 100}%` }}
              />
              <div
                className="bg-expense/30"
                style={{ width: `${(summary.fixedExpense / totalExpense) * 100}%` }}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
              <Legend dot="bg-expense/70" label="變動" value={summary.variableExpense} />
              <Legend dot="bg-expense/30" label="固定" value={summary.fixedExpense} />
            </div>
          </>
        )}

        {hasSide && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3.5 text-sm">
            {summary.income > 0 && (
              <div>
                <p className="text-xs text-text-faint">收入</p>
                <p className="tabular mt-0.5 text-income">{formatAmount(summary.income)}</p>
              </div>
            )}
            {summary.advance > 0 && (
              <div>
                <p className="text-xs text-text-faint">暫付款（未計入支出）</p>
                <p className="tabular mt-0.5 text-advance">{formatAmount(summary.advance)}</p>
              </div>
            )}
            {summary.income > 0 && (
              <div>
                <p className="text-xs text-text-faint">收支淨額</p>
                <p className={`tabular mt-0.5 ${summary.net >= 0 ? 'text-income' : 'text-expense'}`}>
                  {summary.net >= 0 ? '+' : '−'}
                  {formatAmount(Math.abs(summary.net))}
                </p>
              </div>
            )}
          </div>
        )}

        {hasFooter && (
          <p className="mt-3.5 border-t border-border pt-3 text-xs text-text-faint">
            {summary.communalCount > 0 && `開伙 ${summary.communalCount} 次`}
            {summary.communalCount > 0 && summary.estimatedCount > 0 && '　·　'}
            {summary.estimatedCount > 0 && `${summary.estimatedCount} 筆是估算金額`}
          </p>
        )}
      </div>

      {trend && (
        <div className="border-t border-border bg-bg/30 px-5 pt-4 pb-3">
          <TrendChart
            data={trend}
            activeMonth={activeMonth}
            hrefFor={(m) => `/summary?month=${m}`}
            compact
          />
        </div>
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
