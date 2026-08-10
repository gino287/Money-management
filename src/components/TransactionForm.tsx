'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ActionState } from '@/app/actions/transactions';
import type { Category, TransactionKind } from '@/db/schema';

const KINDS: { value: TransactionKind; label: string; hint: string }[] = [
  { value: 'expense', label: '支出', hint: '' },
  { value: 'income', label: '收入', hint: '' },
  { value: 'advance', label: '暫付款', hint: '先墊的錢，不算進這個月的支出' },
];

export type TransactionFormValues = {
  id?: string;
  date: string;
  amount: number;
  categoryId: string;
  kind: TransactionKind;
  note: string | null;
  isFixed: boolean;
  isCommunal: boolean;
  isEstimated: boolean;
};

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  categories: Category[];
  /** 今天與前兩天的日期字串，由伺服器算好傳進來，避免用戶端時區算錯 */
  quickDates: { iso: string; label: string }[];
  initial?: TransactionFormValues;
  submitLabel?: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[var(--radius)] bg-accent py-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? '儲存中…' : label}
    </button>
  );
}

export function TransactionForm({
  action,
  categories,
  quickDates,
  initial,
  submitLabel = '記一筆',
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? 'expense');
  const [date, setDate] = useState(initial?.date ?? quickDates[0].iso);
  const [pickedCategoryId, setPickedCategoryId] = useState(initial?.categoryId ?? '');
  const [isCommunal, setIsCommunal] = useState(initial?.isCommunal ?? false);
  const [justSaved, setJustSaved] = useState(false);

  const visible = useMemo(() => {
    const wanted = kind === 'income' ? 'income' : 'expense';
    return categories.filter(
      // 已停用的分類不再出現在選項裡，但如果正在編輯的舊紀錄用的就是它，還是要看得到
      (c) => c.kind === wanted && (c.isActive || c.id === initial?.categoryId),
    );
  }, [categories, kind, initial?.categoryId]);

  // 切支出／收入後原本選的分類可能已經不在清單裡。用推導的而不是拿 effect 去改 state
  const categoryId = visible.some((c) => c.id === pickedCategoryId) ? pickedCategoryId : '';
  const selected = visible.find((c) => c.id === categoryId);

  /**
   * 新增成功後清掉金額、備註與標記，但日期與分類留著 ——
   * Gino 偏好週更，一次補好幾筆同一天同分類的情況很常見。
   * 日期與分類是受控狀態，form.reset() 動不到它們，正好。
   *
   * 收尾寫在 action 裡而不是 effect 裡：這段是「送出成功之後要做的事」，
   * 本來就屬於事件流程，不是拿來同步外部狀態的。
   */
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setIsCommunal(false);
      setJustSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2200);
    }
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="categoryId" value={categoryId} />

      {/* 交易性質 */}
      <div className="flex gap-1 rounded-[var(--radius)] bg-surface p-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`flex-1 rounded-[calc(var(--radius)-0.25rem)] py-2 text-sm transition-colors ${
              kind === k.value ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {KINDS.find((k) => k.value === kind)?.hint && (
        <p className="-mt-2 text-xs text-text-faint">{KINDS.find((k) => k.value === kind)!.hint}</p>
      )}

      {/* 金額 */}
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint">
          NT$
        </span>
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={isCommunal}
          defaultValue={initial && !initial.isCommunal ? String(initial.amount) : ''}
          placeholder={isCommunal ? '0（開伙不計金額）' : '0'}
          className="tabular w-full rounded-[var(--radius)] border border-border bg-surface py-4 pr-4 pl-14 text-2xl outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40"
        />
      </div>

      {/* 分類 */}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPickedCategoryId(c.id)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              categoryId === c.id
                ? 'border-accent bg-accent-dim text-accent'
                : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text'
            } ${c.isActive ? '' : 'opacity-60'}`}
          >
            {c.name}
            {c.isFixed && <span className="ml-1 text-[0.65rem] opacity-70">固定</span>}
          </button>
        ))}
      </div>

      {/* 日期 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {quickDates.map((d) => (
          <button
            key={d.iso}
            type="button"
            onClick={() => setDate(d.iso)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              date === d.iso
                ? 'border-border-strong bg-surface-2 text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            {d.label}
          </button>
        ))}
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-muted outline-none focus:border-border-strong"
        />
      </div>

      <input
        name="note"
        type="text"
        autoComplete="off"
        defaultValue={initial?.note ?? ''}
        placeholder="備註（可留空）"
        className="w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
      />

      {/* 特殊標記 */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Flag
          name="isEstimated"
          label="估算金額"
          title="還不確定的數字，之後拿到實際金額再回來改"
          defaultChecked={initial?.isEstimated}
        />
        {kind === 'expense' && (
          <>
            <Flag
              name="isCommunal"
              label="開伙"
              title="不算實際花費，金額記 0 但保留紀錄"
              checked={isCommunal}
              onChange={setIsCommunal}
            />
            <Flag
              name="isFixed"
              label="固定支出"
              title="房租、壇費這類，月結算時跟變動支出分開看"
              // 沒選分類時跟著分類預設走，選了就顯示該分類的設定
              key={`fixed-${selected?.id ?? 'none'}`}
              defaultChecked={initial ? initial.isFixed : (selected?.isFixed ?? false)}
            />
          </>
        )}
      </div>

      <Submit label={submitLabel} />

      {state.error && (
        <p className="text-center text-sm text-expense" role="alert">
          {state.error}
        </p>
      )}
      {justSaved && !state.error && (
        <p className="text-center text-sm text-accent" role="status">
          記好了
        </p>
      )}
    </form>
  );
}

function Flag({
  name,
  label,
  title,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  title: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-text-muted" title={title}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}
