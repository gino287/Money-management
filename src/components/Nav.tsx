'use client';

import Link from 'next/link';
import { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

/** 點下去到新頁面畫出來之間，先讓被點的那一項亮起來，不要讓人以為沒按到 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="absolute inset-x-0 -bottom-px mx-auto h-px w-8 animate-pulse bg-accent sm:inset-x-auto sm:bottom-0" />
  );
}

const LINKS = [
  { href: '/', label: '記帳' },
  { href: '/transactions', label: '明細' },
  { href: '/settlements', label: '待結清' },
  { href: '/categories', label: '分類' },
] as const;

export function Nav({ openCount }: { openCount: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur sm:top-0 sm:bottom-auto sm:border-t-0 sm:border-b"
      /* iPhone 從主畫面開啟時，底部有 home indicator，要墊高避免被蓋住 */
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-2xl">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex-1 py-3 text-center text-sm transition-colors ${
                active ? 'text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {link.label}
              {link.href === '/settlements' && openCount > 0 && (
                <span className="ml-1 inline-flex min-w-[1.15rem] justify-center rounded-full bg-estimated/20 px-1 text-[0.7rem] leading-[1.15rem] text-estimated">
                  {openCount}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-0 top-0 mx-auto h-px w-8 bg-accent sm:top-auto sm:bottom-0" />
              )}
              <Pending />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
