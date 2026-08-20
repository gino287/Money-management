import { formatAmount, formatMonthShort } from '@/lib/format';
import type { CumulativePoint } from '@/lib/queries';

/**
 * 累積結餘 —— 「存款是在往上還是往下」。
 *
 * 跟旁邊那張近半年柱狀圖的差別：那張每根柱子各自獨立（這個月花了多少），
 * 這張是**累加**的，所以看的是斜率不是高度。連續五個月都 −3,000 的時候，
 * 單月圖上是五根差不多高的柱子，這張圖上是一路往下的樓梯。
 *
 * 零線畫在中間，正的往上長、負的往下長。這是唯一會出現負值的圖，
 * 所以不能沿用只往上長的畫法。
 */
export function CumulativeChart({ data }: { data: CumulativePoint[] }) {
  const points = data.filter((p) => p.total !== 0 || p.net !== 0);
  if (points.length < 2) return null;

  const scale = Math.max(...points.map((p) => Math.abs(p.total)), 1);
  const last = points[points.length - 1];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-text-faint">
          {formatMonthShort(points[0].month)}到現在累積
        </p>
        <p className={`tabular text-lg ${last.total >= 0 ? 'text-income' : 'text-expense'}`}>
          {last.total >= 0 ? '+' : '−'}
          {formatAmount(Math.abs(last.total))}
        </p>
      </div>

      <div className="mt-3 flex items-stretch gap-1.5">
        {points.map((p) => {
          const height = (Math.abs(p.total) / scale) * 50;
          const up = p.total >= 0;
          return (
            <div key={p.month} className="flex flex-1 flex-col" title={`${p.month} 累積 ${p.total}`}>
              <div className="relative h-20">
                {/* 零線。柱子從這條線往上或往下長 */}
                <div className="absolute inset-x-0 top-1/2 h-px bg-border-strong" />
                <div
                  className={`absolute inset-x-0 ${up ? 'bottom-1/2 rounded-t-sm bg-income/60' : 'top-1/2 rounded-b-sm bg-expense/60'}`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
              </div>
              <span className="mt-1.5 block text-center text-[0.7rem] text-text-faint">
                {p.month.slice(5).replace(/^0/, '')}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-xs text-text-faint">
        每個月的收入減掉支出，一個月一個月加上去。暫付款不算（那是會回來的錢）。
      </p>
    </div>
  );
}
