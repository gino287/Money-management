/**
 * LINE 記帳的寫入。
 *
 * 放在 actions/ 是照 AGENTS.md 的分工（讀取在 lib/queries.ts、寫入在 actions/），
 * 但**刻意不加 'use server'** —— 這裡只被 webhook（src/app/api/line/route.ts）呼叫，
 * 加了反而會多開幾個誰都打得到的公開端點。
 *
 * 這裡的 userId 一律由呼叫端傳進來，不像網頁那邊可以 requireUser()：
 * LINE 的伺服器身上沒有我們的 cookie，是誰要靠 webhook 帶的 source.userId
 * 反查（見 src/app/api/line/route.ts）。
 */
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { rawInputs, transactionRevisions, transactions, type Transaction } from '@/db/schema';
import type { ParsedTransaction } from '@/lib/interpret';

function revalidateAll() {
  revalidatePath('/');
  revalidatePath('/transactions');
}

/** 稽核只留會影響帳目的欄位，跟 transactions.ts 的 snapshot same shape */
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

/**
 * 把 LINE 上講的一句話記成一筆帳。原句與模型輸出一起存進 raw_inputs。
 *
 * 跟網頁不同，這裡是先寫入再讓人回「改成 200」修正 —— 聊天視窗裡跳一個
 * 確認步驟很煩，而且回一句話就能改，等於確認步驟往後移（實作計畫 P3）。
 */
export async function recordFromLine(input: {
  userId: string;
  sentence: string;
  values: ParsedTransaction;
  parsed: unknown;
  model: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [raw] = await tx
      .insert(rawInputs)
      .values({
        userId: input.userId,
        text: input.sentence,
        source: 'line',
        parsed: input.parsed,
        model: input.model,
        // LINE 是直接寫入，所以送出當下就算採用
        accepted: true,
      })
      .returning({ id: rawInputs.id });

    await tx
      .insert(transactions)
      .values({ ...input.values, userId: input.userId, source: 'line', rawInputId: raw.id });
  });

  revalidateAll();
}

/** 存下一句沒有記成帳的話（看不懂、或只是閒聊），之後檢討 prompt 用 */
export async function keepUnusedSentence(input: {
  userId: string;
  sentence: string;
  parsed: unknown;
  model: string | null;
}): Promise<void> {
  await db.insert(rawInputs).values({
    userId: input.userId,
    text: input.sentence,
    source: 'line',
    parsed: input.parsed,
    model: input.model,
    accepted: false,
  });
}

/** 改金額。舊值進稽核表（規格書 2.2：估算改實際是直接覆蓋 + 留紀錄） */
export async function amendAmount(userId: string, id: string, amount: number): Promise<void> {
  const owned = and(eq(transactions.id, id), eq(transactions.userId, userId));

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(transactions).where(owned).limit(1);
    if (!before) return;

    const [after] = await tx
      .update(transactions)
      // 回報了實際金額，就不再是估算的了
      .set({ amount, isEstimated: false, updatedAt: new Date() })
      .where(owned)
      .returning();

    await tx.insert(transactionRevisions).values({
      transactionId: id,
      before: snapshot(before),
      after: snapshot(after),
      reason: '在 LINE 上回報實際金額',
    });
  });

  revalidateAll();
}

export async function removeTransaction(userId: string, id: string): Promise<void> {
  await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  revalidateAll();
}
