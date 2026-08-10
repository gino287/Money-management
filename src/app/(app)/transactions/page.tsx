import Link from 'next/link';

import { MonthSummary } from '@/components/MonthSummary';
import { TransactionList } from '@/components/TransactionList';
import type { TransactionKind } from '@/db/schema';
import { currentMonth, formatMonth, shiftMonth } from '@/lib/format';
import { getCategories, getTransactions, summarize } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const KIND_TABS: { value: TransactionKind | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'advance', label: '暫付款' },
];

export default async function TransactionsPage({ searchParams }: PageProps<'/transactions'>) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const month = one(params.month) ?? currentMonth();
  const kind = (one(params.kind) ?? '') as TransactionKind | '';
  const categoryId = one(params.category) ?? '';
  const search = one(params.q) ?? '';
  const estimatedOnly = one(params.estimated) === '1';

  const [categories, rows] = await Promise.all([
    getCategories({ activeOnly: false }),
    getTransactions({
      month,
      kind: kind || undefined,
      categoryId: categoryId || undefined,
      search: search || undefined,
      estimatedOnly,
    }),
  ]);

  // 保留其他條件、只改一個參數的網址
  const urlWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { month, kind, category: categoryId, q: search, estimated: estimatedOnly ? '1' : '', ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/transactions?${qs}` : '/transactions';
  };

  const filtered = Boolean(kind || categoryId || search || estimatedOnly);

  return (
    <div className="space-y-5">
      {/* 月份切換 */}
      <div className="flex items-center justify-between">
        <Link
          href={urlWith({ month: shiftMonth(month, -1) })}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          ←
        </Link>
        <h1 className="text-sm">{formatMonth(month)}</h1>
        <Link
          href={urlWith({ month: shiftMonth(month, 1) })}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          →
        </Link>
      </div>

      {/* 篩選後的合計要跟著篩選走，不然數字對不上眼前的清單 */}
      <MonthSummary summary={summarize(rows)} />

      <div className="space-y-2">
        <div className="flex gap-1 rounded-[var(--radius)] bg-surface p-1">
          {KIND_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={urlWith({ kind: tab.value || undefined })}
              className={`flex-1 rounded-[calc(var(--radius)-0.25rem)] py-1.5 text-center text-sm transition-colors ${
                kind === tab.value ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <form action="/transactions" className="flex gap-2">
          <input type="hidden" name="month" value={month} />
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input
            name="q"
            defaultValue={search}
            placeholder="搜尋備註"
            className="min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong"
          />
          <button
            type="submit"
            className="shrink-0 rounded-[var(--radius)] border border-border px-4 text-sm text-text-muted transition-colors hover:text-text"
          >
            搜尋
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          <Chip href={urlWith({ estimated: estimatedOnly ? undefined : '1' })} active={estimatedOnly}>
            只看估算
          </Chip>
          {categories
            .filter((c) => c.isActive || c.id === categoryId)
            .map((c) => (
              <Chip
                key={c.id}
                href={urlWith({ category: categoryId === c.id ? undefined : c.id })}
                active={categoryId === c.id}
              >
                {c.name}
              </Chip>
            ))}
        </div>

        {filtered && (
          <Link href={urlWith({ kind: undefined, category: undefined, q: undefined, estimated: undefined })} className="inline-block px-1 text-xs text-text-faint hover:text-text-muted">
            清除篩選
          </Link>
        )}
      </div>

      <TransactionList
        rows={rows}
        emptyHint={filtered ? '這些條件下沒有紀錄' : '這個月還沒有紀錄'}
      />
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? 'border-accent bg-accent-dim text-accent'
          : 'border-border bg-surface text-text-muted hover:text-text'
      }`}
    >
      {children}
    </Link>
  );
}
