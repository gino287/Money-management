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
  greeting,
  todayISO,
} from '@/lib/format';
import {
  getCategories,
  getMonthlyTotals,
  getSettlements,
  getTransactions,
  summarizeTotals,
} from '@/lib/queries';

import { parseSentence } from '../actions/parse';
import { createTransaction } from '../actions/transactions';

// 記完帳要立刻看到，不能吃到快取
export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  /**
   * ?say=一句話 會把口語輸入框先填好。
   *
   * 是給「不先開瀏覽器就記帳」的入口用的：Windows 的 AutoHotkey 腳本
   * （scripts/快速記帳.ahk）、iPhone 的「捷徑」App、或一個瀏覽器書籤，
   * 都只要組出這個網址就行，不必各自實作一套 API。
   *
   * 只預填、不自動送出 —— 送出會花錢呼叫 AI，網址被誤點就不該觸發。
   */
  const params = await searchParams;
  const rawSay = Array.isArray(params.say) ? params.say[0] : params.say;
  const say = (rawSay ?? '').trim().slice(0, 200);

  const month = currentMonth();
  const today = todayISO();

  /**
   * 刻意「一支一支查」，不要用 Promise.all。
   *
   * 同時發多支查詢＝要同時開多條新連線，而 Supabase 的 pooler 在一次開多條
   * 新連線時，會有一條回假的 statement timeout（2026-08-18 用獨立腳本重現過：
   * 全新連線第一輪五支會掛一支，之後連線熱了跑八輪五支全過、每輪 45ms）。
   * 這就是「其他頁都好、只有記帳頁隨機黑畫面」的原因 —— 只有這頁一次查好幾樣。
   *
   * 排隊查的代價：本機每支多約 40ms，部署到 Vercel 上跟資料庫同機房只差幾毫秒。
   * 拿這個換「不會卡住」很划算。
   *
   * 也因為這樣，這一頁的查詢數要斤斤計較。月結算的數字改成從 getMonthlyTotals
   * 的聚合結果直接算（summarizeTotals），不再另外撈當月每一筆回來加總 ——
   * 少一支查詢，而且少掉的正是最大的那一支。
   */
  const categories = await getCategories({ activeOnly: false });
  const trend = await getMonthlyTotals(6);
  const recent = await getTransactions({}, 4);
  const openSettlements = await getSettlements('open');

  const quickDates = [
    { iso: today, label: '今天' },
    { iso: daysAgoISO(1), label: '昨天' },
    { iso: daysAgoISO(2), label: '前天' },
  ];

  return (
    <div className="space-y-6">
      {/* 第一層：今天是哪天、有沒有事情擱著 */}
      <header className="space-y-3 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl">{greeting()}</h1>
          <p className="tabular text-xs text-text-faint">
            {formatDate(today)} 週{formatWeekday(today)}
          </p>
        </div>
        <SettlementAlert items={openSettlements} />
      </header>

      {/* 第二層：這頁真正要做的事 */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
        <h2 className="mb-3 px-0.5 text-sm text-text-muted">記一筆</h2>
        <QuickEntry
          parseAction={parseSentence}
          createAction={createTransaction}
          categories={categories}
          quickDates={quickDates}
          initialSentence={say}
        />
      </section>

      {/* 第三層：記完之後看一眼結果 */}
      <section>
        <MonthSummary
          summary={summarizeTotals(trend[trend.length - 1])}
          label={formatMonthShort(month)}
          href="/summary"
          linkLabel="月結算"
          trend={trend}
          activeMonth={month}
        />
      </section>

      {/* 第四層：最近記了什麼，只給一眼，要翻就去明細 */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <h2 className="text-sm text-text-muted">最近記的</h2>
          <Link
            href="/transactions"
            className="text-xs text-text-faint transition-colors hover:text-text-muted"
          >
            全部 →
          </Link>
        </div>
        <TransactionList rows={recent} emptyHint="還沒有紀錄，上面記第一筆吧" />
      </section>
    </div>
  );
}
