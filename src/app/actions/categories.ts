'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath, revalidateTag } from 'next/cache';

import { db } from '@/db';
import { categories, CATEGORY_KINDS, type CategoryKind } from '@/db/schema';
import { categoriesTag } from '@/lib/queries';
import { requireUser } from '@/lib/session';

import type { ActionState } from './transactions';

function revalidateAll(userId: string) {
  /*
   * 分類清單是跨請求快取的（見 lib/queries.ts），動過就要立刻失效，
   * 不然新增或停用之後畫面上還是舊的。
   *
   * 標籤帶著 userId：媽媽改她的分類不該把 Gino 的快取一起沖掉。
   *
   * expire: 0 是文件裡「立刻過期」的寫法。Next 16 建議 Server Action 用
   * updateTag，但那支只認得 'use cache' 打的標籤，我們用的是 unstable_cache，
   * 對得上的是 revalidateTag。單參數的 revalidateTag(tag) 在這版已經是棄用寫法。
   */
  revalidateTag(categoriesTag(userId), { expire: 0 });
  revalidatePath('/');
  revalidatePath('/categories');
  revalidatePath('/transactions');
}

/**
 * 「這個分類是不是你的」。改名、停用、切換固定支出都要先過這一關 ——
 * 分類編號是 uuid，猜不到，但「猜不到」不是權限控制。
 */
const ownedBy = (userId: string, id: string) =>
  and(eq(categories.id, id), eq(categories.userId, userId));

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: '請填分類名稱' };
  if (name.length > 20) return { error: '名稱太長了' };

  const kind = String(formData.get('kind') ?? '') as CategoryKind;
  if (!CATEGORY_KINDS.includes(kind)) return { error: '請選支出或收入' };

  const user = await requireUser();

  // 排序只跟自己的分類比，不然新增的那個會被排到別人的數字後面去
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)`.mapWith(Number) })
    .from(categories)
    .where(eq(categories.userId, user.id));

  const inserted = await db
    .insert(categories)
    .values({
      userId: user.id,
      name,
      kind,
      isFixed: formData.get('isFixed') === 'on' && kind === 'expense',
      sortOrder: max + 1,
    })
    // 同名只是「你自己底下不能重複」。媽媽也有一個「餐食」是完全正常的
    .onConflictDoNothing({ target: [categories.userId, categories.name, categories.kind] })
    .returning();

  if (inserted.length === 0) return { error: '這個分類已經存在了' };

  revalidateAll(user.id);
  return { ok: true };
}

export async function renameCategory(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id || !name) return;

  const user = await requireUser();

  await db.update(categories).set({ name }).where(ownedBy(user.id, id));
  revalidateAll(user.id);
}

/**
 * 停用而非刪除：舊交易還指著這個分類，刪掉會讓歷史資料失去意義。
 * 停用後新增表單就不會再出現它，但既有紀錄照常顯示。
 */
export async function toggleCategoryActive(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const user = await requireUser();

  await db
    .update(categories)
    .set({ isActive: sql`not ${categories.isActive}` })
    .where(ownedBy(user.id, id));
  revalidateAll(user.id);
}

export async function toggleCategoryFixed(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const user = await requireUser();

  // 只改分類的預設值，不動已經記好的交易 —— 那些當初的固定／變動判斷是有意義的
  await db
    .update(categories)
    .set({ isFixed: sql`not ${categories.isFixed}` })
    .where(ownedBy(user.id, id));
  revalidateAll(user.id);
}
