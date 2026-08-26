'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import {
  rawInputs,
  transactionRevisions,
  transactions,
  TRANSACTION_KINDS,
  type Transaction,
  type TransactionKind,
} from '@/db/schema';
import { getCategory } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export type ActionState = { error?: string; ok?: boolean };

type ParsedInput = {
  date: string;
  amount: number;
  categoryId: string;
  kind: TransactionKind;
  note: string | null;
  isFixed: boolean;
  isCommunal: boolean;
  isEstimated: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 表單資料驗證。Server Action 是公開端點，不能相信前端送什麼就存什麼。
 *
 * 多人之後這句話又多了一層意思：送過來的 categoryId 不只要「存在」，
 * 還要是**這個人自己的**分類。getCategory 只從這個人的清單裡找，
 * 所以填別人的分類編號進來，結果就是「找不到這個分類」。
 */
async function parse(userId: string, formData: FormData): Promise<ParsedInput | string> {
  const date = String(formData.get('date') ?? '');
  if (!ISO_DATE.test(date)) return '日期格式不對';

  const kind = String(formData.get('kind') ?? '') as TransactionKind;
  if (!TRANSACTION_KINDS.includes(kind)) return '交易性質不對';

  const categoryId = String(formData.get('categoryId') ?? '');
  if (!categoryId) return '請選一個分類';

  const category = await getCategory(userId, categoryId);
  if (!category) return '找不到這個分類';

  const expectedKind = kind === 'income' ? 'income' : 'expense';
  if (category.kind !== expectedKind) return '分類跟交易性質對不上';

  const isCommunal = formData.get('isCommunal') === 'on' && kind === 'expense';

  // 開伙不算實際花費，金額一律 0，但仍要留下紀錄（規格書 2.2）
  let amount = 0;
  if (!isCommunal) {
    const raw = String(formData.get('amount') ?? '').trim();
    amount = Number(raw);
    if (raw === '' || !Number.isFinite(amount)) return '請填金額';
    if (amount < 0) return '金額不能是負數，用上面的性質切換收入或支出';
    if (amount > 9_999_999_999) return '金額太大了';
    amount = Math.round(amount * 100) / 100;
  }

  const note = String(formData.get('note') ?? '').trim() || null;

  // isFixed 預設跟著分類走，表單有勾才覆寫
  const fixedField = formData.get('isFixed');
  const isFixed = kind === 'expense' ? (fixedField === null ? category.isFixed : fixedField === 'on') : false;

  return {
    date,
    amount,
    categoryId,
    kind,
    note,
    isFixed,
    isCommunal,
    isEstimated: formData.get('isEstimated') === 'on',
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 這筆是不是從口語輸入來的。只認 uuid 格式，實際存不存在交給外鍵擋 ——
 * 為了一個來源欄位多查一次資料庫不划算，而且首頁的連線數本來就緊（見 src/db/index.ts）。
 * 只在 createTransaction 用：事後編輯不該把原本的來源改掉。
 */
function rawInputIdOf(formData: FormData): string | null {
  const value = String(formData.get('rawInputId') ?? '');
  return UUID.test(value) ? value : null;
}

/** 稽核只留會影響帳目的欄位，時間戳與來源不進去，否則每筆 diff 都被雜訊淹沒 */
function snapshot(row: Transaction) {
  return {
    date: row.date,
    amount: row.amount,
    categoryId: row.categoryId,
    kind: row.kind,
    note: row.note,
    isFixed: row.isFixed,
    isCommunal: row.isCommunal,
    isEstimated: row.isEstimated,
  };
}

function revalidateAll() {
  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/settlements');
}

export async function createTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = await parse(user.id, formData);
  if (typeof parsed === 'string') return { error: parsed };

  const rawInputId = rawInputIdOf(formData);

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      ...parsed,
      userId: user.id,
      source: rawInputId ? 'web_agent' : 'manual',
      rawInputId,
    });
    // 採用了才標記，被退掉的原句留著 accepted=false，之後檢討 prompt 時就是這些有價值
    if (rawInputId) {
      await tx
        .update(rawInputs)
        .set({ accepted: true })
        // 別人的原句不歸你標記。猜中一組 uuid 就能動到別人的資料，再小也是洞
        .where(and(eq(rawInputs.id, rawInputId), eq(rawInputs.userId, user.id)));
    }
  });

  revalidateAll();
  return { ok: true };
}

export async function updateTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: '缺少交易編號' };

  const user = await requireUser();

  const parsed = await parse(user.id, formData);
  if (typeof parsed === 'string') return { error: parsed };

  /**
   * 估算金額拿到實際數字時直接覆蓋（Gino 2026-08-10 確認），
   * 但舊值要留得住，所以改動前後包在同一個 transaction 裡寫稽核。
   *
   * 讀跟寫**都**要帶上「是不是你的」。只在讀的時候檢查是不夠的 ——
   * 那等於相信兩次查詢之間沒有人動過手腳，而且少寫一次條件的代價是
   * 別人可以改你的帳，這種東西不留餘地比較好。
   */
  const owned = and(eq(transactions.id, id), eq(transactions.userId, user.id));

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(transactions).where(owned).limit(1);
    if (!before) throw new Error('找不到這筆交易');

    const [after] = await tx
      .update(transactions)
      .set({ ...parsed, updatedAt: new Date() })
      .where(owned)
      .returning();

    const changed = (Object.keys(parsed) as (keyof ParsedInput)[]).some(
      (key) => before[key] !== after[key],
    );
    if (!changed) return;

    await tx.insert(transactionRevisions).values({
      transactionId: id,
      before: snapshot(before),
      after: snapshot(after),
      reason: String(formData.get('reason') ?? '').trim() || null,
    });
  });

  revalidateAll();
  redirect('/transactions');
}

export async function deleteTransaction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const user = await requireUser();

  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)));
  revalidateAll();
  redirect('/transactions');
}
