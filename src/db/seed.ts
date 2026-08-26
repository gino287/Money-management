import { config } from 'dotenv';

config({ path: '.env.local' });

import { asc, sql } from 'drizzle-orm';

import { defaultCategoryRows } from './default-categories';
import { db } from './index';
import { categories, users } from './schema';

/**
 * 幫某一個人補上預設分類。
 *
 *   npm run db:seed              ← 補給第一個帳號（也就是 Gino）
 *   npm run db:seed -- 媽媽       ← 補給指定的人
 *
 * 開新帳號時 `npm run user:add` 已經會自動帶一份，這支是給
 * 「不小心刪掉了想補回來」或「改造前就存在的帳號」用的。
 * 重跑不會覆蓋已經改過的分類，也不會重複新增。
 */
async function main() {
  const wanted = process.argv[2]?.trim();

  const [user] = wanted
    ? await db
        .select()
        .from(users)
        .where(sql`lower(${users.name}) = ${wanted.toLowerCase()}`)
        .limit(1)
    : await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);

  if (!user) {
    console.error(wanted ? `找不到叫「${wanted}」的人` : '還沒有任何帳號，先跑 npm run user:add');
    process.exit(1);
  }

  const inserted = await db
    .insert(categories)
    .values(defaultCategoryRows(user.id))
    .onConflictDoNothing({ target: [categories.userId, categories.name, categories.kind] })
    .returning({ name: categories.name, kind: categories.kind });

  if (inserted.length === 0) {
    console.log(`${user.name} 的分類都已存在，沒有新增任何資料。`);
  } else {
    console.log(`幫 ${user.name} 新增了 ${inserted.length} 個分類：`);
    for (const c of inserted) console.log(`  ${c.kind === 'income' ? '收入' : '支出'} / ${c.name}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('灌種子資料失敗：', err);
  process.exit(1);
});
