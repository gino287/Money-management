'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { login, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[var(--radius)] bg-accent px-4 py-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? '驗證中…' : '進入'}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="密碼"
        className="w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-center outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
      />
      <SubmitButton />
      {state.error && (
        <p className="pt-1 text-center text-sm text-expense" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
