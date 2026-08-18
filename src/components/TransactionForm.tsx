'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ActionState } from '@/app/actions/transactions';
import type { Category, TransactionKind } from '@/db/schema';

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

/**
 * 表單上的「性質」比資料表多一個「開伙」。
 * 存進資料庫時它仍然是 kind='expense' + isCommunal=true（規格書 2.2 不能動），
 * 但在 Gino 腦子裡「今天開伙」跟「今天花錢」是兩件不同的事，
 * 不該是藏在下面的一個勾選格子。
 */
type Mode = 'expense' | 'communal' | 'income' | 'advance';

const MODES: { value: Mode; label: string; hint?: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'communal', label: '開伙' },
  { value: 'income', label: '收入' },
  { value: 'advance', label: '暫付款', hint: '先墊出去的錢，不算進這個月的支出' },
];

const KIND_OF: Record<Mode, TransactionKind> = {
  expense: 'expense',
  communal: 'expense',
  income: 'income',
  advance: 'advance',
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
      className="w-full rounded-[var(--radius)] bg-accent py-3.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
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

  const [mode, setMode] = useState<Mode>(
    initial ? (initial.isCommunal ? 'communal' : (initial.kind as Mode)) : 'expense',
  );
  const [date, setDate] = useState(initial?.date ?? quickDates[0].iso);
  const [pickedCategoryId, setPickedCategoryId] = useState(initial?.categoryId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [isEstimated, setIsEstimated] = useState(initial?.isEstimated ?? false);
  const [justSaved, setJustSaved] = useState(false);

  const kind = KIND_OF[mode];
  const isCommunal = mode === 'communal';

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
   * 固定支出預設跟著分類走（房租、壇費本來就是固定的），
   * 手動改過才以手動的為準，換一個分類就回到那個分類的預設。
   * 用「這次覆寫是針對哪個分類」記著，就不必拿 effect 去追分類的變化。
   */
  const [fixedOverride, setFixedOverride] = useState<{ categoryId: string; value: boolean } | null>(
    initial ? { categoryId: initial.categoryId, value: initial.isFixed } : null,
  );
  const isFixed =
    kind === 'expense'
      ? fixedOverride && fixedOverride.categoryId === categoryId
        ? fixedOverride.value
        : (selected?.isFixed ?? false)
      : false;

  const markCount = (note.trim() ? 1 : 0) + (isEstimated ? 1 : 0) + (isFixed ? 1 : 0);

  // 進來就有備註或標記的（＝在改舊紀錄），收合區直接是打開的，不然會以為資料不見了
  const [detailsOpen] = useState(
    () => Boolean(initial && (initial.note || initial.isEstimated || initial.isFixed)),
  );

  /**
   * 新增成功後清掉金額、備註與標記，但性質、日期與分類留著 ——
   * Gino 偏好週更，一次補好幾筆同一天同分類的情況很常見。
   *
   * 收尾寫在 action 裡而不是 effect 裡：這段是「送出成功之後要做的事」，
   * 本來就屬於事件流程，不是拿來同步外部狀態的。
   */
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setNote('');
      setIsEstimated(false);
      setFixedOverride(null);
      setJustSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2200);
    }
    return result;
  }, {});

  const hint = MODES.find((m) => m.value === mode)?.hint;

  return (
    <form ref={formRef} action={formAction} className="space-y-3.5">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="categoryId" value={categoryId} />
      {isCommunal && <input type="hidden" name="isCommunal" value="on" />}
      {kind === 'expense' && <input type="hidden" name="isFixed" value={isFixed ? 'on' : 'off'} />}

      {/* 1. 這是哪一種帳 */}
      <div className="grid grid-cols-4 gap-1 rounded-[var(--radius)] bg-surface-2 p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={`rounded-[calc(var(--radius)-0.25rem)] py-2 text-sm transition-colors ${
              mode === m.value ? 'bg-bg text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* 2. 多少錢 */}
      {isCommunal ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-5 text-center">
          <p className="tabular text-2xl text-text-muted">0</p>
          <p className="mt-1 text-xs text-text-faint">開伙不記金額，只留下「這一餐在家吃」</p>
        </div>
      ) : (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint">
            NT$
          </span>
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={initial && !initial.isCommunal ? String(initial.amount) : ''}
            placeholder="0"
            className="tabular w-full rounded-[var(--radius)] border border-border bg-surface py-4 pr-4 pl-14 text-2xl outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
          />
        </div>
      )}
      {hint && <p className="px-1 text-xs text-text-faint">{hint}</p>}

      {/* 3. 哪一類 */}
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

      {/* 4. 哪一天 */}
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
          className="tabular rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-muted outline-none focus:border-border-strong"
        />
      </div>

      {/* 5. 其餘的收起來，需要才打開 —— 十次記帳有九次用不到 */}
      <details
        open={detailsOpen}
        className="group overflow-hidden rounded-[var(--radius)] border border-border bg-surface"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm text-text-muted">
          <span>
            備註與標記
            {markCount > 0 && <span className="ml-2 text-xs text-accent">已填 {markCount} 項</span>}
          </span>
          <span className="text-xs text-text-faint transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>

        <div className="space-y-3.5 border-t border-border px-4 py-3.5">
          <input
            name="note"
            type="text"
            autoComplete="off"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="備註（可留空）"
            className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2.5 outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
          />

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              name="isEstimated"
              checked={isEstimated}
              onChange={(e) => setIsEstimated(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-text-muted">
              估算金額
              <span className="block text-xs text-text-faint">
                還不確定的數字，之後拿到實際金額再回來改
              </span>
            </span>
          </label>

          {kind === 'expense' && !isCommunal && (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={isFixed}
                onChange={(e) => setFixedOverride({ categoryId, value: e.target.checked })}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span className="text-sm text-text-muted">
                固定支出
                <span className="block text-xs text-text-faint">
                  房租、壇費這類，月結算時跟變動支出分開看
                </span>
              </span>
            </label>
          )}
        </div>
      </details>

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
