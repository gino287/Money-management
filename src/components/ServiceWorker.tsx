'use client';

import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // 開發模式註冊 SW 會讓熱重載行為變得難以預測
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 註冊失敗不影響使用，安靜略過
    });
  }, []);

  return null;
}
