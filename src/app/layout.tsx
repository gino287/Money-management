import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '記帳',
  description: 'Gino 的個人記帳系統',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '記帳',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  // 關掉縮放，從主畫面開啟時才不會被誤觸雙指放大
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
