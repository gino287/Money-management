/**
 * PWA manifest。用 route handler 而不是靜態檔，是為了跟 icons 一起維護。
 * proxy 有放行這條路徑，未登入也讀得到，否則 iPhone 加不了主畫面。
 */
export function GET() {
  return Response.json({
    name: '記帳',
    short_name: '記帳',
    description: 'Gino 的個人記帳系統',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: '#0b0d10',
    orientation: 'portrait',
    lang: 'zh-Hant',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
