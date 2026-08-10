import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, checkPassword, createSessionToken, sessionCookieOptions } from '@/lib/auth';

/**
 * 登入刻意用最原始的表單 POST + 303 導頁，不走 Server Action。
 *
 * Server Action 搭配 useActionState 時，成功後的導頁得靠用戶端 router，
 * 實測會有畫面換不過去、按鈕卡在「驗證中…」的情況。登入是進入整個系統的
 * 那道門，寧可用瀏覽器原生行為，連 JavaScript 沒載入都還能登入。
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const rawNext = String(form.get('next') ?? '/');

  // 只接受站內相對路徑，避免被塞外部網址當跳板
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  if (!checkPassword(password)) {
    const back = new URL('/login', request.url);
    back.searchParams.set('e', '1');
    if (next !== '/') back.searchParams.set('next', next);
    return NextResponse.redirect(back, 303);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return response;
}
