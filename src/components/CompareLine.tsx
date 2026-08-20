import { formatAmount } from '@/lib/format';

/**
 * 「比上個月同一時候少 480」。
 *
 * 這是整張卡片上唯一會告訴 Gino「所以我到底是鬆還是緊」的一行 ——
 * 一個絕對金額沒有參照點，看了也不知道要不要緊張。
 *
 * 刻意不引進「預算」：規格書沒有預算這個概念，而且 Gino 是週更補帳、
 * 不是天天盯著花，設一個數字然後每天提醒他超支，只會讓人不想打開。
 * 跟自己的上個月比不需要事先設定任何東西。
 *
 * 顏色：花得少是綠的、多是紅的。但**不寫任何評價字眼**（「很棒」「注意」），
 * 有些月份本來就會多（繳保費、買機票），系統不知道，講了只會顯得很蠢。
 */
export function CompareLine({
  current,
  previous,
  label,
}: {
  current: number;
  /** 沒得比就給 null，整行不顯示 */
  previous: number | null;
  /** 「上個月同一時候」或「上個月」 */
  label: string;
}) {
  if (previous === null) return null;
  // 兩邊都是 0 的時候講「一樣多」很怪，那只是還沒開始記
  if (previous === 0 && current === 0) return null;

  if (previous === 0) {
    return <p className="mt-2.5 text-xs text-text-faint">{label}還沒有紀錄，沒得比</p>;
  }

  const diff = current - previous;
  const percent = Math.round((diff / previous) * 100);

  if (diff === 0) {
    return (
      <p className="mt-2.5 text-xs text-text-muted">
        跟{label}<span className="text-text">一模一樣</span>
      </p>
    );
  }

  const more = diff > 0;
  return (
    <p className="mt-2.5 text-xs text-text-muted">
      比{label}
      <span className={more ? 'text-expense' : 'text-income'}>
        {more ? '多' : '少'}{' '}
        <span className="tabular">{formatAmount(Math.abs(diff))}</span>
      </span>
      <span className="tabular ml-1.5 text-text-faint">
        （{more ? '+' : '−'}
        {Math.abs(percent)}%）
      </span>
    </p>
  );
}
