import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/** Next 16 起這個檔案叫 proxy，就是以前的 middleware */
export async function proxy(request: NextRequest) {
  const isLoggedIn = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  // 登入端點本身當然不能被登入檢查擋住，否則永遠登不進來
  if (pathname === '/api/login' || pathname === '/api/logout') return NextResponse.next();

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
     * 保護所有頁面，但放行 PWA 相關資源：
     * - manifest 與 icons 未登入狀態讀不到的話，iPhone 就加不了主畫面
     * - /offline 是 service worker 的離線備援頁，安裝時就要能預先快取。
     *   若在這裡被擋下並導向 /login，快取起來的會是登入頁，真正離線時
     *   看到的就不是離線提示而是一張登不進去的登入頁。頁面本身沒有任何
     *   個人資料，公開無妨。
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline|icons/).*)',
  ],
};
