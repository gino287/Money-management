import Link from 'next/link';

import { MonthSummary } from '@/components/MonthSummary';
import { QuickEntry } from '@/components/QuickEntry';
import { SettlementAlert } from '@/components/SettlementAlert';
import { TransactionList } from '@/components/TransactionList';
import {
  currentMonth,
  daysAgoISO,
  formatDate,
  formatMonthShort,
  formatWeekday,
  todayISO,
} from '@/lib/format';
import { getCategories, getSettlements, getTransactions, summarize } from '@/lib/queries';

import { parseSentence } from '../actions/parse';
import { createTransaction } from '../actions/transactions';

// 記完帳要立刻看到，不能吃到快取
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const month = currentMonth();
  const today = todayISO();

  /**
   * 刻意「一支一支查」，不要用 Promise.all。
   *
   * 同時發四支查詢＝要同時開四條新連線，而 Supabase 的 pooler 在一次開多條
   * 新連線時，會有一條回假的 statement timeout（2026-08-18 用獨立腳本重現過：
   * 全新連線第一輪五支會掛一支，之後連線熱了跑八輪五支全過、每輪 45ms）。
   * 這就是「其他頁都好、只有記帳頁隨機黑畫面」的原因 —— 只有這頁一次查四樣。
   *
   * 排隊查的代價：本機多約 150ms，部署到 Vercel 上跟資料庫同機房只差幾毫秒。
   * 拿這個換「不會卡住」很划算。
   */
  const categories = await getCategories({ activeOnly: false });
  const monthRows = await getTransactions({ month });
  const recent = await getTransactions({}, 4);
  const openSettlements = await getSettlements('open');

  const quickDates = [
    { iso: today, label: '今天' },
    { iso: daysAgoISO(1), label: '昨天' },
    { iso: daysAgoISO(2), label: '前天' },
  ];

  return (
    <div className="space-y-7">
      {/* 第一層：今天是哪天、有沒有事情擱著 */}
      <header className="space-y-3">
        <p className="text-xs text-text-faint">
          {formatDate(today)} 週{formatWeekday(today)}
        </p>
        <SettlementAlert items={openSettlements} />
      </header>

      {/* 第二層：這頁真正要做的事 */}
      <section>
        <h2 className="mb-2.5 text-sm text-text-muted">記一筆</h2>
        <QuickEntry
          parseAction={parseSentence}
          createAction={createTransaction}
          categories={categories}
          quickDates={quickDates}
        />
      </section>

      {/* 第三層：記完之後看一眼結果 */}
      <section>
        <MonthSummary
          summary={summarize(monthRows)}
          label={formatMonthShort(month)}
          href="/transactions"
        />
      </section>

      {/* 第四層：最近記了什麼，只給一眼，要翻就去明細 */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm text-text-muted">最近記的</h2>
          <Link href="/transactions" className="text-xs text-text-faint hover:text-text-muted">
            全部 →
          </Link>
        </div>
        <TransactionList rows={recent} emptyHint="還沒有紀錄，上面記第一筆吧" />
      </section>
    </div>
  );
}
