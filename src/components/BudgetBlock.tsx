import { formatAmount } from '@/lib/format';
import type { Budget } from '@/lib/queries';

/**
 * 「還可以花多少」。
 *
 * 這張卡片跟旁邊那些不一樣：其他數字都在講已經發生的事，只有這個是給人拿來
 * 決定「今天要不要外食」的。所以主角是**剩下多少**，不是花了多少。
 *
 * 透支的時候不罵人也不加驚嘆號 —— 有些月份本來就會超（買機票、繳押金），
 * 系統不知道原因，講重話只會讓人不想打開。就把數字擺出來。
 */
export function BudgetBlock({ budget, label }: { budget: Budget; label: string }) {
  const { available, spent, left, income, fixed, incomeIsEstimate, daysLeft, perDay, pendingFixed } =
    budget;
  const over = left < 0;
  // 透支時進度條滿格；available 是 0 或負數（固定支出比收入還高）也當滿格，不要除以 0
  const used = available > 0 ? Math.min((spent / available) * 100, 100) : 100;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-text-faint">{label}還可以花</p>
        {incomeIsEstimate && <p className="text-[0.7rem] text-text-faint">收入是估的</p>}
      </div>

      <p className={`tabular mt-1 text-[2rem] leading-none ${over ? 'text-expense' : ''}`}>
        {over ? '−' : ''}
        {formatAmount(Math.abs(left))}
      </p>

      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full ${over ? 'bg-expense' : 'bg-accent/70'}`}
          style={{ width: `${used}%` }}
        />
      </div>

      <p className="tabular mt-2.5 text-xs text-text-muted">
        可用 {formatAmount(available)}
        <span className="text-text-faint">
          （收入 {formatAmount(income)} − 固定 {formatAmount(fixed)}）
        </span>
        　·　已花 {formatAmount(spent)}
      </p>

      {daysLeft !== null && (
        <p className="mt-2 border-t border-border pt-2.5 text-xs text-text-faint">
          {daysLeft > 0 ? (
            perDay !== null ? (
              <>
                還有 {daysLeft} 天，平均每天還能花{' '}
                <span className="tabular text-text-muted">{formatAmount(perDay)}</span>
              </>
            ) : (
              <>還有 {daysLeft} 天，這個月的額度已經用完了</>
            )
          ) : (
            '這個月最後一天了'
          )}
        </p>
      )}

      {pendingFixed > 0 && (
        <p className="mt-2 text-xs text-text-faint">
          已經先扣掉還沒記的固定支出 {formatAmount(pendingFixed)}（照上個月的金額估）。
        </p>
      )}

      {incomeIsEstimate && (
        <p className="mt-2 text-xs text-text-faint">
          {label}還沒有收入紀錄，先用前幾個月的平均估。記了收入這個數字就會準。
        </p>
      )}
    </div>
  );
}
