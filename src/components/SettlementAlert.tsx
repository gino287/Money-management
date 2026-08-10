import Link from 'next/link';

import type { Settlement } from '@/db/schema';
import { formatAmount } from '@/lib/format';

/**
 * 規格書 2.2：這類項目過去在月結算時被漏掉過。
 * 所以只要還有沒結清的，首頁最上方就一直看得到，不收合、不能關掉。
 */
export function SettlementAlert({ items }: { items: Settlement[] }) {
  if (items.length === 0) return null;

  return (
    <Link
      href="/settlements"
      className="block rounded-[var(--radius)] border border-estimated/30 bg-estimated/5 px-4 py-3 transition-colors hover:bg-estimated/10"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-estimated">還有 {items.length} 筆沒結清</p>
        <span className="text-xs text-text-faint">查看 →</span>
      </div>
      <ul className="mt-2 space-y-1">
        {items.slice(0, 3).map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-xs text-text-muted">
            <span className="truncate">{item.title}</span>
            <span className="tabular shrink-0">
              {item.expectedAmount === null ? '金額未定' : formatAmount(item.expectedAmount)}
            </span>
          </li>
        ))}
        {items.length > 3 && (
          <li className="text-xs text-text-faint">還有 {items.length - 3} 筆…</li>
        )}
      </ul>
    </Link>
  );
}
