/**
 * 切換頁面時立刻顯示的骨架。
 *
 * 每一頁都要查資料庫才能算出畫面，沒有這個的話點下去會整整愣一下才跳，
 * 感覺像沒反應。有了它，點擊當下就換頁、先出版面，資料到了再補上。
 * 形狀要跟首頁對得上，不然資料到位的瞬間版面會跳一下 ——
 * 首頁的手動表單現在預設是收起來的，這裡也就只留輸入框那一條。
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="載入中">
      {/* 招呼那一段 */}
      <div className="flex items-start justify-between pt-3">
        <div className="space-y-2.5">
          <div className="h-7 w-36 rounded bg-surface" />
          <div className="h-4 w-28 rounded bg-surface" />
        </div>
        <div className="mt-1.5 h-3 w-16 rounded bg-surface" />
      </div>

      {/* 記一筆那張卡：一行標題 + 一個輸入框，跟收起來的狀態一樣高 */}
      <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-surface/40 p-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-14 rounded bg-surface" />
          <div className="h-3 w-10 rounded bg-surface" />
        </div>
        <div className="h-12 rounded-[var(--radius)] bg-surface" />
      </div>

      {/* 月結算卡片：數字 + 跟上個月比 + 七天小圖 */}
      <div className="h-72 rounded-[var(--radius-lg)] bg-surface" />

      <div className="space-y-2">
        <div className="h-4 w-16 rounded bg-surface" />
        <div className="h-28 rounded-[var(--radius)] bg-surface" />
      </div>
    </div>
  );
}
