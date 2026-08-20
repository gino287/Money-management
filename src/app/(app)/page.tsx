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
  shiftMonth,
  todayISO,
} from '@/lib/format';
import {
  deriveBudget,
  derivePulse,
  getCategories,
  getDailyTotals,
  getMonthlyTotals,
  getSettlements,
  getTransactions,
  summarizeTotals,
  type MonthTotals,
  type Pulse,
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
   *
   * getDailyTotals 同理：它一支就餵飽了「今天花多少」「七天小圖」「連續記帳」
   * 「跟上個月同一天比」「月底預估」五個地方。要是每個各查一支，這頁就要排隊九次。
   */
  const categories = await getCategories({ activeOnly: false });
  const daily = await getDailyTotals();
  const trend = await getMonthlyTotals(6);
  const recent = await getTransactions({}, 4);
  const openSettlements = await getSettlements('open');

  const pulse = derivePulse(daily);

  /*
   * 「還可以花多少」跟「固定支出還沒記完」都從已經查好的 trend 算出來，不多查一支。
   * 詳細的版本（哪一筆固定支出沒記、累積結餘走向）在月結算頁，那裡才多查一支去比對分類。
   */
  const pendingFixed = missingFixed(trend, month);
  const budget = deriveBudget(
    trend,
    month,
    pulse.daysInMonth - pulse.daysElapsed + 1,
    pendingFixed,
  );
  const fixedHint =
    pendingFixed > 0
      ? `固定支出好像還沒記　·　上面已經先扣掉 ${formatAmount(pendingFixed)}`
      : null;

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
            <p className="mt-1.5 text-sm text-text-muted">{todayLine(pulse)}</p>
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
          pulse={pulse}
          budget={budget}
          fixedHint={fixedHint}
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
 * 這個月還沒記的固定支出大概是多少。
 *
 * 拿來從「還可以花多少」裡先扣掉 —— 房租還沒記的時候說「還可以花兩萬」是騙人的，
 * 那一萬一千塊已經有主了。
 *
 * 首頁只比得出金額，比不出是哪一筆 —— 要知道是房租還是壇費得多查一支，
 * 而這一頁的查詢數是有預算的（見上面那段註解）。所以首頁只負責讓人起疑，
 * 月結算頁的 FixedCheck 才會指名道姓。
 *
 * 差一千塊以上才講：固定支出的金額本來就會小幅變動（壇費從 650 變成 700 過），
 * 差幾十塊就跳提醒，兩個月後就沒人看了。
 */
function missingFixed(trend: MonthTotals[], month: string): number {
  const current = trend.find((t) => t.month === month);
  const previous = trend.find((t) => t.month === shiftMonth(month, -1));
  if (!current || !previous) return 0;

  const gap = previous.fixedExpense - current.fixedExpense;
  return gap >= 1000 ? gap : 0;
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
function todayLine({ today: t, streak }: Pulse): string {
  // 一天都還沒記的時候，「連續 5 天」是提醒也是台階，比乾巴巴一句「還沒記帳」好
  if (t.count === 0) {
    return streak > 1 ? `今天還沒記帳　·　已經連續 ${streak} 天了` : '今天還沒記帳';
  }

  const communal = t.communalCount > 0 ? `　·　開伙 ${t.communalCount} 次` : '';
  if (t.expense > 0) return `今天花了 NT$${formatAmount(t.expense)}${communal}`;
  if (t.communalCount > 0) return `今天開伙 ${t.communalCount} 次`;
  return `今天記了 ${t.count} 筆`;
}
