/**
 * 切換頁面時立刻顯示的骨架。
 *
 * 每一頁都要查資料庫才能算出畫面，沒有這個的話點下去會整整愣一下才跳，
 * 感覺像沒反應。有了它，點擊當下就換頁、先出版面，資料到了再補上。
 * 形狀要跟首頁對得上，不然資料到位的瞬間版面會跳一下。
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="載入中">
      <div className="flex items-baseline justify-between pt-1">
        <div className="h-6 w-20 rounded bg-surface" />
        <div className="h-3 w-16 rounded bg-surface" />
      </div>

      {/* 記一筆那張卡 */}
      <div className="space-y-3.5 rounded-[var(--radius-lg)] border border-border bg-surface/40 p-4">
        <div className="h-4 w-14 rounded bg-surface" />
        <div className="h-11 rounded-[var(--radius)] bg-surface" />
        <div className="h-11 rounded-[var(--radius)] bg-surface" />
        <div className="h-16 rounded-[var(--radius)] bg-surface" />
        <div className="flex flex-wrap gap-1.5">
          {[3, 3, 3, 4.5, 3, 3, 3].map((w, i) => (
            <div key={i} className="h-8 rounded-full bg-surface" style={{ width: `${w}rem` }} />
          ))}
        </div>
        <div className="flex gap-1.5">
          {[3.5, 3.5, 3.5, 7].map((w, i) => (
            <div key={i} className="h-8 rounded-full bg-surface" style={{ width: `${w}rem` }} />
          ))}
        </div>
        <div className="h-10 rounded-[var(--radius)] bg-surface" />
        <div className="h-12 rounded-[var(--radius)] bg-surface" />
      </div>

      <div className="h-56 rounded-[var(--radius-lg)] bg-surface" />

      <div className="space-y-2">
        <div className="h-4 w-16 rounded bg-surface" />
        <div className="h-28 rounded-[var(--radius)] bg-surface" />
      </div>
    </div>
  );
}
