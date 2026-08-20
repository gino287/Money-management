/**
 * 一次性補救腳本。
 *
 * 2026-08-21 的驗收腳本跑到 LINE 那一段的「沒有東西可刪」時，
 * 對「最近一筆 LINE 紀錄」下了刪除指令，而那時候 [E2E] 的測試資料已經刪完了，
 * 於是刪到 Gino 早上自己用 LINE 記的那筆（幫我記昨天晚餐吃了$20）。
 *
 * 原句與 AI 解析結果都還在 raw_inputs 裡，照它補回來。
 * 補完就可以刪掉這支檔案，不要留在 repo。
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const { default: postgres } = await import('postgres');
const sql = postgres(process.env.DATABASE_URL, { prepare: false, fetch_types: false, max: 2 });

const RAW = '6842f392-f11f-49ad-b235-a0d75dc38e78';
// 「午餐 100」那筆用的分類（同一個 categoryIndex，也是餐食）
const CATEGORY = 'a840c3ba-0f82-40ac-8311-e3503f16144e';

const exists = await sql`select id from transactions where raw_input_id = ${RAW}`;
if (exists.length > 0) {
  console.log('已經在了，不重複補：', exists);
} else {
  const [back] = await sql`
    insert into transactions
      (date, amount, category_id, kind, note, is_fixed, is_communal, is_estimated,
       source, raw_input_id, created_at, updated_at)
    values
      ('2026-08-19', 20, ${CATEGORY}, 'expense', '晚餐',
       false, false, false, 'line', ${RAW},
       '2026-08-20T03:05:37.798Z', '2026-08-20T03:05:37.798Z')
    returning *`;
  console.log('補回來了：');
  console.dir(back, { depth: 4 });
}

console.log('--- 現在的帳本 ---');
console.table(
  await sql`select date, amount::float8 as amount, kind, source, note from transactions order by date desc`,
);
await sql.end();
