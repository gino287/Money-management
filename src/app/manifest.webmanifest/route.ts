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
    /**
     * 長按主畫面圖示跳出來的捷徑。iOS 目前不理它，Android 與桌面會用，
     * 而且成本只有這幾行，先放著。
     */
    shortcuts: [
      { name: '記一筆', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: '這個月花多少', url: '/summary' },
      { name: '待結清', url: '/settlements' },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
