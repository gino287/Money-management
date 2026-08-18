import Link from 'next/link';

import type { Settlement } from '@/db/schema';
import { formatAmount } from '@/lib/format';

/**
 * 規格書 2.2：這類項目過去在月結算時被漏掉過。
 * 所以只要還有沒結清的，首頁最上方就一直看得到，不收合、不能關掉。
 *
 * 但它只是提醒，不是清單 —— 壓成一行，細節在 /settlements。
 * 首頁擺三筆明細會跟下面的記帳表單搶注意力。
 */
export function SettlementAlert({ items }: { items: Settlement[] }) {
  if (items.length === 0) return null;

  const known = items.filter((i) => i.expectedAmount !== null);
  const total = known.reduce((sum, i) => sum + (i.expectedAmount ?? 0), 0);

  return (
    <Link
      href="/settlements"
      className="flex items-center gap-3 rounded-[var(--radius)] border border-estimated/30 bg-estimated/5 px-4 py-3 transition-colors hover:bg-estimated/10"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-estimated">
        還有 {items.length} 筆沒結清
        {items.length === 1 && (
          <span className="ml-2 text-xs text-text-muted">{items[0].title}</span>
        )}
        {total > 0 && (
          <span className="tabular ml-2 text-xs text-text-faint">
            {known.length < items.length ? '已知 ' : '共 '}
            {formatAmount(total)}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs text-text-faint">查看 →</span>
    </Link>
  );
}
