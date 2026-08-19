import type { Category } from '@/db/schema';

/**
 * DeepSeek 客戶端。只負責「把一句話送出去、把字串拿回來」，
 * 解析與驗證留給 src/app/actions/parse.ts —— AI 的輸出跟前端送來的表單一樣不可信。
 *
 * 2026-08-20 對著 API 實測過的三件事，改動前先看一眼：
 *
 * 1. 可用的 model 只有 deepseek-v4-flash 與 deepseek-v4-pro（GET /models 問到的），
 *    沒有 deepseek-chat。不要憑印象改這個字串，改之前先打一次 /models。
 * 2. v4 是推理模型，預設會先吐一大段 reasoning_content，而那段是算在 max_tokens 裡的。
 *    max_tokens 開 200 的時候 187 個被推理吃掉，正文 JSON 直接被截斷。
 * 3. reasoning_effort: 'none' 是關鍵。記帳這種抽取任務不需要推理，
 *    開著要 3～13 秒，關掉是 0.8～1.5 秒，答案完全一樣。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

/** 手機上等超過這個時間就沒意義了，寧可回「自己填吧」 */
const TIMEOUT_MS = 10_000;

export class DeepSeekError extends Error {}

/** 給模型挑的分類清單。用編號而不是名稱 —— 模型偶爾會回簡體字（「工读薪水」），對不回來 */
export type CategoryChoice = { index: number; category: Category };

export function categoryChoices(categories: Category[]): CategoryChoice[] {
  // 「未分類」排在最前面當 0，模型挑不到時的預設就是它
  const sorted = [...categories].sort((a, b) => {
    const aFallback = a.name === '未分類' ? 0 : 1;
    const bFallback = b.name === '未分類' ? 0 : 1;
    return aFallback - bFallback;
  });
  return sorted.map((category, index) => ({ index, category }));
}

export function buildPrompt(choices: CategoryChoice[], today: string): string {
  const list = choices
    .map(({ index, category }) => `${index}=${category.name}${category.kind === 'income' ? '(收入)' : ''}`)
    .join(' ');

  return [
    `你是記帳助手。今天是 ${today}（台北時間）。只輸出 JSON，不要任何解釋。`,
    '格式：{"kind":"expense"|"income"|"advance","isCommunal":boolean,"amount":number,"categoryIndex":number,"date":"YYYY-MM-DD","note":string,"isEstimated":boolean,"confidence":number}',
    '規則：',
    `1. categoryIndex 只能從這份清單挑編號，挑不到就填 0。清單：${list}`,
    '2. isCommunal=true 只用在「在家煮飯／開伙」而且句子裡沒有講到金額的時候，此時 amount=0。句子裡只要出現金額，isCommunal 一律 false。買菜、採買食材是有花錢的支出，不是開伙。',
    '3. 幫別人先墊、之後會拿回來的錢，kind="advance"。',
    '4. 金額是約略的（大概、左右、上下、多）isEstimated=true，否則 false。',
    '5. date 用句子裡講的日期；沒講就用今天。「昨天」「前天」要自己換算成實際日期。',
    '6. note 用繁體中文寫一句簡短說明，不要重複金額。',
    '7. 完全看不出是在記帳，confidence 給 0，其他欄位隨便填。',
  ].join('\n');
}

export type DeepSeekReply = { content: string; model: string };

/**
 * 送出一句話。失敗一律丟 DeepSeekError，呼叫端要負責「就算失敗，原句也要存下來」。
 */
export async function callDeepSeek(sentence: string, systemPrompt: string): Promise<DeepSeekReply> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new DeepSeekError('沒有設定 DEEPSEEK_API_KEY');

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sentence },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        // 就算關掉推理也留寬一點，被截斷的 JSON 比慢一點糟糕得多
        max_tokens: 400,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = (error as Error).name === 'TimeoutError' ? '太久沒回應' : (error as Error).message;
    throw new DeepSeekError(reason);
  }

  if (!response.ok) {
    throw new DeepSeekError(`DeepSeek 回 ${response.status}`);
  }

  const body = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = body.choices?.[0];
  // reasoning_content 不要讀，那是模型的草稿，正文永遠在 content
  const content = choice?.message?.content?.trim();
  if (!content) throw new DeepSeekError('DeepSeek 沒有回傳內容');
  if (choice?.finish_reason === 'length') throw new DeepSeekError('回答被截斷了');

  return { content, model: body.model ?? MODEL };
}
