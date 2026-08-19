'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath, revalidateTag } from 'next/cache';

import { db } from '@/db';
import { categories, CATEGORY_KINDS, type CategoryKind } from '@/db/schema';
import { CATEGORIES_TAG } from '@/lib/queries';

import type { ActionState } from './transactions';

function revalidateAll() {
  /*
   * 分類清單是跨請求快取的（見 lib/queries.ts），動過就要立刻失效，
   * 不然新增或停用之後畫面上還是舊的。
   *
   * expire: 0 是文件裡「立刻過期」的寫法。Next 16 建議 Server Action 用
   * updateTag，但那支只認得 'use cache' 打的標籤，我們用的是 unstable_cache，
   * 對得上的是 revalidateTag。單參數的 revalidateTag(tag) 在這版已經是棄用寫法。
   */
  revalidateTag(CATEGORIES_TAG, { expire: 0 });
  revalidatePath('/');
  revalidatePath('/categories');
  revalidatePath('/transactions');
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: '請填分類名稱' };
  if (name.length > 20) return { error: '名稱太長了' };

  const kind = String(formData.get('kind') ?? '') as CategoryKind;
  if (!CATEGORY_KINDS.includes(kind)) return { error: '請選支出或收入' };

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)`.mapWith(Number) })
    .from(categories);

  const inserted = await db
    .insert(categories)
    .values({
      name,
      kind,
      isFixed: formData.get('isFixed') === 'on' && kind === 'expense',
      sortOrder: max + 1,
    })
    .onConflictDoNothing({ target: [categories.name, categories.kind] })
    .returning();

  if (inserted.length === 0) return { error: '這個分類已經存在了' };

  revalidateAll();
  return { ok: true };
}

export async function renameCategory(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id || !name) return;

  await db.update(categories).set({ name }).where(eq(categories.id, id));
  revalidateAll();
}

/**
 * 停用而非刪除：舊交易還指著這個分類，刪掉會讓歷史資料失去意義。
 * 停用後新增表單就不會再出現它，但既有紀錄照常顯示。
 */
export async function toggleCategoryActive(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db
    .update(categories)
    .set({ isActive: sql`not ${categories.isActive}` })
    .where(eq(categories.id, id));
  revalidateAll();
}

export async function toggleCategoryFixed(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // 只改分類的預設值，不動已經記好的交易 —— 那些當初的固定／變動判斷是有意義的
  await db
    .update(categories)
    .set({ isFixed: sql`not ${categories.isFixed}` })
    .where(eq(categories.id, id));
  revalidateAll();
}
