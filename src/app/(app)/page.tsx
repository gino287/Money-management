import Link from 'next/link';

import { MonthSummary } from '@/components/MonthSummary';
import { SettlementAlert } from '@/components/SettlementAlert';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionList } from '@/components/TransactionList';
import { currentMonth, daysAgoISO, formatMonth, todayISO } from '@/lib/format';
import { getCategories, getSettlements, getTransactions, summarize } from '@/lib/queries';

import { createTransaction } from '../actions/transactions';

// 記完帳要立刻看到，不能吃到快取
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const month = currentMonth();

  const [categories, monthRows, recent, openSettlements] = await Promise.all([
    getCategories({ activeOnly: false }),
    getTransactions({ month }),
    getTransactions({}, 8),
    getSettlements('open'),
  ]);

  const quickDates = [
    { iso: todayISO(), label: '今天' },
    { iso: daysAgoISO(1), label: '昨天' },
    { iso: daysAgoISO(2), label: '前天' },
  ];

  return (
    <div className="space-y-6">
      <SettlementAlert items={openSettlements} />

      <TransactionForm
        action={createTransaction}
        categories={categories}
        quickDates={quickDates}
      />

      <section>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm text-text-muted">{formatMonth(month)}</h2>
          <Link href="/transactions" className="text-xs text-text-faint hover:text-text-muted">
            看全部 →
          </Link>
        </div>
        <MonthSummary summary={summarize(monthRows)} />
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm text-text-muted">最近</h2>
        <TransactionList rows={recent} emptyHint="還沒有紀錄，上面記第一筆吧" />
      </section>
    </div>
  );
}
