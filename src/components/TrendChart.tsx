import Link from 'next/link';

import { formatAmount } from '@/lib/format';
import type { MonthTotals } from '@/lib/queries';

/**
 * 近幾個月的支出趨勢。變動與固定分層堆疊 —— 規格書 2.2 要求兩者分開看，
 * 疊成一根總柱子但顏色分層，既看得出總量趨勢，也看得出結構。
 *
 * 用 div 而不是 SVG：柱狀圖本來就是幾個矩形，用 flex + 百分比高度
 * 天生就是響應式的，SVG 反而要自己算座標。也不需要任何 JavaScript。
 *
 * 沒有資料的月份畫一條細底線而不是留白 —— 留白看起來像壞掉，
 * 底線看起來像「那個月真的沒花錢」。Gino 才剛開始用，空月份會很多。
 */
export function TrendChart({
  data,
  activeMonth,
  hrefFor,
  compact = false,
}: {
  data: MonthTotals[];
  /** highlight 哪一個月 */
  activeMonth?: string;
  /** 點某個月要連去哪 */
  hrefFor?: (month: string) => string;
  /** 首頁那張卡片裡的縮小版 */
  compact?: boolean;
}) {
  const totals = data.map((d) => d.variableExpense + d.fixedExpense);
  const max = Math.max(...totals, 1);
  const hasAny = totals.some((t) => t > 0);

  return (
    <div>
      <div className={`flex items-end gap-1.5 ${compact ? 'h-16' : 'h-32'}`}>
        {data.map((month, i) => {
          const total = totals[i];
          const active = month.month === activeMonth;
          const bar = (
            <>
              <div className="flex w-full flex-1 flex-col justify-end">
                {total > 0 ? (
                  <div
                    className="flex w-full flex-col justify-end overflow-hidden rounded-t-md"
                    style={{ height: `${(total / max) * 100}%` }}
                  >
                    {/* 變動在上、固定在下：固定是「本來就要付的」，當成地基 */}
                    <div
                      className={active ? 'bg-accent' : 'bg-expense/60'}
                      style={{ height: `${(month.variableExpense / total) * 100}%` }}
                    />
                    <div
                      className={active ? 'bg-accent/40' : 'bg-expense/25'}
                      style={{ height: `${(month.fixedExpense / total) * 100}%` }}
                    />
                  </div>
                ) : (
                  <div className="h-px w-full rounded-full bg-border-strong" />
                )}
              </div>
              <span
                className={`mt-2 block text-center text-[0.7rem] ${
                  active ? 'text-accent' : 'text-text-faint'
                }`}
              >
                {Number(month.month.slice(5))}月
              </span>
            </>
          );

          return hrefFor ? (
            <Link
              key={month.month}
              href={hrefFor(month.month)}
              className="flex h-full flex-1 flex-col justify-end rounded-md transition-opacity hover:opacity-80"
              aria-label={`${Number(month.month.slice(5))} 月，支出 ${formatAmount(total)}`}
            >
              {bar}
            </Link>
          ) : (
            <div key={month.month} className="flex h-full flex-1 flex-col justify-end">
              {bar}
            </div>
          );
        })}
      </div>

      {!hasAny && !compact && (
        <p className="mt-3 text-center text-xs text-text-faint">
          還沒有足夠的紀錄可以看趨勢，記幾筆之後這裡就會長出來
        </p>
      )}
    </div>
  );
}
