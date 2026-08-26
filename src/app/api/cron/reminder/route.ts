import { formatAmount, todayISO } from '@/lib/format';
import { pushText } from '@/lib/line';
import { countTransactionsOn, getLineUsers, getSettlements } from '@/lib/queries';

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
 *
 * 多人之後這支跑一圈所有綁了 LINE 的人，各自算各自的。一天還是只跑一次，
 * 排程數不會因為多一個人就變多 —— 會變多的是**推播則數**，見下面 QUOTA 的說明。
 */
export const dynamic = 'force-dynamic';

/**
 * LINE 的免費方案每月有主動推播的則數上限（目前是 200 則，方案改過好幾次，
 * 以官方帳號後台顯示的為準）。回覆訊息不算在裡面，只有這種主動送出的才算。
 *
 * 一個人最壞情況是每天都沒記帳、每天被提醒一次＝一個月 30 則。
 * 兩三個人還很寬鬆，真的加到六七個人就要回頭看一眼後台的用量。
 */
const QUOTA_NOTE = '每人每月最多 30 則';

export async function GET(request: Request) {
  // Vercel 會把 CRON_SECRET 當成 Authorization 標頭送過來。
  // 沒設就一律拒絕：這支端點會主動發訊息，不能讓任何人打得動。
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const users = await getLineUsers();
  if (users.length === 0) {
    return Response.json({ 結果: '沒有人綁定 LINE，沒有人可以提醒' });
  }

  const today = todayISO();
  const results: Record<string, string>[] = [];

  for (const user of users) {
    // lineUserId 在 getLineUsers 已經濾過不是 null，這裡只是讓型別放心
    const to = user.lineUserId;
    if (!to) continue;

    const count = await countTransactionsOn(user.id, today);
    if (count > 0) {
      results.push({ 誰: user.name, 結果: `今天記了 ${count} 筆，不打擾` });
      continue;
    }

    const open = await getSettlements(user.id, 'open');
    const lines = ['今天還沒記帳喔。', '想到什麼就直接傳一句話給我，例如「晚餐 120」。'];
    if (open.length > 0) {
      const total = open.reduce((sum, s) => sum + (s.expectedAmount ?? 0), 0);
      lines.push('');
      lines.push(
        `另外還有 ${open.length} 筆沒結清${total > 0 ? `（約 ${formatAmount(total)} 元）` : ''}。`,
      );
    }

    /*
     * 一個人推播失敗不能讓整圈停掉 —— 後面的人也就跟著收不到提醒了。
     * pushText 本身已經把網路錯誤吞掉並記 log，這裡再包一層是防它以外的意外。
     */
    try {
      await pushText(to, lines.join('\n'));
      results.push({ 誰: user.name, 結果: '已提醒', 待結清: String(open.length) });
    } catch (error) {
      console.error(`[cron] 提醒 ${user.name} 失敗：`, (error as Error).message);
      results.push({ 誰: user.name, 結果: '推播失敗' });
    }
  }

  return Response.json({ 日期: today, 推播額度: QUOTA_NOTE, 明細: results });
}
