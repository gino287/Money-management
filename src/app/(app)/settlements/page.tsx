import {
  deleteSettlement,
  reopenSettlement,
  settleSettlement,
} from '@/app/actions/settlements';
import { SettlementForm } from '@/components/SettlementForm';
import { formatAmount } from '@/lib/format';
import { getSettlements } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const DIRECTION_LABEL = { receivable: '會回來', payable: '要付出去' } as const;

export default async function SettlementsPage() {
  const all = await getSettlements();
  const open = all.filter((s) => s.status === 'open');
  const settled = all.filter((s) => s.status === 'settled');

  return (
    <div className="space-y-6">
      <header className="px-1">
        <h1 className="text-sm">待結清</h1>
        <p className="mt-1 text-xs text-text-faint">
          暫付款、押金、借出去的錢、待回收的補助。結清要自己確認，系統不會自動改帳。
        </p>
      </header>

      <SettlementForm />

      <section>
        <h2 className="mb-2 px-1 text-sm text-text-muted">未結清 {open.length > 0 && `(${open.length})`}</h2>
        {open.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center text-sm text-text-faint">
            都結清了
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((item) => (
              <li
                key={item.id}
                className="rounded-[var(--radius)] border border-estimated/25 bg-surface px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.title}</p>
                    <p className="mt-0.5 text-xs text-text-faint">
                      {DIRECTION_LABEL[item.direction]}
                      {' · '}
                      {item.openedAt.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })} 起
                    </p>
                    {item.note && <p className="mt-1 text-xs text-text-muted">{item.note}</p>}
                  </div>
                  <span className="tabular shrink-0 text-sm text-estimated">
                    {item.expectedAmount === null ? '未定' : formatAmount(item.expectedAmount)}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <form action={settleSettlement} className="flex-1">
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="w-full rounded-[var(--radius)] border border-accent/40 py-2 text-sm text-accent transition-colors hover:bg-accent-dim"
                    >
                      標記結清
                    </button>
                  </form>
                  <form action={deleteSettlement}>
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-text-faint transition-colors hover:text-expense"
                    >
                      刪除
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm text-text-muted">已結清</h2>
          <ul className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
            {settled.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-muted line-through decoration-text-faint">
                    {item.title}
                  </p>
                  <p className="text-xs text-text-faint">
                    {item.settledAt?.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })} 結清
                  </p>
                </div>
                {/* 按錯了要能還原，不然只能去資料庫改 */}
                <form action={reopenSettlement}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="shrink-0 text-xs text-text-faint transition-colors hover:text-text-muted"
                  >
                    還原
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
