'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createSettlement } from '@/app/actions/settlements';
import type { ActionState } from '@/app/actions/transactions';
import type { SettlementDirection } from '@/db/schema';

const DIRECTIONS: { value: SettlementDirection; label: string }[] = [
  { value: 'receivable', label: '錢會回來' },
  { value: 'payable', label: '錢要付出去' },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[var(--radius)] border border-border-strong py-2.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? '新增中…' : '新增待結清'}
    </button>
  );
}

export function SettlementForm() {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<SettlementDirection>('receivable');
  const formRef = useRef<HTMLFormElement>(null);

  // 新增成功就收合表單。屬於送出流程的收尾，不需要繞一圈 effect
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createSettlement(prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
    return result;
  }, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius)] border border-dashed border-border py-3 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text"
      >
        ＋ 新增待結清項目
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-[var(--radius)] border border-border bg-surface p-4"
    >
      <input type="hidden" name="direction" value={direction} />

      <input
        name="title"
        autoFocus
        placeholder="例如：押金待回收、媽媽借款待追蹤"
        className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2.5 outline-none focus:border-border-strong"
      />

      <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-1">
        {DIRECTIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => setDirection(d.value)}
            className={`flex-1 rounded-[calc(var(--radius)-0.25rem)] py-1.5 text-sm transition-colors ${
              direction === d.value ? 'bg-surface-2 text-text' : 'text-text-muted'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <input
        name="expectedAmount"
        inputMode="decimal"
        placeholder="預計金額（不確定可以留空）"
        className="tabular w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2.5 outline-none focus:border-border-strong"
      />

      {/*
        大概什麼時候會回來。填了的話，時間還沒到就不會在首頁吵人 ——
        押金要等到明年退租，天天提醒只會讓人想把它按掉。
      */}
      <label className="block">
        <span className="mb-1 block px-1 text-xs text-text-faint">
          大概什麼時候會回來（不知道就留空，留空會一直在首頁提醒）
        </span>
        <input
          type="month"
          name="dueMonth"
          className="tabular w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2.5 outline-none focus:border-border-strong"
        />
      </label>

      <input
        name="note"
        placeholder="備註（可留空）"
        className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2.5 outline-none focus:border-border-strong"
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius)] border border-border px-4 py-2.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          取消
        </button>
        <div className="flex-1">
          <Submit />
        </div>
      </div>

      {state.error && (
        <p className="text-center text-sm text-expense" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
