import { formatAmount, todayISO } from '@/lib/format';
import { pushText } from '@/lib/line';
import { countTransactionsOn, getSettlements } from '@/lib/queries';

/**
 * 每天晚上的記帳提醒（Vercel Cron 打進來，排程在 vercel.json）。
 *
 * 兩件事先講清楚，看到行為跟預期不符時不要以為壞了：
 *
 * 1. **免費方案一天只能排一次，而且只保證落在那個小時內。**
 *    排 `0 14 * * *`（台北 22:00）實際可能 22:00～22:59 之間才發。
 *    這是 Vercel Hobby 方案的規則，不是這裡寫錯。
 * 2. **排程一律是 UTC**，所以台北時間要自己減八小時。
 *
 * 今天已經記過帳就不吵 —— 每天固定跳一則「記帳囉」很快就會被無視，
 * 只有在真的漏記的那天出現，提醒才有意義。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Vercel 會把 CRON_SECRET 當成 Authorization 標頭送過來。
  // 沒設就一律拒絕：這支端點會主動發訊息，不能讓任何人打得動。
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const to = process.env.LINE_USER_ID;
  if (!to) return Response.json({ 結果: '沒有設定 LINE_USER_ID，沒有人可以提醒' });

  const today = todayISO();
  const count = await countTransactionsOn(today);

  if (count > 0) {
    return Response.json({ 日期: today, 今日筆數: count, 結果: '今天記過了，不打擾' });
  }

  const open = await getSettlements('open');
  const lines = ['今天還沒記帳喔。', '想到什麼就直接傳一句話給我，例如「晚餐 120」。'];
  if (open.length > 0) {
    const total = open.reduce((sum, s) => sum + (s.expectedAmount ?? 0), 0);
    lines.push('');
    lines.push(
      `另外還有 ${open.length} 筆沒結清${total > 0 ? `（約 ${formatAmount(total)} 元）` : ''}。`,
    );
  }

  await pushText(to, lines.join('\n'));
  return Response.json({ 日期: today, 今日筆數: 0, 結果: '已提醒', 待結清: open.length });
}
