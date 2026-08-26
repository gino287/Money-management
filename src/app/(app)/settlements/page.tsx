import { reopenSettlement } from '@/app/actions/settlements';
import { PageHeader } from '@/components/PageHeader';
import { SettlementForm } from '@/components/SettlementForm';
import { SettlementItem } from '@/components/SettlementItem';
import { getCategories, getSettlements, isDue } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SettlementsPage() {
  const user = await requireUser();

  const all = await getSettlements(user.id);
  const categories = await getCategories(user.id, { activeOnly: false });

  const open = all.filter((s) => s.status === 'open');
  const settled = all.filter((s) => s.status === 'settled');

  /*
   * 分成兩區，因為這兩種東西要用完全不同的態度看：
   *
   * 「快到了」是這個月該去追的（到期、過期、或連自己都說不出什麼時候回來的）——
   * 這幾筆才會出現在首頁。
   * 「還早」是押金那種要等到明年退租的，看得到、不會消失，但平常不吵人。
   */
  const due = open.filter((s) => isDue(s));
  const later = open.filter((s) => !isDue(s));

  return (
    <div className="space-y-6">
      <PageHeader
        title="待結清"
        description="暫付款、押金、借出去的錢、待回收的補助。收回可以分好幾次記，結清要自己確認。"
      />

      <SettlementForm />

      <section>
        <h2 className="mb-2 px-1 text-sm text-text-muted">
          該追的 {due.length > 0 && `(${due.length})`}
        </h2>
        {due.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-border px-4 py-10 text-center text-sm text-text-faint">
            {later.length > 0 ? '這個月沒有要追的，下面那些還早' : '都結清了'}
          </p>
        ) : (
          <ul className="space-y-2">
            {due.map((item) => (
              <SettlementItem key={item.id} item={item} categories={categories} />
            ))}
          </ul>
        )}
      </section>

      {later.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm text-text-muted">還早（{later.length}）</h2>
          <p className="mb-2 px-1 text-xs text-text-faint">
            這些不會出現在首頁，時間到了才會跳出來提醒。
          </p>
          <ul className="space-y-2">
            {later.map((item) => (
              <SettlementItem key={item.id} item={item} categories={categories} />
            ))}
          </ul>
        </section>
      )}

      {settled.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm text-text-muted">已結清</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
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
