import { config } from 'dotenv';

config({ path: '.env.local' });

import postgres from 'postgres';

import { hashPassword } from '../lib/auth';

/**
 * 一次性的多人改造遷移。跑法：
 *
 *   npm run db:multiuser          ← 只印出「會做什麼」，不碰資料庫
 *   npm run db:multiuser -- --write
 *
 * 做四件事：
 *   1. 建 users 表
 *   2. 用現有的 APP_PASSWORD 開出第一個帳號（預設叫 Gino），順便綁上 LINE_USER_ID
 *   3. 四張表加 user_id，**現有資料全部歸給那個帳號**
 *   4. 唯一鍵與索引改成以 user_id 開頭
 *
 * 為什麼不用 `drizzle-kit push`：兩個理由。
 *
 * 一、push 面對「加一個 not null 欄位到已經有資料的表」只會叫你自己想辦法，
 * 而這裡的順序是有講究的 —— 一定要先加成可以留空、把三百多筆舊帳補上主人、
 * 確認一筆都沒漏，最後才鎖成 not null。
 *
 * 二、drizzle-kit 在這個資料庫上本來就會崩（《踩過的雷》有記，
 * 它讀不動 Supabase 預設就有的那些 CHECK 約束）。
 *
 * 可以重複跑：每一步都先確認「是不是已經做過了」。
 *
 * ⚠️ 跑完之後，**還沒更新的舊版程式會寫不進去帳**（它的 INSERT 沒有 user_id，
 * 會被 not null 擋下來）。讀取不受影響。所以遷移跟部署新版之間的空檔要短。
 */

const WRITE = process.argv.includes('--write');

const OWNER_NAME = process.env.OWNER_NAME?.trim() || 'Gino';
/** 掛 user_id 的四張表。順序無所謂，但列出來比較好對 */
const TABLES = ['categories', 'transactions', 'settlements', 'raw_inputs'] as const;

function say(done: boolean, text: string) {
  console.log(`  ${done ? '·' : '→'} ${text}${done ? '（已經是這樣了，跳過）' : ''}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('缺少 DATABASE_URL，請確認 .env.local');

  const password = process.env.APP_PASSWORD;
  if (!password) {
    throw new Error(
      '缺少 APP_PASSWORD。這支要拿它當第一個帳號的密碼，' +
        '這樣改造完之後你原本的密碼還是能登入，不用重記一組。',
    );
  }

  const sql = postgres(url, {
    prepare: false,
    fetch_types: false,
    max: 1,
    // 重跑時 `create index if not exists` 會噴一整排 NOTICE，
    // 那正是我們要的行為，不需要印出來嚇人
    onnotice: () => {},
  });

  const exists = async (query: postgres.PendingQuery<postgres.Row[]>) =>
    (await query).length > 0;

  /*
   * 每一個檢查都一定要限定 schema = 'public'。
   *
   * Supabase 自己就有一張 `auth.users`（它的登入系統用的），不限定的話
   * 「users 表存在嗎」永遠回答存在，這支就會跳過建表、然後在下一步
   * 查 public.users 時炸掉 relation "users" does not exist。
   * 2026-08-26 第一次預演就踩到了。
   */
  const hasTable = (name: string) =>
    exists(
      sql`select 1 from information_schema.tables
          where table_schema = 'public' and table_name = ${name}`,
    );
  const hasColumn = (table: string, column: string) =>
    exists(
      sql`select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}`,
    );
  const hasConstraint = (name: string) =>
    exists(
      sql`select 1 from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'public' and c.conname = ${name}`,
    );
  const hasIndex = (name: string) =>
    exists(
      sql`select 1 from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = ${name} and c.relkind = 'i'`,
    );

  console.log(WRITE ? '=== 真的寫入 ===' : '=== 預演，不會碰資料庫 ===');
  console.log();

  /* 1 ── users 表 ------------------------------------------------------ */
  console.log('users 表');
  const usersExists = await hasTable('users');
  say(usersExists, '建立 users 表');
  if (WRITE && !usersExists) {
    await sql`
      create table users (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        password_hash text not null,
        line_user_id text,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        constraint users_name_unique unique (name),
        constraint users_line_user_id_unique unique (line_user_id)
      )
    `;
  }

  /* 2 ── 第一個帳號 ---------------------------------------------------- */
  console.log();
  console.log('第一個帳號');
  let ownerId: string | null = null;
  if (usersExists || WRITE) {
    const [existing] = await sql<{ id: string; name: string }[]>`
      select id, name from users order by created_at limit 1
    `;
    ownerId = existing?.id ?? null;
    say(!!existing, `建立「${existing?.name ?? OWNER_NAME}」，密碼沿用現在的 APP_PASSWORD`);

    if (WRITE && !existing) {
      const line = process.env.LINE_USER_ID?.trim() || null;
      const [created] = await sql<{ id: string }[]>`
        insert into users (name, password_hash, line_user_id)
        values (${OWNER_NAME}, ${await hashPassword(password)}, ${line})
        returning id
      `;
      ownerId = created.id;
      console.log(`    ${line ? '順便綁上現有的 LINE_USER_ID' : '沒有 LINE_USER_ID，先不綁'}`);
    }
  } else {
    say(false, `建立「${OWNER_NAME}」，密碼沿用現在的 APP_PASSWORD`);
  }

  /* 3 ── 四張表加 user_id --------------------------------------------- */
  console.log();
  console.log('四張表加上「這是誰的」');
  for (const table of TABLES) {
    const already = (await hasTable(table)) && (await hasColumn(table, 'user_id'));
    if (already) {
      const [{ count }] = await sql<{ count: number }[]>`
        select count(*)::int as count from ${sql(table)} where user_id is null
      `;
      say(count === 0, `${table} 補上 user_id${count > 0 ? `（還有 ${count} 筆沒有主人）` : ''}`);
    } else {
      const [{ count }] = (await hasTable(table))
        ? await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`
        : [{ count: 0 }];
      say(false, `${table} 加上 user_id，${count} 筆現有資料歸給「${OWNER_NAME}」`);
    }

    if (!WRITE) continue;
    if (!ownerId) throw new Error('沒有第一個帳號，無法決定舊資料的主人');

    await sql.unsafe(`alter table ${table} add column if not exists user_id uuid`);
    await sql.unsafe(`update ${table} set user_id = $1 where user_id is null`, [ownerId]);
    await sql.unsafe(`alter table ${table} alter column user_id set not null`);

    const fk = `${table}_user_id_users_id_fk`;
    if (!(await hasConstraint(fk))) {
      await sql.unsafe(
        `alter table ${table} add constraint ${fk}
         foreign key (user_id) references users(id) on delete restrict`,
      );
    }
  }

  /* 4 ── 唯一鍵與索引 -------------------------------------------------- */
  console.log();
  console.log('唯一鍵與索引');

  const oldUnique = await hasConstraint('categories_name_kind_unique');
  say(!oldUnique, '分類的「不可同名」改成每個人各算各的');
  if (WRITE && oldUnique) {
    await sql.unsafe(`alter table categories drop constraint categories_name_kind_unique`);
  }
  if (WRITE && !(await hasConstraint('categories_user_name_kind_unique'))) {
    await sql.unsafe(
      `alter table categories add constraint categories_user_name_kind_unique
       unique (user_id, name, kind)`,
    );
  }

  const INDEXES: [name: string, definition: string, replaces: string | null][] = [
    ['transactions_user_date_idx', 'transactions (user_id, date desc)', 'transactions_date_idx'],
    [
      'transactions_user_category_idx',
      'transactions (user_id, category_id)',
      'transactions_category_idx',
    ],
    ['transactions_user_kind_idx', 'transactions (user_id, kind)', 'transactions_kind_idx'],
    ['settlements_user_status_idx', 'settlements (user_id, status)', 'settlements_status_idx'],
    ['categories_user_idx', 'categories (user_id)', null],
    ['raw_inputs_user_idx', 'raw_inputs (user_id)', null],
  ];

  for (const [name, definition, replaces] of INDEXES) {
    const already = await hasIndex(name);
    say(already, `索引 ${name}`);
    if (!WRITE) continue;

    await sql.unsafe(`create index if not exists ${name} on ${definition}`);
    // 舊的單欄索引留著只會拖慢寫入，而且它能做的事新的都能做
    if (replaces) await sql.unsafe(`drop index if exists ${replaces}`);
  }

  console.log();
  if (WRITE) {
    console.log('改造完成。接下來：');
    console.log('  1. 部署新版程式 ← 舊版的寫入沒有 user_id，會被資料庫擋下來');
    console.log('  2. npm run user -- add 媽媽  ← 幫她開一個帳號');
    console.log();
    console.log('（不用跑 db:push，這支已經把資料庫改成 schema.ts 的樣子了。');
    console.log('　而且 drizzle-kit 在這個資料庫上會崩，見《踩過的雷》。）');
  } else {
    console.log('以上都還沒發生。確定沒問題的話加 --write 再跑一次。');
  }

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('遷移失敗：', err);
  process.exit(1);
});
