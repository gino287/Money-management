'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createCategory } from '@/app/actions/categories';
import type { ActionState } from '@/app/actions/transactions';
import type { CategoryKind } from '@/db/schema';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-[var(--radius)] border border-border-strong px-4 py-2.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? '…' : '新增'}
    </button>
  );
}

export function CategoryForm() {
  const [kind, setKind] = useState<CategoryKind>('expense');
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createCategory(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="kind" value={kind} />

      <div className="flex gap-2">
        <div className="flex shrink-0 gap-1 rounded-[var(--radius)] bg-surface p-1">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-[calc(var(--radius)-0.25rem)] px-3 py-1.5 text-sm transition-colors ${
                kind === k ? 'bg-surface-2 text-text' : 'text-text-muted'
              }`}
            >
              {k === 'expense' ? '支出' : '收入'}
            </button>
          ))}
        </div>
        <input
          name="name"
          placeholder="新分類名稱"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2.5 outline-none focus:border-border-strong"
        />
        <Submit />
      </div>

      {kind === 'expense' && (
        <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-text-muted">
          <input type="checkbox" name="isFixed" className="size-3.5 accent-[var(--accent)]" />
          這是固定支出（房租、壇費這類）
        </label>
      )}

      {state.error && (
        <p className="px-1 text-sm text-expense" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
