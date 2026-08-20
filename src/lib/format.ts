/**
 * 伺服器跑在 UTC，但「今天」永遠是台北的今天。
 * 所有日期一律用 YYYY-MM-DD 字串處理，不碰 Date 物件的時區換算。
 */
export const TZ = 'Asia/Taipei';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 台北時間的今天，YYYY-MM-DD */
export function todayISO(): string {
  return isoFormatter.format(new Date());
}

/** 相對今天推移天數，daysAgo=1 就是昨天 */
export function daysAgoISO(daysAgo: number): string {
  return isoFormatter.format(new Date(Date.now() - daysAgo * 86_400_000));
}

/** 當前月份，YYYY-MM */
export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

/** 月份的第一天與下個月的第一天，用來做半開區間查詢 [start, end) */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${next}-01` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/** 卡片上用的短月份，今年就不顯示年份 */
export function formatMonthShort(month: string): string {
  const [y, m] = month.split('-');
  return y === todayISO().slice(0, 4) ? `${Number(m)} 月` : `${y} 年 ${Number(m)} 月`;
}

/** 列表用的短日期，同年就不顯示年份 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const thisYear = todayISO().slice(0, 4);
  const short = `${Number(m)}/${Number(d)}`;
  return y === thisYear ? short : `${y}/${short}`;
}

export function formatWeekday(iso: string): string {
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  // 補上 T00:00:00Z 讓它以 UTC 解析，避免本機時區把日期推移一天
  return names[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const currency = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

/** 金額。台幣實務上沒有小數，有的話才顯示出來 */
export function formatAmount(value: number): string {
  return currency.format(value);
}

export function formatSigned(value: number, kind: 'expense' | 'income' | 'advance'): string {
  // 「−0」很怪。0 元的紀錄是「這天有記、但沒花錢」（開伙、回家吃、別人請客），
  // 那不是一筆負的錢，就是 0
  if (value === 0) return '0';
  const sign = kind === 'income' ? '+' : '−';
  return `${sign}${formatAmount(Math.abs(value))}`;
}

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  hour12: false,
});

/** 台北時間的小時（0–23）。伺服器跑 UTC，直接 getHours() 會差八小時 */
export function taipeiHour(): number {
  return Number(hourFormatter.format(new Date()));
}

/** 打招呼。純粹是為了讓首頁有點人味，不是功能 */
export function greeting(): string {
  const hour = taipeiHour();
  if (hour < 5) return '還沒睡啊';
  if (hour < 11) return '早安';
  if (hour < 14) return '午安';
  if (hour < 18) return '下午好';
  return '晚安';
}
