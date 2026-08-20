'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import {
  settlements,
  transactions,
  SETTLEMENT_DIRECTIONS,
  type SettlementDirection,
} from '@/db/schema';
import { getCategory, getSettlements } from '@/lib/queries';
import { todayISO } from '@/lib/format';

import type { ActionState } from './transactions';

const DUE_MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateAll() {
  revalidatePath('/');
  revalidatePath('/settlements');
}

export async function createSettlement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { error: '請填一個看得懂的名稱，例如「押金待回收」' };

  const direction = String(formData.get('direction') ?? '') as SettlementDirection;
  if (!SETTLEMENT_DIRECTIONS.includes(direction)) return { error: '請選這筆錢會回來還是要付出去' };

  const raw = String(formData.get('expectedAmount') ?? '').trim();
  let expectedAmount: number | null = null;
  if (raw !== '') {
    const parsed = Number(raw);
    // 金額可以先空著 —— 押金待回收這種常常一開始就不知道確切數字
    if (!Number.isFinite(parsed) || parsed < 0) return { error: '預計金額不對' };
    expectedAmount = Math.round(parsed * 100) / 100;
  }

  const due = String(formData.get('dueMonth') ?? '').trim();
  if (due !== '' && !DUE_MONTH.test(due)) return { error: '預計時間格式不對' };

  await db.insert(settlements).values({
    title,
    direction,
    expectedAmount,
    dueMonth: due || null,
    note: String(formData.get('note') ?? '').trim() || null,
  });

  revalidateAll();
  return { ok: true };
}

/**
 * 結清一律手動確認，系統不自動改帳（Gino 2026-08-10 確認）。
 * 這裡只翻狀態，該記的收入或轉正支出由 Gino 自己另外記一筆。
 */
export async function settleSettlement(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db
    .update(settlements)
    .set({ status: 'settled', settledAt: new Date() })
    .where(eq(settlements.id, id));
  revalidateAll();
}

/** 按錯了要能還原，否則會逼人去資料庫改 */
export async function reopenSettlement(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db
    .update(settlements)
    .set({ status: 'open', settledAt: null })
    .where(eq(settlements.id, id));
  revalidateAll();
}

export async function deleteSettlement(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db.delete(settlements).where(eq(settlements.id, id));
  revalidateAll();
}

/**
 * 改「大概什麼時候會回來」。
 *
 * 押金那種可以拖一年多，一開始也不見得知道確切月份，所以要能事後補、事後改。
 * 空字串＝清掉，那筆就會回到首頁常駐提醒 —— 不知道什麼時候會回來的錢最容易忘記。
 */
export async function setSettlementDue(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const due = String(formData.get('dueMonth') ?? '').trim();
  if (due !== '' && !DUE_MONTH.test(due)) return;

  await db
    .update(settlements)
    .set({ dueMonth: due || null })
    .where(eq(settlements.id, id));
  revalidateAll();
}

/**
 * 收回一筆（或還掉一筆）。
 *
 * 重點在於**它寫的是一筆真的帳**，不是在待結清那張表上改數字。
 * 朋友昨天還 500、今天再還 500，就是兩筆真的收入，各自綁回同一個待結清項目；
 * 「已收 1,000」是加總出來的。這樣待結清頁跟明細頁永遠對得起來，
 * 不會出現「這裡說收回了，可是帳上沒有那筆錢」。
 *
 * 收滿了也不自動結清 —— 結清一律手動確認（Gino 2026-08-10 確認）。
 * 頁面上會提示「收齊了」，按不按是他的事。
 */
export async function recordSettlementReturn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const all = await getSettlements();
  const item = all.find((s) => s.id === id);
  if (!item) return { error: '找不到這個待結清項目' };

  const amount = Number(String(formData.get('amount') ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return { error: '請填收回的金額' };
  if (amount > 9_999_999_999) return { error: '金額太大了' };

  const date = String(formData.get('date') ?? '') || todayISO();
  if (!ISO_DATE.test(date)) return { error: '日期格式不對' };

  const categoryId = String(formData.get('categoryId') ?? '');
  const category = await getCategory(categoryId);
  if (!category) return { error: '請選一個分類' };

  /*
   * 錢會回來的（押金、代墊）收回時是收入；
   * 錢要付出去的（媽媽借款）還掉時是支出。分類的種類要跟著對，
   * 否則月結算會把一筆還款算成收入。
   */
  const kind = item.direction === 'receivable' ? 'income' : 'expense';
  if (category.kind !== (kind === 'income' ? 'income' : 'expense')) {
    return { error: '分類跟這筆錢的方向對不上' };
  }

  await db.insert(transactions).values({
    date,
    amount: Math.round(amount * 100) / 100,
    categoryId,
    kind,
    note: String(formData.get('note') ?? '').trim() || item.title,
    settlementId: item.id,
  });

  revalidateAll();
  revalidatePath('/transactions');
  return { ok: true };
}
