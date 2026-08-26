import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { deleteTransaction, updateTransaction } from '@/app/actions/transactions';
import { TransactionForm } from '@/components/TransactionForm';
import { db } from '@/db';
import { transactionRevisions } from '@/db/schema';
import { daysAgoISO, formatAmount, todayISO } from '@/lib/format';
import { getCategories, getTransaction } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function EditTransactionPage({ params }: PageProps<'/transactions/[id]'>) {
  const { id } = await params;
  const user = await requireUser();

  /*
   * 先確認這筆帳是你的，再查其他東西。
   *
   * 原本是三支查完才判斷 notFound —— 多人之後那個順序不能留：修改紀錄
   * 只認 transaction_id，不知道那筆帳是誰的，等於別人的修改紀錄也照撈不誤。
   * 雖然頁面最後還是會 404、撈回來的東西一個字都不會顯示出去，
   * 但「查了不該查的資料，只是剛好沒印出來」不是一個能安心的狀態。
   * 順便省掉 404 路徑上的兩支查詢。
   */
  const row = await getTransaction(user.id, id);
  if (!row) notFound();

  // 排隊查，不要一次開好幾條新連線（見首頁那段註解）
  const categories = await getCategories(user.id, { activeOnly: false });
  const revisions = await db
    .select()
    .from(transactionRevisions)
    .where(eq(transactionRevisions.transactionId, id))
    .orderBy(desc(transactionRevisions.changedAt));

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const quickDates = [
    { iso: todayISO(), label: '今天' },
    { iso: daysAgoISO(1), label: '昨天' },
    { iso: daysAgoISO(2), label: '前天' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/transactions" className="text-sm text-text-muted hover:text-text">
          ← 明細
        </Link>
        <h1 className="text-sm text-text-muted">修改紀錄</h1>
      </div>

      <TransactionForm
        action={updateTransaction}
        categories={categories}
        quickDates={quickDates}
        initial={row}
        submitLabel="儲存修改"
      />

      {revisions.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm text-text-muted">改過 {revisions.length} 次</h2>
          <ul className="space-y-2">
            {revisions.map((rev) => {
              const before = rev.before as Record<string, unknown>;
              const after = rev.after as Record<string, unknown>;
              const diffs = describeDiff(before, after, categoryNames);
              return (
                <li
                  key={rev.id}
                  className="rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-xs"
                >
                  <p className="text-text-faint">
                    {rev.changedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-text-muted">
                    {diffs.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {rev.reason && <p className="mt-1 text-text-faint">備註：{rev.reason}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form action={deleteTransaction} className="border-t border-border pt-5">
        <input type="hidden" name="id" value={row.id} />
        <button
          type="submit"
          className="w-full rounded-[var(--radius)] border border-expense/30 py-2.5 text-sm text-expense transition-colors hover:bg-expense/10"
        >
          刪除這筆
        </button>
        <p className="mt-2 text-center text-xs text-text-faint">
          刪掉就找不回來了，只是記錯性質的話直接在上面改就好
        </p>
      </form>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  date: '日期',
  amount: '金額',
  categoryId: '分類',
  kind: '性質',
  note: '備註',
  isFixed: '固定支出',
  isCommunal: '開伙',
  isEstimated: '估算',
};

const KIND_LABELS: Record<string, string> = { expense: '支出', income: '收入', advance: '暫付款' };

function display(field: string, value: unknown): string {
  if (value === null || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (field === 'amount') return formatAmount(Number(value));
  if (field === 'kind') return KIND_LABELS[String(value)] ?? String(value);
  return String(value);
}

function describeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  categoryNames: Map<string, string>,
): string[] {
  // 稽核裡存的是分類 uuid，換回名字才看得懂改了什麼
  const show = (key: string, value: unknown) =>
    key === 'categoryId'
      ? (categoryNames.get(String(value)) ?? '（已刪除的分類）')
      : display(key, value);

  return Object.keys(FIELD_LABELS)
    .filter((key) => before[key] !== after[key])
    .map((key) => `${FIELD_LABELS[key]}：${show(key, before[key])} → ${show(key, after[key])}`);
}
