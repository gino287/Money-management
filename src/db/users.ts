import { config } from 'dotenv';

config({ path: '.env.local' });

import { asc, sql } from 'drizzle-orm';

import { hashPassword } from '../lib/auth';
import { defaultCategoryRows } from './default-categories';
import { db } from './index';
import { categories, users } from './schema';

/**
 * 開帳號、改密碼、綁 LINE。**只能在有資料庫連線的機器上跑**，
 * 也就是只有 Gino 自己能開帳號 —— 網站上沒有註冊頁面。
 *
 * 這是刻意的：家裡兩三個人在用的東西，公開的註冊入口只會多一個
 * 誰都打得到的寫入端點，還要處理驗證信、防洗帳號那一整套。
 *
 *   npm run user -- list
 *   npm run user -- add 媽媽                  ← 幫她開帳號，密碼自動產生並印出來
 *   npm run user -- add 媽媽 --password 自己想的
 *   npm run user -- passwd 媽媽                ← 忘記密碼時重設
 *   npm run user -- line 媽媽 Uxxxxxxxx        ← 綁 LINE（要解除就填 -）
 *   npm run user -- disable 媽媽 / enable 媽媽
 */

/**
 * 自動產生的密碼。去掉了 0/O、1/l/I 這些看起來一樣的字 ——
 * 這組密碼多半會被唸出來或用訊息傳給對方，認錯一個字就是登不進去。
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const GENERATED_LENGTH = 12;

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** 名字比對一律不分大小寫、去掉前後空白，跟登入時的規則一致 */
function findUser(name: string) {
  return db
    .select()
    .from(users)
    .where(sql`lower(${users.name}) = ${name.trim().toLowerCase()}`)
    .limit(1);
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const MIN_PASSWORD = 8;

async function add(name: string) {
  if (!name) throw new Error('要叫什麼名字？例如：npm run user -- add 媽媽');
  if (name.length > 20) throw new Error('名字太長了');

  const [taken] = await findUser(name);
  if (taken) throw new Error(`已經有一個叫「${taken.name}」的了`);

  const supplied = flag('password');
  if (supplied !== undefined && supplied.length < MIN_PASSWORD) {
    throw new Error(`密碼至少 ${MIN_PASSWORD} 個字`);
  }
  const password = supplied ?? generatePassword();
  const line = flag('line')?.trim() || null;

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: name.trim(), passwordHash: await hashPassword(password), lineUserId: line })
      .returning();

    // 一開帳號就要有分類可選，否則第一次記帳會卡在「請選一個分類」卻一個都沒有
    await tx.insert(categories).values(defaultCategoryRows(user.id));
    return user;
  });

  console.log(`開好了：${created.name}`);
  console.log(`  密碼　　${password}`);
  if (supplied === undefined) console.log('  （這組密碼只會出現這一次，現在就傳給她）');
  console.log(`  LINE　　${line ?? '還沒綁'}`);
  console.log(`  分類　　已經帶了 ${defaultCategoryRows(created.id).length} 個預設分類`);
}

async function passwd(name: string) {
  const [user] = await findUser(name);
  if (!user) throw new Error(`找不到叫「${name}」的人`);

  const supplied = flag('password');
  if (supplied !== undefined && supplied.length < MIN_PASSWORD) {
    throw new Error(`密碼至少 ${MIN_PASSWORD} 個字`);
  }
  const password = supplied ?? generatePassword();

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(sql`${users.id} = ${user.id}`);

  console.log(`${user.name} 的新密碼：${password}`);
  /*
   * 改密碼**不會**把已經登入的裝置踢下線 —— 憑證是自己會過期的簽章，
   * 不是查表查出來的（見 src/lib/auth.ts）。真的要讓所有裝置重新登入，
   * 得換掉 AUTH_SECRET，代價是每個人都要重登一次。
   */
  console.log('（她已經登入的手機不會被踢出去，那張憑證要等 90 天才過期）');
}

async function line(name: string, value: string) {
  const [user] = await findUser(name);
  if (!user) throw new Error(`找不到叫「${name}」的人`);
  if (!value) throw new Error('要綁哪一個 LINE userId？解除請填 -');

  const lineUserId = value === '-' ? null : value.trim();
  await db.update(users).set({ lineUserId }).where(sql`${users.id} = ${user.id}`);
  console.log(lineUserId ? `${user.name} 綁定 ${lineUserId}` : `${user.name} 解除 LINE 綁定`);
}

async function setActive(name: string, isActive: boolean) {
  const [user] = await findUser(name);
  if (!user) throw new Error(`找不到叫「${name}」的人`);

  await db.update(users).set({ isActive }).where(sql`${users.id} = ${user.id}`);
  console.log(`${user.name} ${isActive ? '恢復使用' : '已停用（帳還在，只是登不進來）'}`);
}

/**
 * 相關子查詢的表名一律自己寫死，**不要**用 `${transactions.userId}` 那種寫法。
 *
 * drizzle 在 raw sql 樣板裡是把欄位**不加表名前綴**展開的，
 * 所以 `where ${transactions.userId} = ${users.id}` 會變成
 * `where "user_id" = "id"` —— 子查詢裡的 `"id"` 指的是 transactions 自己的 id，
 * 不是外層的 users.id。條件永遠不成立，每個人都被算成 0 筆帳，
 * 而且不會有任何錯誤訊息。2026-08-26 踩到。
 */
async function list() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
      lineUserId: users.lineUserId,
      transactions:
        sql<number>`(select count(*) from transactions t where t.user_id = users.id)`.mapWith(
          Number,
        ),
      open: sql<number>`(select count(*) from settlements s
                         where s.user_id = users.id and s.status = 'open')`.mapWith(Number),
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  if (rows.length === 0) {
    console.log('還沒有任何帳號。先跑 npm run db:multiuser -- --write');
    return;
  }

  for (const r of rows) {
    const marks = [
      r.isActive ? null : '已停用',
      r.lineUserId ? 'LINE 已綁' : null,
    ].filter(Boolean);
    console.log(
      `  ${r.name.padEnd(10)} ${String(r.transactions).padStart(5)} 筆帳　` +
        `${r.open} 筆待結清　${marks.join('、')}`,
    );
  }
}

async function main() {
  const [command, name, extra] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  switch (command) {
    case 'list':
    case undefined:
      await list();
      break;
    case 'add':
      await add(name);
      break;
    case 'passwd':
      await passwd(name);
      break;
    case 'line':
      await line(name, extra);
      break;
    case 'disable':
      await setActive(name, false);
      break;
    case 'enable':
      await setActive(name, true);
      break;
    default:
      throw new Error(`不認得的指令「${command}」。可以用：list / add / passwd / line / disable / enable`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
