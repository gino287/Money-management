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
 * 首頁的「記一筆」。
 *
 * 一開始只有一個輸入框 —— 講一句話就好，其餘的（支出／收入、分類、日期、
 * 備註）全部收在下面，按「自己填」才展開。Gino 2026-08-21 的要求：
 * 點進首頁第一眼要乾淨，不要一整面按鈕迎面撲過來。
 *
 * 三件事要特別小心：
 *
 * 1. 表單是「一直掛著、只是收起來」，不是收起來時就不渲染。
 *    不然打到一半的金額會在收合的瞬間消失。收起來時加 inert，
 *    鍵盤 Tab 才不會跑進看不見的東西裡。
 * 2. 解析成功會自動展開 —— AI 猜的東西一定要讓人看到才算數（規格書 3）。
 * 3. 存檔之後不自動收合。「記好了」那行字在表單裡面，收掉就等於沒給回饋。
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
  const [open, setOpen] = useState(false);

  /**
   * 表單的 key 只在「解析成功、有東西要塞進去」時才換。
   *
   * 一開始寫成 key={state.rawInputId}，結果解析失敗或看不懂時 key 也會變，
   * 表單跟著重新掛載，使用者已經手動填到一半的金額就被清掉了 ——
   * 講一句話沒成功，反而把手動打的東西弄丟，是最不能接受的那種壞法。
   *
   * 展開也綁在這裡，而不是寫成 open = manual || showReview：
   * 那樣的話手動把表單收起來，只要 showReview 還是 true 就會馬上又彈開。
   * 綁在「有新的一句話進來」這個一次性事件上才收得掉。
   */
  const [formKey, setFormKey] = useState('blank');
  const [injectedId, setInjectedId] = useState<string | null>(null);
  if (state.values && state.rawInputId && state.rawInputId !== injectedId) {
    setInjectedId(state.rawInputId);
    setFormKey(state.rawInputId);
    setOpen(true);
  }

  const showReview = Boolean(state.values) && state.rawInputId !== savedId;

  const create = async (prev: ActionState, formData: FormData) => {
    if (state.rawInputId) formData.set('rawInputId', state.rawInputId);
    const result = await createAction(prev, formData);
    if (result.ok && state.rawInputId) setSavedId(state.rawInputId);
    return result;
  };

  return (
    <div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 className="text-sm text-text-muted">記一筆</h2>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="manual-form"
            className="flex items-center gap-1 text-xs text-text-faint transition-colors hover:text-text-muted"
          >
            {open ? '收起來' : '自己填'}
            <span className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
        </div>

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
      </div>

      {/*
        收合用 grid 的 0fr → 1fr，不用 max-height。
        max-height 要先猜一個夠大的數字，展開速度會跟著內容長短忽快忽慢；
        0fr → 1fr 量的是真正的內容高度，純 CSS、不必量任何東西。

        key 是必要的：TransactionForm 只在 useState 的初值讀 initial，
        不換 key 的話第二句話解析出來的值不會進到表單裡。
      */}
      <div
        id="manual-form"
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3.5">
            <TransactionForm
              key={formKey}
              action={create}
              categories={categories}
              quickDates={quickDates}
              initial={showReview ? state.values : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
