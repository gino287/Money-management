'use server';

import { db } from '@/db';
import { rawInputs } from '@/db/schema';
import type { TransactionFormValues } from '@/components/TransactionForm';
import { interpret } from '@/lib/interpret';

import type { ActionState } from './transactions';

export type ParseState = ActionState & {
  /** 直接餵給 TransactionForm 的 initial，沒有就代表這句話沒解析出東西 */
  values?: TransactionFormValues;
  rawInputId?: string;
  /** 原句，讓 Gino 對照「我剛剛講了什麼」 */
  sentence?: string;
  /** 解析不出來時的說法。跟 error 分開：error 是壞掉，warning 是它看不懂 */
  warning?: string;
};

const MAX_SENTENCE = 200;

/**
 * 一句話 → 填好的表單。刻意不直接寫進資料庫：
 * 實測過「買菜大概三百多吧」會被解讀成開伙 0 元，金額整個消失，
 * 規格書 3 就是為了這種情況要求一定要有確認步驟。
 *
 * LINE 那邊走的是另一條路（直接寫入、再讓人回「改成 200」修正），
 * 共用的解析邏輯在 src/lib/interpret.ts。
 */
export async function parseSentence(_prev: ParseState, formData: FormData): Promise<ParseState> {
  const sentence = String(formData.get('text') ?? '').trim();
  if (!sentence) return { error: '先打一句話吧' };
  if (sentence.length > MAX_SENTENCE) return { error: `一次講短一點，${MAX_SENTENCE} 字以內` };

  const { values, parsed, model, failure } = await interpret(sentence);

  // 不管成功失敗、採用與否，原句都要留著（規格書 3）——之後才有東西可以檢討 prompt
  const [saved] = await db
    .insert(rawInputs)
    .values({ text: sentence, source: 'web_agent', parsed, model, accepted: false })
    .returning({ id: rawInputs.id });

  if (failure) return { error: `${failure}，先用下面的表單記`, sentence, rawInputId: saved?.id };
  if (!values) {
    return {
      warning: '這句看不太出來是在記什麼，下面自己填一下',
      sentence,
      rawInputId: saved?.id,
    };
  }

  return { ok: true, values, sentence, rawInputId: saved?.id };
}
