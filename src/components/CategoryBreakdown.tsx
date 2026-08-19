import Link from 'next/link';

import { formatAmount } from '@/lib/format';
import type { CategorySlice } from '@/lib/queries';

/**
 * 這個月的錢花在哪。甜甜圈 + 排行榜。
 *
 * 甜甜圈用 SVG 的 stroke-dasharray 畫：每一段就是一個圓，
 * 用虛線長度控制弧長、用 dashoffset 轉到該去的角度，不必自己算路徑。
 * 純伺服器渲染，沒有任何 JavaScript。
 *
 * 只有支出，不含暫付款（規格書 2.2：那是會回來的錢，混進「花在哪」會誤導）。
 */

/**
 * 依序取用。相鄰兩色的色相要拉開 —— 排行榜上下相鄰的兩項如果顏色接近，
 * 就對不回甜甜圈上是哪一段。（第一版第 6 色用了 #7dd3a8，跟 --accent 幾乎同色，
 * 「房租」跟「交通」看起來像同一類。）
 */
const COLORS = [
  'var(--accent)', // 綠
  '#f4a3a3', // 玫瑰
  '#8ab4f8', // 藍
  '#f0c674', // 琥珀
  '#c4a3f4', // 紫
  '#67d4e8', // 青
  '#f4b183', // 橘
  '#9aa3af', // 灰
];

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CategoryBreakdown({ slices, month }: { slices: CategorySlice[]; month: string }) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);

  if (total === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-border px-4 py-10 text-center text-sm text-text-faint">
        這個月還沒有支出紀錄
      </p>
    );
  }

  // 太多分類時圖會變得沒法看，第 8 名以後併成「其他」
  const top = slices.slice(0, 7);
  const rest = slices.slice(7);
  const shown =
    rest.length > 0
      ? [
          ...top,
          {
            categoryId: 'rest',
            name: `其他 ${rest.length} 類`,
            amount: rest.reduce((s, r) => s + r.amount, 0),
            count: rest.reduce((s, r) => s + r.count, 0),
            isFixed: false,
          },
        ]
      : top;

  // 先把每一段的起點算好，不要在 render 當中累加變數（那是 lint 擋的可變狀態）
  const arcs: { dash: number; offset: number }[] = [];
  shown.reduce((offset, slice) => {
    const dash = (slice.amount / total) * CIRCUMFERENCE;
    arcs.push({ dash, offset });
    return offset + dash;
  }, 0);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="size-36 -rotate-90">
          {shown.map((slice, i) => (
            <circle
              key={slice.categoryId}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="12"
              strokeDasharray={`${arcs[i].dash} ${CIRCUMFERENCE - arcs[i].dash}`}
              strokeDashoffset={-arcs[i].offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[0.7rem] text-text-faint">支出</span>
          <span className="tabular text-lg leading-tight">{formatAmount(total)}</span>
        </div>
      </div>

      <ul className="w-full space-y-2">
        {shown.map((slice, i) => {
          const pct = Math.round((slice.amount / total) * 100);
          const row = (
            <>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate">
                {slice.name}
                {slice.isFixed && <span className="ml-1 text-[0.65rem] text-text-faint">固定</span>}
              </span>
              <span className="tabular shrink-0 text-text">{formatAmount(slice.amount)}</span>
              <span className="tabular w-9 shrink-0 text-right text-xs text-text-faint">{pct}%</span>
            </>
          );

          return (
            <li key={slice.categoryId} className="text-sm text-text-muted">
              {slice.categoryId === 'rest' ? (
                <div className="flex items-center gap-2.5">{row}</div>
              ) : (
                <Link
                  href={`/transactions?month=${month}&category=${slice.categoryId}`}
                  className="flex items-center gap-2.5 transition-colors hover:text-text"
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
