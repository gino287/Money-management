'use server';

import { db } from '@/db';
import { rawInputs, TRANSACTION_KINDS, type Category, type TransactionKind } from '@/db/schema';
import type { TransactionFormValues } from '@/components/TransactionForm';
import { buildPrompt, callDeepSeek, categoryChoices, DeepSeekError } from '@/lib/deepseek';
import { daysAgoISO, todayISO } from '@/lib/format';
import { getCategories } from '@/lib/queries';

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SENTENCE = 200;
const MAX_NOTE = 100;

type ModelOutput = {
  kind?: unknown;
  isCommunal?: unknown;
  amount?: unknown;
  categoryIndex?: unknown;
  date?: unknown;
  note?: unknown;
  isEstimated?: unknown;
  confidence?: unknown;
};

/**
 * 把模型吐的東西收斂成表單能用的值。
 *
 * 這裡的每一條都是「模型講什麼都不算數」——它可以回簡體字、回不存在的分類、
 * 回明年的日期、回負數。規格書 2.2 的紅線（開伙 0 元、暫付款走支出側分類）
 * 也在這裡再檢查一次，不能只靠 prompt 寫得好。
 */
function coerce(
  output: ModelOutput,
  choices: ReturnType<typeof categoryChoices>,
  today: string,
): TransactionFormValues | null {
  const confidence = Number(output.confidence);
  if (Number.isFinite(confidence) && confidence <= 0) return null;

  const kind: TransactionKind = TRANSACTION_KINDS.includes(output.kind as TransactionKind)
    ? (output.kind as TransactionKind)
    : 'expense';

  // 開伙只可能發生在支出上
  const isCommunal = output.isCommunal === true && kind === 'expense';

  let amount = 0;
  if (!isCommunal) {
    amount = Number(output.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999) return null;
    amount = Math.round(amount * 100) / 100;
    // 不是開伙卻沒有金額，就是這句話裡根本沒有錢，別亂填一筆 0 元
    if (amount === 0) return null;
  }

  const wantedKind = kind === 'income' ? 'income' : 'expense';
  const picked = choices.find(
    (c) => c.index === Number(output.categoryIndex) && c.category.kind === wantedKind,
  );
  const fallback = pickFallback(choices, wantedKind);
  const category = picked?.category ?? fallback;
  if (!category) return null;

  const rawDate = String(output.date ?? '');
  // 一年以外的日期一律當它看錯了。ISO 字串可以直接比大小
  const date =
    ISO_DATE.test(rawDate) && rawDate >= daysAgoISO(365) && rawDate <= daysAgoISO(-365)
      ? rawDate
      : today;

  const note = String(output.note ?? '')
    .trim()
    .slice(0, MAX_NOTE);

  return {
    date,
    amount,
    categoryId: category.id,
    kind,
    note: note || null,
    // isFixed 不讓模型決定，留給既有的寫入流程繼承分類預設
    isFixed: category.isFixed && kind === 'expense',
    isCommunal,
    isEstimated: output.isEstimated === true,
  };
}

function pickFallback(
  choices: ReturnType<typeof categoryChoices>,
  kind: Category['kind'],
): Category | undefined {
  const sameKind = choices.filter((c) => c.category.kind === kind).map((c) => c.category);
  return sameKind.find((c) => c.name === '未分類') ?? sameKind[0];
}

/**
 * 一句話 → 填好的表單。刻意不直接寫進資料庫：
 * 實測過「買菜大概三百多吧」會被解讀成開伙 0 元，金額整個消失，
 * 規格書 3 就是為了這種情況要求一定要有確認步驟。
 */
export async function parseSentence(_prev: ParseState, formData: FormData): Promise<ParseState> {
  const sentence = String(formData.get('text') ?? '').trim();
  if (!sentence) return { error: '先打一句話吧' };
  if (sentence.length > MAX_SENTENCE) return { error: `一次講短一點，${MAX_SENTENCE} 字以內` };

  const today = todayISO();
  const choices = categoryChoices(await getCategories({ activeOnly: true }));

  let content: string | undefined;
  let model: string | undefined;
  let failure: string | undefined;
  try {
    const reply = await callDeepSeek(sentence, buildPrompt(choices, today));
    content = reply.content;
    model = reply.model;
  } catch (error) {
    failure =
      error instanceof DeepSeekError && error.message.includes('DEEPSEEK_API_KEY')
        ? '口語輸入還沒設定好，先用下面的表單記'
        : 'AI 沒回應，這句幫你留著了，先自己填';
  }

  let output: ModelOutput | null = null;
  if (content) {
    try {
      output = JSON.parse(content) as ModelOutput;
    } catch {
      failure = 'AI 回了看不懂的東西，先自己填';
    }
  }

  const values = output ? coerce(output, choices, today) : null;

  // 不管成功失敗、採用與否，原句都要留著（規格書 3）——之後才有東西可以檢討 prompt
  const [saved] = await db
    .insert(rawInputs)
    .values({
      text: sentence,
      source: 'web_agent',
      parsed: output ?? null,
      model: model ?? null,
      accepted: false,
    })
    .returning({ id: rawInputs.id });

  if (failure) return { error: failure, sentence, rawInputId: saved?.id };
  if (!values) {
    return {
      warning: '這句看不太出來是在記什麼，下面自己填一下',
      sentence,
      rawInputId: saved?.id,
    };
  }

  return { ok: true, values, sentence, rawInputId: saved?.id };
}
