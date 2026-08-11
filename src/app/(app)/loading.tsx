/**
 * 切換頁面時立刻顯示的骨架。
 *
 * 每一頁都要查資料庫才能算出畫面，沒有這個的話點下去會整整愣一下才跳，
 * 感覺像沒反應。有了它，點擊當下就換頁、先出版面，資料到了再補上。
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="載入中">
      <div className="h-11 rounded-[var(--radius)] bg-surface" />
      <div className="h-14 rounded-[var(--radius)] bg-surface" />

      <div className="flex flex-wrap gap-1.5">
        {[3, 4, 3.5, 5, 3, 4.5].map((w, i) => (
          <div key={i} className="h-8 rounded-full bg-surface" style={{ width: `${w}rem` }} />
        ))}
      </div>

      <div className="h-40 rounded-[var(--radius)] bg-surface" />

      <div className="space-y-2">
        <div className="h-4 w-16 rounded bg-surface" />
        <div className="h-32 rounded-[var(--radius)] bg-surface" />
      </div>
    </div>
  );
}
