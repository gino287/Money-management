import type { Metadata, Viewport } from 'next';

import { ServiceWorker } from '@/components/ServiceWorker';

import './globals.css';

export const metadata: Metadata = {
  title: '記帳',
  description: 'Gino 的個人記帳系統',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
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
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
