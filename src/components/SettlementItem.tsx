'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  deleteSettlement,
  recordSettlementReturn,
  setSettlementDue,
  settleSettlement,
} from '@/app/actions/settlements';
import type { ActionState } from '@/app/actions/transactions';
import type { Category } from '@/db/schema';
import { formatAmount, formatMonth, todayISO } from '@/lib/format';
import type { SettlementRow } from '@/lib/queries';

const DIRECTION_LABEL = { receivable: '會回來', payable: '要付出去' } as const;

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[var(--radius)] border border-accent/40 py-2 text-sm text-accent transition-colors hover:bg-accent-dim disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * 一筆未結清的項目。
 *
 * 這裡有兩個刻意的設計：
 *
 * 1. **收回是記一筆真的帳**，不是在這張卡片上改數字。按「記一筆收回」會開一個
 *    小表單，送出後產生一筆真的收入（或還款支出）並綁回這個項目。
 *    所以「已收 1,000」永遠跟明細對得起來。
 * 2. **收齊了也不自動結清**，只是把按鈕的字換成「收齊了，標記結清」。
 *    結清一律手動確認（Gino 2026-08-10 確認），系統不替人做結論。
 */
export function SettlementItem({
  item,
  categories,
}: {
  item: SettlementRow;
  categories: Category[];
}) {
  const [returning, setReturning] = useState(false);
  const [editingDue, setEditingDue] = useState(false);

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await recordSettlementReturn(prev, formData);
    if (result.ok) setReturning(false);
    return result;
  }, {});

  const wantedKind = item.direction === 'receivable' ? 'income' : 'expense';
  const choices = categories.filter((c) => c.kind === wantedKind && c.isActive);
  // 代墊收回幾乎都是這一類，預設選好可以少點一下
  const preferred =
    choices.find((c) => c.name.includes('還錢') || c.name.includes('代墊')) ?? choices[0];

  const expected = item.expectedAmount;
  const remaining = expected === null ? null : Math.max(expected - item.received, 0);
  const done = remaining !== null && remaining === 0 && item.received > 0;
  const percent = expected && expected > 0 ? Math.min((item.received / expected) * 100, 100) : 0;

  return (
    <li className="rounded-[var(--radius-lg)] border border-estimated/25 bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{item.title}</p>
          <p className="mt-0.5 text-xs text-text-faint">
            {DIRECTION_LABEL[item.direction]}
            {' · '}
            {item.dueMonth ? `預計 ${formatMonth(item.dueMonth)}` : '沒寫預計時間'}
            <button
              type="button"
              onClick={() => setEditingDue((v) => !v)}
              className="ml-2 text-text-faint underline decoration-dotted transition-colors hover:text-text-muted"
            >
              {editingDue ? '取消' : '改時間'}
            </button>
          </p>
        </div>
        <span className="tabular shrink-0 text-sm text-estimated">
          {expected === null ? '未定' : formatAmount(expected)}
        </span>
      </div>

      {editingDue && (
        <form action={setSettlementDue} className="mt-2.5 flex gap-2">
          <input type="hidden" name="id" value={item.id} />
          <input
            type="month"
            name="dueMonth"
            defaultValue={item.dueMonth ?? ''}
            className="tabular flex-1 rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-border-strong"
          />
          <button
            type="submit"
            className="rounded-[var(--radius)] border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            存
          </button>
        </form>
      )}

      {/* 分次收回的進度。一次收完的（押金）不會走到這裡，維持乾淨 */}
      {item.received > 0 && (
        <div className="mt-3">
          {expected !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-income/70" style={{ width: `${percent}%` }} />
            </div>
          )}
          <p className="tabular mt-2 text-xs text-text-muted">
            已收 <span className="text-income">{formatAmount(item.received)}</span>
            {expected !== null && (
              <>
                ／共 {formatAmount(expected)}
                {remaining !== null && remaining > 0 && (
                  <span className="text-text-faint">　·　還剩 {formatAmount(remaining)}</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {item.note && <p className="mt-2 text-xs text-text-muted">{item.note}</p>}

      {returning ? (
        <form action={formAction} className="mt-3 space-y-2 rounded-[var(--radius)] bg-bg p-3">
          <input type="hidden" name="id" value={item.id} />
          <div className="flex gap-2">
            <input
              name="amount"
              inputMode="decimal"
              autoFocus
              defaultValue={remaining && remaining > 0 ? String(remaining) : ''}
              placeholder="收到多少"
              className="tabular flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
            <input
              type="date"
              name="date"
              defaultValue={todayISO()}
              className="tabular rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
          </div>

          <select
            name="categoryId"
            defaultValue={preferred?.id}
            className="w-full rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReturning(false)}
              className="rounded-[var(--radius)] border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:text-text"
            >
              取消
            </button>
            <div className="flex-1">
              <Submit
                label={item.direction === 'receivable' ? '記下這筆收回' : '記下這筆還款'}
                pendingLabel="記錄中…"
              />
            </div>
          </div>

          <p className="text-xs text-text-faint">
            會在明細裡產生一筆真的{item.direction === 'receivable' ? '收入' : '支出'}，並且綁在這個項目上。
          </p>

          {state.error && (
            <p className="text-center text-sm text-expense" role="alert">
              {state.error}
            </p>
          )}
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setReturning(true)}
            className="flex-1 rounded-[var(--radius)] border border-border-strong py-2 text-sm transition-colors hover:bg-surface-2"
          >
            {item.direction === 'receivable' ? '記一筆收回' : '記一筆還款'}
          </button>

          <form action={settleSettlement} className="flex-1">
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              className={`w-full rounded-[var(--radius)] border py-2 text-sm transition-colors ${
                done
                  ? 'border-income/50 text-income hover:bg-income/10'
                  : 'border-accent/40 text-accent hover:bg-accent-dim'
              }`}
            >
              {done ? '收齊了，標記結清' : '標記結清'}
            </button>
          </form>

          <form action={deleteSettlement}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              className="rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-text-faint transition-colors hover:text-expense"
            >
              刪除
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
