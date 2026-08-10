'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { settlements, SETTLEMENT_DIRECTIONS, type SettlementDirection } from '@/db/schema';

import type { ActionState } from './transactions';

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

  await db.insert(settlements).values({
    title,
    direction,
    expectedAmount,
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
