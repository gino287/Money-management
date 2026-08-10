import Link from 'next/link';

import { formatAmount, formatDate, formatWeekday } from '@/lib/format';
import type { TransactionRow } from '@/lib/queries';

const KIND_STYLE = {
  expense: 'text-text',
  income: 'text-income',
  advance: 'text-advance',
} as const;

const KIND_SIGN = { expense: '−', income: '+', advance: '−' } as const;

export function TransactionList({
  rows,
  emptyHint = '還沒有紀錄',
}: {
  rows: TransactionRow[];
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-border px-4 py-10 text-center text-sm text-text-faint">
        {emptyHint}
      </p>
    );
  }

  // 同一天的收在一起，翻明細時比較容易對照當天做了什麼
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const list = groups.get(row.date);
    if (list) list.push(row);
    else groups.set(row.date, [row]);
  }

  return (
    <div className="space-y-5">
      {[...groups].map(([date, items]) => (
        <div key={date}>
          <div className="mb-1.5 flex items-baseline gap-2 px-1">
            <span className="text-sm text-text-muted">{formatDate(date)}</span>
            <span className="text-xs text-text-faint">週{formatWeekday(date)}</span>
          </div>
          <ul className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
            {items.map((row) => (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/transactions/${row.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm">{row.categoryName}</span>
                      {row.kind === 'advance' && <Tag className="text-advance">暫付</Tag>}
                      {row.isEstimated && <Tag className="text-estimated">估算</Tag>}
                      {row.isCommunal && <Tag className="text-text-faint">開伙</Tag>}
                      {row.isFixed && row.kind === 'expense' && (
                        <Tag className="text-text-faint">固定</Tag>
                      )}
                    </div>
                    {row.note && (
                      <p className="mt-0.5 truncate text-xs text-text-faint">{row.note}</p>
                    )}
                  </div>
                  <span className={`tabular shrink-0 text-sm ${KIND_STYLE[row.kind]}`}>
                    {row.isCommunal ? '0' : `${KIND_SIGN[row.kind]}${formatAmount(row.amount)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded border border-current/25 px-1 text-[0.65rem] leading-4 ${className}`}
    >
      {children}
    </span>
  );
}
