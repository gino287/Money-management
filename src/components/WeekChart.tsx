import { formatAmount, formatWeekday } from '@/lib/format';
import type { DayTotals } from '@/lib/queries';

/**
 * 最近七天每天花多少。
 *
 * 首頁放這張而不是半年趨勢圖：半年的圖看得出走勢，但看不出「昨天花很兇」，
 * 而首頁要回答的是「我最近怎麼樣」。半年那張在月結算頁還在，點一下就到。
 *
 * 跟 TrendChart 一樣用 div 不用 SVG —— 幾個矩形而已，flex + 百分比高度
 * 天生響應式，也不需要任何 JavaScript。
 *
 * 三種狀態要分得出來，這是這張圖唯一有難度的地方：
 * - 有花錢 → 一根柱子
 * - 有記帳但沒花錢（開伙）→ 一條矮矮的綠線，代表「這天有顧到」
 * - 什麼都沒記 → 一條灰色細線
 * 少了中間那種，開伙的日子會跟忘記記帳的日子長得一模一樣。
 */
export function WeekChart({ data }: { data: DayTotals[] }) {
  const max = Math.max(...data.map((d) => d.expense), 1);
  const todayISO = data[data.length - 1]?.date;

  return (
    <div className="flex items-end gap-1.5">
      {data.map((day) => {
        const isToday = day.date === todayISO;
        const height = (day.expense / max) * 100;

        return (
          <div
            key={day.date}
            className="flex flex-1 flex-col justify-end"
            title={`${day.date} 支出 ${formatAmount(day.expense)}`}
          >
            <div className="flex h-14 w-full flex-col justify-end">
              {day.expense > 0 ? (
                <div
                  className={`w-full rounded-t-md ${isToday ? 'bg-accent' : 'bg-expense/60'}`}
                  // 再小的金額也要看得見，不然一根 0.3% 的柱子等於沒畫
                  style={{ height: `${Math.max(height, 6)}%` }}
                />
              ) : day.count > 0 ? (
                <div className="h-0.5 w-full rounded-full bg-accent/50" />
              ) : (
                <div className="h-px w-full rounded-full bg-border-strong" />
              )}
            </div>
            <span
              className={`mt-2 block text-center text-[0.7rem] ${
                isToday ? 'text-accent' : 'text-text-faint'
              }`}
            >
              {formatWeekday(day.date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
