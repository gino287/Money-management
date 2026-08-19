/**
 * 月結算頁自己的骨架。形狀跟這一頁對得上，不要沿用首頁那份 ——
 * 骨架跟真的版面差太多的話，資料到位的瞬間會整頁跳動，比沒有骨架還糟。
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="載入中">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-full bg-surface" />
        <div className="h-4 w-24 rounded bg-surface" />
        <div className="size-9 rounded-full bg-surface" />
      </div>

      <div className="h-44 rounded-[var(--radius-lg)] bg-surface" />

      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-[var(--radius)] bg-surface" />
        ))}
      </div>

      <div className="space-y-3">
        <div className="h-4 w-16 rounded bg-surface" />
        <div className="h-48 rounded-[var(--radius-lg)] bg-surface" />
      </div>

      <div className="space-y-3">
        <div className="h-4 w-16 rounded bg-surface" />
        <div className="h-64 rounded-[var(--radius-lg)] bg-surface" />
      </div>
    </div>
  );
}
