/**
 * LINE Messaging API。
 *
 * 規格出處（2026-08-20 查的官方文件，不是憑印象）：
 * - 簽章：HMAC-SHA256(channel secret, 原始 request body)，base64，放在
 *   `x-line-signature` 標頭。文件特別強調驗證前不可以先解析或改動 body。
 *   https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
 * - 回覆：POST https://api.line.me/v2/bot/message/reply  { replyToken, messages }
 * - 主動推播：POST https://api.line.me/v2/bot/message/push  { to, messages }
 *   兩支都要 `Authorization: Bearer {channel access token}`，一次最多 5 則，
 *   文字訊息上限 5000 字。
 *
 * 用 Web Crypto 而不是 node:crypto，跟 src/lib/auth.ts 同一個理由。
 */

/**
 * 平常是 LINE 官方網址。驗收腳本會把它指到本機的假伺服器，
 * 才能檢查「回覆的內容對不對」而不用真的發訊息出去 ——
 * 也讓開發機永遠不會不小心把測試訊息推到你的 LINE 上。
 */
const apiBase = () => process.env.LINE_API_BASE ?? 'https://api.line.me';

const MAX_TEXT = 5000;
const TIMEOUT_MS = 5_000;

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 不因為第幾個字元不同而提早回傳 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 驗證這則 webhook 真的來自 LINE。
 * `body` 必須是還沒被 JSON.parse 過的原始字串，重新序列化過的就對不上了。
 */
export async function verifyLineSignature(body: string, signature: string | null): Promise<boolean> {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return timingSafeEqual(toBase64(digest), signature);
}

async function send(url: string, payload: Record<string, unknown>): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('[line] 沒有 LINE_CHANNEL_ACCESS_TOKEN，訊息沒送出');
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[line] ${url} 回 ${response.status}：${(await response.text()).slice(0, 200)}`);
    }
  } catch (error) {
    // 送不出去不該讓 webhook 回 500 —— LINE 會重送，結果就是重複記帳
    console.warn(`[line] 送訊息失敗：${(error as Error).message}`);
  }
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  await send(`${apiBase()}/v2/bot/message/reply`, {
    replyToken,
    messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }],
  });
}

export async function pushText(to: string, text: string): Promise<void> {
  await send(`${apiBase()}/v2/bot/message/push`, { to, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] });
}

/** LINE webhook 的訊息事件，只取我們用得到的欄位 */
export type LineTextEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
};

export function textEventsOf(body: unknown): LineTextEvent[] {
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  return (events as LineTextEvent[]).filter(
    (e) => e?.type === 'message' && e.message?.type === 'text' && typeof e.message.text === 'string',
  );
}
