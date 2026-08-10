import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/** Next 16 起這個檔案叫 proxy，就是以前的 middleware */
export async function proxy(request: NextRequest) {
  const isLoggedIn = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  if (isLoggedIn) {
    // 已登入還跑到登入頁就直接送回首頁
    if (isLoginPage) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  if (isLoginPage) return NextResponse.next();

  // 記住原本要去的地方，登入後送回去（手機從主畫面點進來時常是深層頁）
  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * 保護所有頁面，但放行 PWA 相關檔案：
     * manifest 與 icons 若在未登入狀態讀不到，iPhone 就加不了主畫面。
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)',
  ],
};
