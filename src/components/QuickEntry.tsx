'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ParseState } from '@/app/actions/parse';
import type { ActionState } from '@/app/actions/transactions';
import type { Category } from '@/db/schema';

import { TransactionForm } from './TransactionForm';

type Props = {
  categories: Category[];
  quickDates: { iso: string; label: string }[];
  parseAction: (state: ParseState, formData: FormData) => Promise<ParseState>;
  createAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** 從網址 ?say= 帶進來的句子，先填好等使用者按送出 */
  initialSentence?: string;
};

function Send() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-[calc(var(--radius)-0.25rem)] bg-surface-2 px-4 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-50"
    >
      {pending ? '想一下…' : '送出'}
    </button>
  );
}

/**
 * 「用講的記一筆」。
 *
 * 記帳頁是 server component，但這裡需要把「解析結果」交給下面的表單，
 * 所以用一個客戶端外殼把兩件事串起來。解析完不直接寫入 ——
 * 一律填進表單等 Gino 看過再按（規格書 3：金額聽錯很致命）。
 */
export function QuickEntry({
  categories,
  quickDates,
  parseAction,
  createAction,
  initialSentence,
}: Props) {
  const [state, formAction] = useActionState<ParseState, FormData>(parseAction, {});
  // 已經按下「記一筆」的那一句，用來把上面的回顧收掉。
  // 記成 id 而不是布林值，這樣下一句進來時自動失效，不必用 effect 去清
  const [savedId, setSavedId] = useState<string | null>(null);

  /**
   * 表單的 key 只在「解析成功、有東西要塞進去」時才換。
   *
   * 一開始寫成 key={state.rawInputId}，結果解析失敗或看不懂時 key 也會變，
   * 表單跟著重新掛載，使用者已經手動填到一半的金額就被清掉了 ——
   * 講一句話沒成功，反而把手動打的東西弄丟，是最不能接受的那種壞法。
   */
  const [formKey, setFormKey] = useState('blank');
  const [injectedId, setInjectedId] = useState<string | null>(null);
  if (state.values && state.rawInputId && state.rawInputId !== injectedId) {
    setInjectedId(state.rawInputId);
    setFormKey(state.rawInputId);
  }

  const showReview = Boolean(state.values) && state.rawInputId !== savedId;

  const create = async (prev: ActionState, formData: FormData) => {
    if (state.rawInputId) formData.set('rawInputId', state.rawInputId);
    const result = await createAction(prev, formData);
    if (result.ok && state.rawInputId) setSavedId(state.rawInputId);
    return result;
  };

  return (
    <div className="space-y-3.5">
      <form action={formAction} className="flex gap-1 rounded-[var(--radius)] bg-surface-2 p-1">
        <input
          name="text"
          type="text"
          autoComplete="off"
          maxLength={200}
          defaultValue={initialSentence}
          placeholder="用講的：剛剛午餐 150"
          className="min-w-0 flex-1 rounded-[calc(var(--radius)-0.25rem)] bg-bg px-3 py-2.5 text-sm outline-none placeholder:text-text-faint"
        />
        <Send />
      </form>

      {state.error && (
        <p className="px-1 text-xs text-text-faint" role="alert">
          {state.error}
        </p>
      )}
      {state.warning && (
        <p className="px-1 text-xs text-text-faint" role="status">
          {state.warning}
        </p>
      )}
      {showReview && (
        <p className="px-1 text-xs text-text-faint" role="status">
          聽成這樣：「{state.sentence}」 — 不對就直接改下面
        </p>
      )}

      {/*
        key 是必要的：TransactionForm 只在 useState 的初值讀 initial，
        不換 key 的話第二句話解析出來的值不會進到表單裡。
      */}
      <TransactionForm
        key={formKey}
        action={create}
        categories={categories}
        quickDates={quickDates}
        initial={showReview ? state.values : undefined}
      />
    </div>
  );
}
