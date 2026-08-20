import Link from 'next/link';

import { MonthSummary } from '@/components/MonthSummary';
import { QuickEntry } from '@/components/QuickEntry';
import { SettlementAlert } from '@/components/SettlementAlert';
import { TransactionList } from '@/components/TransactionList';
import {
  currentMonth,
  daysAgoISO,
  formatAmount,
  formatDate,
  formatMonthShort,
  formatWeekday,
  greeting,
  todayISO,
} from '@/lib/format';
import {
  getCategories,
  getDayTotals,
  getMonthlyTotals,
  getSettlements,
  getTransactions,
  summarizeTotals,
  type DayTotals,
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
   * 少一支查詢，而且少掉的正是最大的那一支。getDayTotals 是等值比對單一天，
   * 是這幾支裡最便宜的一支。
   */
  const categories = await getCategories({ activeOnly: false });
  const dayTotals = await getDayTotals(today);
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
      {/* 第一層：打個招呼、今天過得怎樣、有沒有事情擱著 */}
      <header className="space-y-3.5 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.6rem] leading-tight font-medium">{greeting()}，Gino</h1>
            <p className="mt-1.5 text-sm text-text-muted">{todayLine(dayTotals)}</p>
          </div>
          <p className="tabular shrink-0 pt-1.5 text-xs text-text-faint">
            {formatDate(today)} 週{formatWeekday(today)}
          </p>
        </div>
        <SettlementAlert items={openSettlements} />
      </header>

      {/* 第二層：這頁真正要做的事。預設只露出一個輸入框，其餘按「自己填」才展開 */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
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

/**
 * 招呼底下那一行。
 *
 * 只講今天的事 —— 月結算在下面有一整張卡片，這裡再放月份數字只是重複。
 * 收入也不放這裡：一個月進帳兩三次，天天佔著一行不划算，而且長到會折行。
 * 手機上這一行折成兩行，整個招呼區就散掉了，所以最多兩截。
 *
 * 沒記東西的時候給的是「今天還沒記」而不是「花了 0」：0 看起來像事實，
 * 但實際上多半是還沒記，講錯話比不講話糟。
 */
function todayLine(t: DayTotals): string {
  if (t.count === 0) return '今天還沒記帳';

  const communal = t.communalCount > 0 ? `　·　開伙 ${t.communalCount} 次` : '';
  if (t.expense > 0) return `今天花了 NT$${formatAmount(t.expense)}${communal}`;
  if (t.communalCount > 0) return `今天開伙 ${t.communalCount} 次`;
  return `今天記了 ${t.count} 筆`;
}
