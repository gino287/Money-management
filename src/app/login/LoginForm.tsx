/**
 * 純表單 POST，沒有任何用戶端狀態。
 * 送出後由 /api/login 設 cookie 並 303 導頁，交給瀏覽器原生處理。
 */
export function LoginForm({
  next,
  name,
  error,
}: {
  next: string;
  name: string;
  error: boolean;
}) {
  const field =
    'w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-center outline-none transition-colors placeholder:text-text-faint focus:border-border-strong';

  return (
    <form method="post" action="/api/login" className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {/*
        autoComplete="username" 是關鍵：手機瀏覽器認得它，第一次登入之後
        就會自己填好名字。一家人各記各的帳，但每個人其實只在自己的手機上登入，
        真正需要打字的只有第一次。
      */}
      <input
        name="name"
        type="text"
        defaultValue={name}
        autoFocus={!name}
        autoComplete="username"
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="名字"
        className={field}
      />
      <input
        name="password"
        type="password"
        autoFocus={!!name}
        autoComplete="current-password"
        placeholder="密碼"
        className={field}
      />
      <button
        type="submit"
        className="w-full rounded-[var(--radius)] bg-accent px-4 py-3 text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        進入
      </button>
      {error && (
        <p className="pt-1 text-center text-sm text-expense" role="alert">
          {/* 不講是名字錯還是密碼錯 —— 講了等於幫人確認哪些名字存在 */}
          名字或密碼不對
        </p>
      )}
    </form>
  );
}
