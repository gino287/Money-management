import Link from 'next/link';

import { formatAmount } from '@/lib/format';
import type { FixedItem } from '@/lib/queries';

/**
 * 「房租還沒記」。
 *
 * 固定支出最容易漏記，正因為它每個月都一樣 —— 沒有任何一次消費的記憶點去提醒你。
 * Gino 的舊 Excel 每個月都手動列一次租金、壇費對帳，8 月那張還寫著「月租 11,000 尚未入帳」。
 *
 * 只比對「上個月有、這個月還沒有」，不做預測也不自動補記：金額會變
 * （壇費從 650 變成 700 過），自動記會安靜地記錯，比漏記更難發現。
 *
 * 沒有漏的時候整塊不顯示 —— 每個月都跳一句「都記好了」，兩個月後就會被當成背景。
 */
export function FixedCheck({ items }: { items: FixedItem[] }) {
  const missing = items.filter((i) => i.previous > 0 && i.current === 0);
  if (missing.length === 0) return null;

  return (
    <Link
      href="/"
      className="block rounded-[var(--radius-lg)] border border-estimated/25 bg-surface px-4 py-3.5 transition-colors hover:border-estimated/50"
    >
      <p className="text-sm text-estimated">
        {missing.map((i) => i.name).join('、')}這個月還沒記
      </p>
      <p className="tabular mt-1 text-xs text-text-faint">
        {missing.map((i) => `上個月 ${i.name} ${formatAmount(i.previous)}`).join('　·　')}
        　·　去記一筆 →
      </p>
    </Link>
  );
}
