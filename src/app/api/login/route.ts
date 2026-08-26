import { and, eq, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/db';
import { users } from '@/db/schema';
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth';

/**
 * 登入刻意用最原始的表單 POST + 303 導頁，不走 Server Action。
 *
 * Server Action 搭配 useActionState 時，成功後的導頁得靠用戶端 router，
 * 實測會有畫面換不過去、按鈕卡在「驗證中…」的情況。登入是進入整個系統的
 * 那道門，寧可用瀏覽器原生行為，連 JavaScript 沒載入都還能登入。
 */
export const dynamic = 'force-dynamic';

/**
 * 名字打錯時拿來擋時間差用的假雜湊。
 *
 * 沒有這一段的話，「查無此人」會立刻回，「有這個人但密碼錯」要先算完
 * 二十一萬次 PBKDF2 才回 —— 兩者差好幾十毫秒，等於免費告訴外面
 * 哪些名字是存在的。名字不存在時也照樣算一次，兩條路的時間就對得上。
 */
const DUMMY_HASH =
  'pbkdf2$210000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const rawNext = String(form.get('next') ?? '/');

  // 只接受站內相對路徑，避免被塞外部網址當跳板
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const fail = () => {
    const back = new URL('/login', request.url);
    back.searchParams.set('e', '1');
    // 名字帶回去，不然每次打錯密碼都要連名字一起重打
    if (name) back.searchParams.set('name', name);
    if (next !== '/') back.searchParams.set('next', next);
    return NextResponse.redirect(back, 303);
  };

  if (!name || !password) return fail();

  /*
   * 名字不分大小寫、也不管前後空白 —— 手機鍵盤很愛自動把第一個字母變大寫，
   * 為了這個讓人登不進去太冤。停用的人查不出來，等同於不存在。
   */
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(and(sql`lower(${users.name}) = ${name.toLowerCase()}`, eq(users.isActive, true)))
    .limit(1);

  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return fail();

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return response;
}
