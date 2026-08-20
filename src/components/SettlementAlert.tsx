import Link from 'next/link';

import { formatAmount } from '@/lib/format';
import type { SettlementRow } from '@/lib/queries';

/**
 * 規格書 2.2：這類項目過去在月結算時被漏掉過，所以要一直看得到。
 *
 * 但**「一直看得到」不等於「天天擋在首頁」**。這裡收到的已經是篩過的
 * 「該追的」（到期、過期、沒寫時間），押金那種要等到 2027 年的不會進來 ——
 * 一個你無法解決卻天天在叫的提醒，最後只會逼人為了讓它閉嘴而按下結清，
 * 那等於系統教人在資料上說謊。完整清單永遠在 /settlements。
 *
 * 它只是提醒不是清單，所以壓成一行；首頁擺三筆明細會跟記帳表單搶注意力。
 */
export function SettlementAlert({ items }: { items: SettlementRow[] }) {
  if (items.length === 0) return null;

  const known = items.filter((i) => i.expectedAmount !== null);
  const total = known.reduce((sum, i) => sum + (i.expectedAmount ?? 0), 0);

  return (
    <Link
      href="/settlements"
      className="flex items-center gap-3 rounded-[var(--radius)] border border-estimated/30 bg-estimated/5 px-4 py-3 transition-colors hover:bg-estimated/10"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-estimated">
        有 {items.length} 筆該追了
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
