/**
 * 登入用的密碼學。**這支刻意不碰資料庫**。
 *
 * src/proxy.ts 會 import 它，而 proxy 可能跑在 edge runtime ——
 * 一旦這裡 import 了 @/db，postgres 整包就會被拉進 edge 的打包結果裡，
 * 輕則打包失敗，重則每一次請求都多背一份用不到的東西。
 * 需要「這個 cookie 是誰」請用 src/lib/session.ts，那支才准碰資料庫。
 *
 * 同理，用 Web Crypto 而不是 node:crypto。
 */

export const SESSION_COOKIE = 'ledger_session';

const SESSION_DAYS = 90;
const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('缺少 AUTH_SECRET，無法簽發登入憑證');
  return secret;
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/** 不因為第幾個字元不同而提早回傳，避免用回應時間反推簽章 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------------------------------------------------------- 密碼 */

/**
 * PBKDF2-SHA256。次數取 OWASP 對 SHA-256 的建議值。
 *
 * 為什麼不是直接比對環境變數裡的明文（多人之前的做法）：現在密碼存在資料庫，
 * 而資料庫的內容會出現在備份、匯出、以及任何一次不小心的截圖裡。
 * 雜湊過的東西外流頂多是「要花時間慢慢猜」，明文外流就是直接被登入。
 *
 * 每個人各自一組隨機 salt，所以兩個人用同一個密碼也看不出來。
 */
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return toHex(bits);
}

/** 產生可以直接存進 users.password_hash 的字串 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  // 把參數一起存進去，之後想調高次數時舊密碼還驗得動
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationText, saltHex, expected] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !expected) return false;

  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = new Uint8Array((saltHex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  return timingSafeEqual(await derive(password, salt, iterations), expected);
}

/* -------------------------------------------------------------- session */

/**
 * 登入憑證＝`使用者編號.到期時間.簽章`。
 *
 * 是誰放在 cookie 裡而不是另外查一張 session 表，這樣 proxy 不用碰資料庫 ——
 * 每一次請求都為了確認身分多跑一趟資料庫，以這個系統的連線數是撐不住的
 * （見 src/db/index.ts 那串教訓）。
 *
 * 代價是**沒辦法單獨把某一個人踢下線**：憑證是自己會過期的，不是查表查出來的。
 * 真的需要立刻讓所有人重新登入時，換掉 AUTH_SECRET 就是全部失效。
 */
export async function createSessionToken(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000}`;
  return `${payload}.${await sign(payload)}`;
}

/** 回傳這張憑證屬於誰；不合法、過期、被動過手腳都回 null */
export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  // 多人之前的憑證只有「到期時間.簽章」兩段，對不上就是 null，
  // 結果是舊的登入狀態失效一次、重新登入一次。不特別相容，那是一次性的成本
  const [userId, expiresText, signature] = token.split('.');
  if (!userId || !expiresText || !signature) return null;

  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  try {
    const payload = `${userId}.${expiresText}`;
    return timingSafeEqual(await sign(payload), signature) ? userId : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
} as const;
