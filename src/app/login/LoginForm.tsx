/**
 * 純表單 POST，沒有任何用戶端狀態。
 * 送出後由 /api/login 設 cookie 並 303 導頁，交給瀏覽器原生處理。
 */
export function LoginForm({ next, error }: { next: string; error: boolean }) {
  return (
    <form method="post" action="/api/login" className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="密碼"
        className="w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-center outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
      />
      <button
        type="submit"
        className="w-full rounded-[var(--radius)] bg-accent px-4 py-3 text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        進入
      </button>
      {error && (
        <p className="pt-1 text-center text-sm text-expense" role="alert">
          密碼不對
        </p>
      )}
    </form>
  );
}
