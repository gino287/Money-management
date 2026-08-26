import {
  amendAmount,
  keepUnusedSentence,
  recordFromLine,
  removeTransaction,
} from '@/app/actions/line';
import { formatAmount, formatDate, formatSigned } from '@/lib/format';
import { interpret } from '@/lib/interpret';
import type { User } from '@/db/schema';
import { replyText, textEventsOf, verifyLineSignature, type LineTextEvent } from '@/lib/line';
import { getLastLineTransaction, getUserByLineId } from '@/lib/queries';

/**
 * LINE webhook。在 LINE 上傳一句話就記一筆帳。
 *
 * 跟網頁的口語輸入不一樣：這裡**先寫進去**，回覆訊息告訴你記了什麼，
 * 不對再回「改成 200」或「刪掉」。聊天視窗裡塞一個確認步驟太礙事，
 * 而回一句話就能改，等於把確認往後移（實作計畫 P3）。
 *
 * **一支官方帳號就能服務全家人，不用一個人開一支 bot**（2026-08-26 Gino 問的）。
 * LINE 的每一則 webhook 本來就帶著發話者的 userId，拿它去 users 表反查是誰，
 * 記到那個人自己的帳本裡。沒綁定的人講什麼都不會被記進任何人的帳。
 *
 * 這支端點是公開的（LINE 得打得到），所以三道門缺一不可：
 * 1. 簽章對不上就 401 —— 沒有 channel secret 的人偽造不出來
 * 2. 只認綁定過的 LINE 帳號，沒綁的一律不記帳（只告訴他自己的代號，方便去綁）
 * 3. 不管中間出什麼事都回 200 —— 回 500 的話 LINE 會重送，重送就變成記兩筆
 */
export const dynamic = 'force-dynamic';

const MAX_SENTENCE = 200;

/** 「改成 200」「改 200」「金額改成 200」 */
const AMEND = /^(?:金額)?改(?:成)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元|塊)?$/;
const REMOVE = /^(刪掉|刪除|取消|不算)$/;
const HELP = /^(說明|help|\?|？|怎麼用)$/i;

const HELP_TEXT = [
  '直接講一句話就記帳，例如：',
  '　剛剛跟朋友吃午餐 150',
  '　昨天幫室友墊房租 8000',
  '　今天在家開伙',
  '',
  '記完之後可以回：',
  '　改成 200 —— 改掉剛剛那筆的金額',
  '　刪掉 —— 把剛剛那筆刪掉',
].join('\n');

function describe(row: { date: string; amount: number; kind: string; isCommunal: boolean }): string {
  return row.isCommunal
    ? '開伙（不記金額）'
    : formatSigned(row.amount, row.kind as 'expense' | 'income' | 'advance');
}

const KIND_LABEL: Record<string, string> = {
  expense: '',
  income: '收入',
  advance: '暫付款',
};

async function handle(user: User, event: LineTextEvent): Promise<string> {
  const sentence = (event.message?.text ?? '').trim();
  if (!sentence) return '';
  if (sentence.length > MAX_SENTENCE) return `一次講短一點，${MAX_SENTENCE} 字以內`;

  if (HELP.test(sentence)) return HELP_TEXT;

  const amend = sentence.match(AMEND);
  if (amend) {
    const amount = Number(amend[1]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999) return '這個金額怪怪的';

    // 「剛剛那筆」永遠是講這句話的人自己的最後一筆，不會是別人的
    const last = await getLastLineTransaction(user.id);
    if (!last) return '最近沒有在 LINE 記過帳，沒有東西可以改。要改舊的帳請到網頁上改。';
    if (last.isCommunal) return '開伙本來就不記金額，不用改。要改成有花錢的話，回「刪掉」再重講一次。';

    await amendAmount(user.id, last.id, Math.round(amount * 100) / 100);
    return `改好了 · ${last.categoryName} ${formatSigned(amount, last.kind)}\n原本是 ${formatAmount(last.amount)}`;
  }

  if (REMOVE.test(sentence)) {
    const last = await getLastLineTransaction(user.id);
    if (!last) return '最近沒有在 LINE 記過帳，沒有東西可以刪。要刪舊的帳請到網頁上刪。';
    await removeTransaction(user.id, last.id);
    return `刪掉了 · ${last.categoryName} ${describe(last)}`;
  }

  // 用這個人自己的分類清單解讀，不是別人的（見 lib/interpret.ts）
  const { values, category, parsed, model, failure } = await interpret(user.id, sentence);

  if (failure) {
    await keepUnusedSentence({ userId: user.id, sentence, parsed, model });
    return `${failure}，這句先幫你留著了。要記的話到網頁上手動填一下。`;
  }

  if (!values || !category) {
    await keepUnusedSentence({ userId: user.id, sentence, parsed, model });
    return '這句看不太出來是在記什麼。講清楚一點，或回「說明」看範例。';
  }

  await recordFromLine({ userId: user.id, sentence, values, parsed, model });

  const label = KIND_LABEL[values.kind];
  const lines = [
    `記好了 · ${label ? `${label} ` : ''}${category.name} ${describe(values)}`,
    `${formatDate(values.date)}${values.note ? ` ${values.note}` : ''}${values.isEstimated ? '（估算）' : ''}`,
    '不對的話回「改成 200」或「刪掉」',
  ];
  return lines.join('\n');
}

export async function POST(request: Request) {
  // 一定要拿原始字串來驗簽，JSON.parse 再 stringify 回去的內容對不上
  const body = await request.text();

  if (!(await verifyLineSignature(body, request.headers.get('x-line-signature')))) {
    return new Response('簽章不對', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response('OK');
  }

  for (const event of textEventsOf(payload)) {
    const lineUserId = event.source?.userId;
    if (!lineUserId || !event.replyToken) continue;

    try {
      const user = await getUserByLineId(lineUserId);

      /*
       * 沒綁定的人：不記帳，但把他自己的 LINE 代號告訴他。
       *
       * 這串代號是綁定的唯一憑據，而**除了問這支 bot 之外拿不到** ——
       * 沒有這一段回覆的話，要幫媽媽開通就得叫她想辦法自己去查一個
       * 她根本不知道存在的東西。告訴一個人他自己的代號沒有任何風險，
       * 那串字對別人一點用都沒有（要送訊息還是得有 channel access token）。
       */
      if (!user) {
        await replyText(
          event.replyToken,
          [
            '你還沒有開通記帳功能。',
            '',
            '把下面這一串傳給 Gino，他幫你開通之後就可以用了：',
            lineUserId,
          ].join('\n'),
        );
        continue;
      }

      const reply = await handle(user, event);
      if (reply) await replyText(event.replyToken, reply);
    } catch (error) {
      console.error('[line] 處理訊息時出錯：', (error as Error).message);
      await replyText(event.replyToken, '系統出了點狀況，這句沒記進去。等一下再試一次。');
    }
  }

  // 不管上面發生什麼都回 200：回錯誤碼 LINE 會重送，重送就是記兩筆
  return new Response('OK');
}
