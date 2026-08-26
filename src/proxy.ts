import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/** Next 16 起這個檔案叫 proxy，就是以前的 middleware */
export async function proxy(request: NextRequest) {
  /*
   * 這裡只確認「這張憑證是真的、還沒過期」，不確認那個人還在不在、有沒有被停用 ——
   * proxy 跑在 edge，碰不得資料庫（理由見 src/lib/auth.ts 開頭）。
   * 真正的身分確認在 src/lib/session.ts 的 currentUser()，每一頁都會走到。
   */
  const isLoggedIn = (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) !== null;
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  /**
   * 這幾支不能被登入檢查擋住：
   * - login／logout：擋住就永遠登不進來
   * - health：診斷用，登不進去的時候才最需要它
   * - api/line：LINE 的伺服器沒有我們的 cookie，改用官方簽章驗證（src/lib/line.ts）
   * - api/cron/*：Vercel 的排程用 CRON_SECRET 驗證。而且排程**不會跟隨轉址**，
   *   被導去 /login 的話那次提醒就是安靜地不見了，連錯誤都不會有
   */
  if (
    pathname === '/api/login' ||
    pathname === '/api/logout' ||
    pathname === '/api/health' ||
    pathname === '/api/line' ||
    pathname.startsWith('/api/cron/')
  ) {
    return NextResponse.next();
  }

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
