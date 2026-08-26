import Link from 'next/link';

import { MonthSummary } from '@/components/MonthSummary';
import { TransactionList } from '@/components/TransactionList';
import type { TransactionKind } from '@/db/schema';
import { currentMonth, formatMonth, formatMonthShort, shiftMonth } from '@/lib/format';
import { getCategories, getTransactions, summarize } from '@/lib/queries';
import { requireUser } from '@/lib/session';

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

  const user = await requireUser();

  // 同上，排隊查，不要一次開好幾條新連線（見首頁那段註解）
  const categories = await getCategories(user.id, { activeOnly: false });
  const rows = await getTransactions(user.id, {
    month,
    kind: kind || undefined,
    categoryId: categoryId || undefined,
    search: search || undefined,
    estimatedOnly,
  });

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
      <MonthSummary summary={summarize(rows)} label={filtered ? '篩選後' : formatMonthShort(month)} />

      <div className="space-y-2">
        <div className="flex gap-1 rounded-[var(--radius)] bg-surface-2 p-1">
          {KIND_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={urlWith({ kind: tab.value || undefined })}
              className={`flex-1 rounded-[calc(var(--radius)-0.25rem)] py-1.5 text-center text-sm transition-colors ${
                kind === tab.value ? 'bg-bg text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/*
          搜尋跟分類篩選收起來。翻明細大多只是想看這個月花了什麼，
          十次有九次不會用到這些，攤開來只是把清單擠到螢幕外面。
        */}
        <details
          className="group overflow-hidden rounded-[var(--radius)] border border-border bg-surface"
          open={Boolean(categoryId || search || estimatedOnly)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm text-text-muted">
            <span>
              篩選
              {(categoryId || search || estimatedOnly) && (
                <span className="ml-2 text-xs text-accent">使用中</span>
              )}
            </span>
            <span className="text-xs text-text-faint transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>

          <div className="space-y-3 border-t border-border px-4 py-3.5">
            <form action="/transactions" className="flex gap-2">
              <input type="hidden" name="month" value={month} />
              {kind && <input type="hidden" name="kind" value={kind} />}
              <input
                name="q"
                defaultValue={search}
                placeholder="搜尋備註"
                className="min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-bg px-3 py-2 outline-none focus:border-border-strong"
              />
              <button
                type="submit"
                className="shrink-0 rounded-[var(--radius)] border border-border px-4 text-sm text-text-muted transition-colors hover:text-text"
              >
                搜尋
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              <Chip
                href={urlWith({ estimated: estimatedOnly ? undefined : '1' })}
                active={estimatedOnly}
              >
                只看估算
              </Chip>
            </div>

            {/*
              支出與收入的分類分開列。兩邊都有一個叫「未分類」的分類，
              混在同一排會變成兩顆長得一樣的按鈕，看起來像壞掉。
            */}
            {(['expense', 'income'] as const).map((group) => {
              const list = categories.filter(
                (c) => c.kind === group && (c.isActive || c.id === categoryId),
              );
              if (list.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-1.5 text-xs text-text-faint">
                    {group === 'expense' ? '支出分類' : '收入分類'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((c) => (
                      <Chip
                        key={c.id}
                        href={urlWith({ category: categoryId === c.id ? undefined : c.id })}
                        active={categoryId === c.id}
                      >
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            })}

            {filtered && (
              <Link
                href={urlWith({
                  kind: undefined,
                  category: undefined,
                  q: undefined,
                  estimated: undefined,
                })}
                className="inline-block text-xs text-text-faint hover:text-text-muted"
              >
                清除篩選
              </Link>
            )}
          </div>
        </details>
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
