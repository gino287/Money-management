'use client';

import Link from 'next/link';
import { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 底部導覽列。
 *
 * 圖示是自己畫的 inline SVG，不裝圖示套件 —— 只用五個，
 * 為此多背一個相依套件跟幾十 KB 的 JavaScript 不划算，
 * 而且 inline SVG 可以直接吃 currentColor，換色不用寫額外的樣式。
 *
 * 「有圖示」這件事對「像不像一個真的 app」影響很大：純文字的分頁列
 * 一看就是網頁。圖示 + 文字兩層是 iOS 原生 tab bar 的標準做法。
 */

function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="absolute inset-x-0 top-1 mx-auto size-1 animate-ping rounded-full bg-accent" />;
}

type IconProps = { className?: string };

const Icon = {
  記帳: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  ),
  明細: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M5 6h14M5 12h14M5 18h9" strokeLinecap="round" />
    </svg>
  ),
  月結算: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M5 19V11M12 19V6M19 19v-5" strokeLinecap="round" />
    </svg>
  ),
  待結清: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" />
    </svg>
  ),
  分類: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </svg>
  ),
} as const;

const LINKS = [
  { href: '/', label: '記帳' },
  { href: '/transactions', label: '明細' },
  { href: '/summary', label: '月結算' },
  { href: '/settlements', label: '待結清' },
  { href: '/categories', label: '分類' },
] as const;

export function Nav({ openCount }: { openCount: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-20 border-t border-border bg-surface/80 backdrop-blur-xl sm:top-0 sm:bottom-auto sm:border-t-0 sm:border-b"
      /* iPhone 從主畫面開啟時，底部有 home indicator，要墊高避免被蓋住 */
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-2xl">
        {LINKS.map((link) => {
          // 明細的子頁（改一筆帳）也要讓「明細」保持亮著
          const active =
            pathname === link.href ||
            (link.href !== '/' && pathname.startsWith(`${link.href}/`));
          const Glyph = Icon[link.label];

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${
                active ? 'text-accent' : 'text-text-faint hover:text-text-muted'
              }`}
            >
              <span className="relative">
                <Glyph className="size-[1.35rem]" />
                {link.href === '/settlements' && openCount > 0 && (
                  <span
                    data-testid="open-count"
                    aria-label={`${openCount} 筆未結清`}
                    className="absolute -top-0.5 -right-1.5 flex min-w-[1rem] justify-center rounded-full bg-estimated px-1 text-[0.6rem] leading-4 font-medium text-bg"
                  >
                    {openCount}
                  </span>
                )}
              </span>
              <span className="text-[0.65rem] leading-none">{link.label}</span>
              <Pending />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
