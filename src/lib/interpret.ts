import type { Category, TransactionKind } from '@/db/schema';
import { TRANSACTION_KINDS } from '@/db/schema';

import { buildPrompt, callDeepSeek, categoryChoices, DeepSeekError } from './deepseek';
import { daysAgoISO, todayISO } from './format';
import { getCategories } from './queries';

/**
 * 一句白話 → 一筆帳的欄位。
 *
 * 刻意不碰資料庫，也不管原句要存去哪 —— 網頁（src/app/actions/parse.ts）
 * 跟 LINE（src/app/api/line/route.ts）兩邊都要用，但一邊是填表單、
 * 一邊是直接寫入再讓人回「改成 200」，收尾方式不同。
 */

export type ParsedTransaction = {
  date: string;
  amount: number;
  categoryId: string;
  kind: TransactionKind;
  note: string | null;
  isFixed: boolean;
  isCommunal: boolean;
  isEstimated: boolean;
};

export type Interpretation = {
  /** null 代表這句話看不出是在記帳，或模型回了不能用的東西 */
  values: ParsedTransaction | null;
  /** 挑中的分類，回覆訊息要用它的名字 */
  category: Category | null;
  /** 模型原始輸出，原封不動存進 raw_inputs 供之後檢討 prompt */
  parsed: unknown;
  model: string | null;
  /** 真的壞掉（沒金鑰、逾時、回垃圾）時的繁中說法；看不懂不算壞掉 */
  failure: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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
 * 把模型吐的東西收斂成能寫進資料庫的值。
 *
 * 每一條都是「模型講什麼都不算數」——它可以回簡體字、回不存在的分類、
 * 回明年的日期、回負數。規格書 2.2 的紅線（開伙 0 元、暫付款走支出側分類）
 * 也在這裡再檢查一次，不能只靠 prompt 寫得好。
 */
function coerce(
  output: ModelOutput,
  choices: ReturnType<typeof categoryChoices>,
  today: string,
): { values: ParsedTransaction; category: Category } | null {
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
    // 不是開伙卻沒有金額，就是這句話裡根本沒有錢，別亂記一筆 0 元
    if (amount === 0) return null;
  }

  const wantedKind = kind === 'income' ? 'income' : 'expense';
  const picked = choices.find(
    (c) => c.index === Number(output.categoryIndex) && c.category.kind === wantedKind,
  );
  const category = picked?.category ?? pickFallback(choices, wantedKind);
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
    category,
    values: {
      date,
      amount,
      categoryId: category.id,
      kind,
      note: note || null,
      // isFixed 跟著分類走，不讓模型決定
      isFixed: category.isFixed && kind === 'expense',
      isCommunal,
      isEstimated: output.isEstimated === true,
    },
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
 * userId 是必要的，不是為了記在哪裡（這支不碰資料庫），而是因為
 * **每個人的分類清單不一樣** —— 拿 Gino 的分類去解讀媽媽講的話，
 * 挑出來的分類編號寫進她的帳裡就是一筆指向別人分類的爛資料。
 */
export async function interpret(userId: string, sentence: string): Promise<Interpretation> {
  const today = todayISO();
  const choices = categoryChoices(await getCategories(userId, { activeOnly: true }));

  let content: string | undefined;
  let model: string | null = null;
  let failure: string | null = null;

  try {
    const reply = await callDeepSeek(sentence, buildPrompt(choices, today));
    content = reply.content;
    model = reply.model;
  } catch (error) {
    failure =
      error instanceof DeepSeekError && error.message.includes('DEEPSEEK_API_KEY')
        ? '口語輸入還沒設定好'
        : 'AI 沒回應，這句幫你留著了';
  }

  let parsed: unknown = null;
  if (content) {
    try {
      parsed = JSON.parse(content);
    } catch {
      failure = 'AI 回了看不懂的東西';
    }
  }

  const result = parsed ? coerce(parsed as ModelOutput, choices, today) : null;

  return {
    values: result?.values ?? null,
    category: result?.category ?? null,
    parsed,
    model,
    failure,
  };
}
