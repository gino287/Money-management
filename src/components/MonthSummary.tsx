import { formatAmount } from '@/lib/format';
import type { MonthSummary as Summary } from '@/lib/queries';

/**
 * 月結算。規格書 2.2 要求固定與變動分開看、暫付款不混進一般支出，
 * 所以這裡刻意不給一個「總支出」數字 —— 那會把三者揉成一團。
 */
export function MonthSummary({ summary }: { summary: Summary }) {
  const totalExpense = summary.variableExpense + summary.fixedExpense;

  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-text-faint">支出合計</p>
          <p className="tabular mt-0.5 text-3xl">{formatAmount(totalExpense)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-text-faint">收支淨額</p>
          <p className={`tabular mt-0.5 text-lg ${summary.net >= 0 ? 'text-income' : 'text-expense'}`}>
            {summary.net >= 0 ? '+' : '−'}
            {formatAmount(Math.abs(summary.net))}
          </p>
        </div>
      </div>

      {/* 變動與固定的比例，一眼看出這個月的錢是「日常花掉」還是「本來就要付」 */}
      {totalExpense > 0 && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="bg-expense/70"
            style={{ width: `${(summary.variableExpense / totalExpense) * 100}%` }}
          />
          <div
            className="bg-expense/30"
            style={{ width: `${(summary.fixedExpense / totalExpense) * 100}%` }}
          />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
        <Item label="變動支出" value={formatAmount(summary.variableExpense)} />
        <Item label="固定支出" value={formatAmount(summary.fixedExpense)} />
        <Item label="收入" value={formatAmount(summary.income)} tone="text-income" />
        <Item
          label="暫付款"
          value={formatAmount(summary.advance)}
          tone="text-advance"
          hint="未計入支出"
        />
      </dl>

      {(summary.communalCount > 0 || summary.estimatedCount > 0) && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-text-faint">
          {summary.communalCount > 0 && `本月開伙 ${summary.communalCount} 次`}
          {summary.communalCount > 0 && summary.estimatedCount > 0 && '　·　'}
          {summary.estimatedCount > 0 && `${summary.estimatedCount} 筆是估算金額`}
        </p>
      )}
    </div>
  );
}

function Item({
  label,
  value,
  tone = 'text-text',
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-text-faint">
        {label}
        {hint && <span className="ml-1 opacity-70">（{hint}）</span>}
      </dt>
      <dd className={`tabular mt-0.5 ${tone}`}>{value}</dd>
    </div>
  );
}
