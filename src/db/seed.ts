import { config } from 'dotenv';

config({ path: '.env.local' });

import { db } from './index';
import { categories, type CategoryKind } from './schema';

/**
 * 規格書 2.1 的既有分類 + 2026-08-10 確認的收入來源。
 * 這只是起點，之後 Gino 在 /categories 頁面自己增減。
 */
const SEED: { name: string; kind: CategoryKind; isFixed?: boolean }[] = [
  // 變動支出
  { name: '餐食', kind: 'expense' },
  { name: '雜支', kind: 'expense' },
  { name: '交通', kind: 'expense' },
  { name: '食材採買', kind: 'expense' },
  { name: '道場', kind: 'expense' },
  { name: '醫療', kind: 'expense' },
  { name: '健身', kind: 'expense' },
  // 固定支出
  { name: '房租', kind: 'expense', isFixed: true },
  { name: '壇費', kind: 'expense', isFixed: true },
  // AI 對不上分類時的落點，不要刪
  { name: '未分類', kind: 'expense' },
  // 收入
  { name: '工讀薪水', kind: 'income' },
  { name: '家人給的', kind: 'income' },
  { name: '朋友還錢／代墊收回', kind: 'income' },
  { name: '實驗室計畫', kind: 'income' },
  { name: '未分類', kind: 'income' },
];

async function main() {
  const rows = SEED.map((c, i) => ({
    name: c.name,
    kind: c.kind,
    isFixed: c.isFixed ?? false,
    sortOrder: i,
  }));

  // 重跑不會覆蓋 Gino 改過的分類，也不會重複新增
  const inserted = await db
    .insert(categories)
    .values(rows)
    .onConflictDoNothing({ target: [categories.name, categories.kind] })
    .returning({ name: categories.name, kind: categories.kind });

  if (inserted.length === 0) {
    console.log('分類都已存在，沒有新增任何資料。');
  } else {
    console.log(`新增了 ${inserted.length} 個分類：`);
    for (const c of inserted) console.log(`  ${c.kind === 'income' ? '收入' : '支出'} / ${c.name}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('灌種子資料失敗：', err);
  process.exit(1);
});
