/**
 * 把 `匯入/` 裡的舊月度 Excel 寫進資料庫。一次性的搬家工具，搬完就可以刪。
 *
 * 跑法：
 *   npm run import            ← 只印出「會做什麼」，不碰資料庫
 *   npm run import -- --write ← 真的寫進去
 *
 * 預設是預演，因為這支要寫三百多筆進 Gino 真正的帳本。
 * 寫進去的每一筆 source 都是 'import'，所以要反悔的話：
 *   delete from transactions where source = 'import';
 *
 * 規則是 2026-08-21 跟 Gino 對過檔案之後定的（六個問題的答案）：
 *   1. 日期一律 2026 年（3 月那張的標題誤植成 2025）
 *   2. 3~7 月整月匯，8 月只到 8/11 —— 8/12 起 Gino 已經在系統裡自己記了
 *   3. 開伙＝在家煮飯沒花費。其餘 0 元（回家沒花費、學長請客）照記 0 元但不算開伙
 *   4. 媽媽借款 30,000 不是收入，記成待結清（要還的錢）
 *   5. 分類照 Excel 原本的名字建
 *   6. 沒有確切日期的（「7月」「月初」）挑一天記，原文留在備註
 *
 * 寫入不走 src/app/actions/（那裡是給網頁用的 Server Action），
 * 所以規格書 2.2 的不變條件在這支裡要自己顧好：
 * 暫付款用 kind='advance' 不混進支出、開伙 amount=0 且 isCommunal、
 * 固定支出獨立標記、估算標記留著、分類只新增不刪。
 */
import { readdirSync } from 'node:fs';

import { config } from 'dotenv';
import ExcelJS from 'exceljs';
import postgres from 'postgres';

config({ path: '.env.local' });

const DIR = '匯入';
const YEAR = 2026;
/** 8/12 起是 Gino 在系統裡記的，再匯一次就會變兩筆 */
const CUTOFF = '2026-08-11';
const WRITE = process.argv.includes('--write');

/** Excel 有、系統還沒有的分類。只新增，不改也不刪既有的 */
const NEW_EXPENSE = ['日用品', '娛樂', '人情', '住宿', '旅遊', '訂閱', '家具'];
const NEW_INCOME = ['固定收入', '投資收入', '其他收入', '工作收入', '退款', '報銷', '補助'];

/**
 * Excel 把「暫付款」當成一種分類，系統把它當成一種**性質**（kind='advance'），
 * 這樣月結算才能把它跟一般支出分開（規格書 2.2）。所以這三筆要改掛一個真的分類。
 */
const ADVANCE_CATEGORY = {
  新北課程訂金: '雜支',
  '押金（2個月）': '住宿',
};

/**
 * Excel 裡記成暫付款、但後來證明就是花掉了的。
 * 6/14 的露營費用 1,800 當時寫「待退回」，Gino 2026-08-21 確認那不是暫付款，
 * 就是一般支出（7 月那筆 1,800 退款還在收入裡，兩邊相抵）。
 */
const NOT_ADVANCE = { 露營費用: '娛樂' };

/** 房租、壇費是固定支出。7 月的「月租」記在明細裡，性質一樣 */
const FIXED_ITEM = { 租金: '房租', 月租: '房租', 壇費: '壇費' };

/**
 * 待結清。這幾筆只存在於「月結算」分頁的敘述裡（那是給人看的段落，不是表格），
 * 所以照 7 月、8 月兩張的「【待回收/延續追蹤】」寫死在這裡，不硬解析。
 */
const SETTLEMENTS = [
  {
    title: '押金（退租時返還）',
    expected: 22000,
    direction: 'receivable',
    note: '7 月付，兩個月押金',
  },
  {
    title: '租屋補助（審核中）',
    expected: null,
    direction: 'receivable',
    note: '7 月申請，金額待定',
  },
  {
    title: '媽媽借款',
    expected: 30000,
    direction: 'payable',
    note: '日後從投資收入扣還，預計 7~12 月',
  },
];

const notes = [];
const skipped = [];

function flag(where, message) {
  notes.push(`${where}｜${message}`);
}

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value).trim();
};

const cellNumber = (value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) return cellNumber(value.result);
  const text = cellText(value).replace(/[$,NT元\s]/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

const lastDayOf = (month) => new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
const iso = (month, day) =>
  `${YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Excel 的日期欄。大部分是「7/13」，但也有「7/13~16」「7月」「3月初」「5月底」。
 * 回傳 { date, hint } —— hint 是要補進備註的原文，讓「這天其實是我挑的」看得出來。
 */
function parseDate(text) {
  const clean = text.replace(/\s/g, '');

  const exact = clean.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (exact) return { date: iso(Number(exact[1]), Number(exact[2])), hint: '' };

  // 「6/19~21」「7/13~16」：跨好幾天的一筆，記在第一天
  const range = clean.match(/^(\d{1,2})\/(\d{1,2})[~～-](\d{1,2})$/);
  if (range) {
    return { date: iso(Number(range[1]), Number(range[2])), hint: `原本寫 ${clean}` };
  }

  const fuzzy = clean.match(/^(\d{1,2})月(初|中|底)?$/);
  if (fuzzy) {
    const m = Number(fuzzy[1]);
    const day = fuzzy[2] === '底' ? lastDayOf(m) : fuzzy[2] === '中' ? 15 : 1;
    return { date: iso(m, day), hint: `原本只寫「${clean}」` };
  }

  return { date: null, hint: '' };
}

/** 項目跟備註併成一句話。項目是「晚餐」、備註是「自助餐」，合起來才看得懂 */
function buildNote(item, remark, hint) {
  const parts = [];
  if (item) parts.push(item);
  if (remark && remark !== item) parts.push(remark);
  if (hint) parts.push(hint);
  return parts.join('｜').slice(0, 200) || null;
}

/**
 * 讀一格，但被合併吃掉的格子一律當空的。
 *
 * exceljs 讀合併儲存格時，範圍內每一格都會回同一個值。帳本裡「3/23」「4月底」
 * 這種列就是 A:C 合併的，不擋掉的話項目跟分類都會變成日期，
 * 還會憑空生出一個叫「4月底」的分類。
 */
const at = (row, column) => {
  const cell = row.getCell(column);
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
  return cell.value;
};

const isEstimatedText = (text) => /估/.test(text);
/** 開伙＝在家煮飯這一餐沒花錢。「回家沒花費」「學長請客」也是 0 元，但不是開伙 */
const isCommunalText = (text) => /在家|開火|開伙/.test(text);

function readDetail(workbook, file, month) {
  const sheet = workbook.worksheets.find((w) => w.name.includes('記帳明細'));
  if (!sheet) throw new Error(`${file} 找不到記帳明細分頁`);

  const rows = [];
  let header = 0;
  for (let r = 1; r <= 5 && !header; r++) {
    if (cellText(sheet.getRow(r).getCell(1).value) === '日期') header = r;
  }
  if (!header) throw new Error(`${file} 的記帳明細找不到標題列`);

  let trailer = false;

  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateText = cellText(at(row, 1));
    const item = cellText(at(row, 2));
    const category = cellText(at(row, 3));
    const amount = cellNumber(at(row, 4));
    const remark = cellText(at(row, 5));

    if (!dateText && !item && !category && amount === null) continue;

    // 「本月合計」以下是合計與固定支出區，不是一般紀錄
    if (dateText.includes('合計')) {
      trailer = true;
      continue;
    }

    if (trailer) {
      if (dateText.includes('固定支出')) continue;
      // 「Wemo會員費（已含上方）」「壇費（已含上方）」是提醒用的 0 元列，記了會重複計
      if (dateText.includes('已含上方') || !amount) continue;

      const name = FIXED_ITEM[dateText];
      if (!name) {
        flag(`${month}月`, `合計底下有一列看不懂，沒有匯入：「${dateText}」${amount}`);
        continue;
      }
      rows.push({
        date: iso(month, 1),
        amount,
        categoryName: name,
        kind: 'expense',
        note: `${dateText}（固定支出）`,
        isFixed: true,
        isCommunal: false,
        isEstimated: false,
        month,
      });
      continue;
    }

    const { date, hint } = parseDate(dateText);
    if (!date) {
      skipped.push(`${month}月 第 ${r} 列：日期看不懂「${dateText}」`);
      continue;
    }
    if (amount === null) {
      skipped.push(`${month}月 ${dateText}：金額不是數字`);
      continue;
    }

    const text = `${item} ${remark}`;
    let categoryName = category;
    let kind = 'expense';

    if (category === '暫付款' && NOT_ADVANCE[item]) {
      categoryName = NOT_ADVANCE[item];
      flag(`${month}月`, `「${item} ${amount}」Excel 記成暫付款，改成一般支出／${categoryName}`);
    } else if (category === '暫付款') {
      kind = 'advance';
      categoryName = ADVANCE_CATEGORY[item] ?? '未分類';
      flag(`${month}月`, `暫付款「${item} ${amount}」改記成性質＝暫付款、分類＝${categoryName}`);
    }

    // 3 月有一列日期被貼到項目跟分類欄，救不回來就歸未分類讓 Gino 事後挑
    if (!categoryName || /^\d{1,2}\/\d{1,2}$/.test(categoryName)) {
      categoryName = '未分類';
      flag(`${month}月`, `${dateText} 這列沒有分類（${amount} 元），先歸未分類`);
    }

    const fixedName = FIXED_ITEM[item];
    if (fixedName) categoryName = fixedName;

    rows.push({
      date,
      amount,
      categoryName,
      kind,
      note: buildNote(item, remark, hint),
      isFixed: Boolean(fixedName),
      isCommunal: kind === 'expense' && amount === 0 && isCommunalText(text),
      isEstimated: isEstimatedText(text),
      month,
    });
  }

  return rows;
}

function readIncome(workbook, file, month) {
  const sheet = workbook.worksheets.find((w) => w.name.includes('收入明細'));
  if (!sheet) return [];

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateText = cellText(at(row, 1));
    const item = cellText(at(row, 2));
    const category = cellText(at(row, 3));
    const amount = cellNumber(at(row, 4));
    const remark = cellText(at(row, 5));

    if (!dateText && !item && amount === null) continue;
    if (dateText.includes('總收入') || dateText.includes('尚無收入')) continue;

    // 借款不是收入 —— 那是要還的錢，算進收入會讓 7 月憑空多三萬
    if (category === '借款') {
      flag(`${month}月`, `「${item} ${amount}」是借來的錢，不記成收入，改成待結清`);
      continue;
    }

    if (!amount) {
      flag(`${month}月`, `收入「${item}」金額是 0（${remark}），沒有匯入`);
      continue;
    }

    const { date, hint } = parseDate(dateText);
    if (!date) {
      skipped.push(`${month}月 收入第 ${r} 列：日期看不懂「${dateText}」`);
      continue;
    }

    // 4 月那筆工讀薪水寫在 A:C 合併的列裡，分類欄是空的
    if (!category) {
      flag(`${month}月`, `收入「${item || remark} ${amount}」在 Excel 裡沒有分類，先歸未分類`);
    }

    rows.push({
      date,
      amount,
      categoryName: category || '未分類',
      kind: 'income',
      note: buildNote(item, remark, hint),
      isFixed: false,
      isCommunal: false,
      isEstimated: isEstimatedText(`${item} ${remark}`),
      month,
    });
  }
  return rows;
}

async function main() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();

  if (files.length === 0) {
    console.log(`${DIR}/ 裡沒有 Excel。`);
    return;
  }

  const all = [];
  for (const file of files) {
    const month = Number(file.match(/_(\d{1,2})月/)?.[1]);
    if (!month) {
      flag(file, '檔名看不出月份，整個檔案跳過');
      continue;
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(`${DIR}/${file}`);
    all.push(...readDetail(workbook, file, month), ...readIncome(workbook, file, month));
  }

  // 8/12 起 Gino 已經在系統裡自己記了，再匯一次就是兩筆
  const kept = all.filter((r) => {
    if (r.date <= CUTOFF) return true;
    skipped.push(`${r.date} ${r.note ?? ''}（${r.amount}）—— 過了 ${CUTOFF}，系統裡已經自己記了`);
    return false;
  });

  const sql = postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const existing = await sql`select name, kind, id from categories`;
    const byName = new Map(existing.map((c) => [`${c.kind}:${c.name}`, c.id]));

    const wanted = (kind) => [
      ...new Set(
        kept.filter((r) => (r.kind === 'income') === (kind === 'income')).map((r) => r.categoryName),
      ),
    ];
    const missing = [
      ...wanted('expense')
        .filter((n) => !byName.has(`expense:${n}`))
        .map((name) => ({ name, kind: 'expense' })),
      ...wanted('income')
        .filter((n) => !byName.has(`income:${n}`))
        .map((name) => ({ name, kind: 'income' })),
    ];

    for (const m of missing) {
      const planned = m.kind === 'expense' ? NEW_EXPENSE : NEW_INCOME;
      if (!planned.includes(m.name)) {
        flag('分類', `Excel 出現了計畫外的分類「${m.name}」，會一併建起來`);
      }
    }

    // 同一天、同金額、同分類、同備註的就當作已經匯過，重跑不會變兩份
    const already = await sql`
      select date::text as date, amount::float8 as amount, category_id, kind, coalesce(note, '') as note
      from transactions
      where date between ${iso(3, 1)} and ${CUTOFF}`;
    const seen = new Set(
      already.map((r) => [r.date, r.amount, r.category_id, r.kind, r.note].join('|')),
    );

    console.log(`讀了 ${files.length} 個檔案，${kept.length} 筆可以匯入\n`);

    console.log('【要新增的分類】');
    if (missing.length === 0) console.log('  沒有，現有分類就夠了');
    for (const m of missing) console.log(`  ${m.kind === 'expense' ? '支出' : '收入'}　${m.name}`);

    console.log('\n【每個月各幾筆】');
    for (const month of [...new Set(kept.map((r) => r.month))].sort((a, b) => a - b)) {
      const rows = kept.filter((r) => r.month === month);
      const expense = rows.filter((r) => r.kind === 'expense');
      const sum = expense.reduce((n, r) => n + r.amount, 0);
      const parts = [
        `支出 ${expense.length} 筆／${sum.toLocaleString()} 元`,
        `收入 ${rows.filter((r) => r.kind === 'income').length} 筆`,
      ];
      const push = (list, label) => list.length > 0 && parts.push(`${label} ${list.length}`);
      push(rows.filter((r) => r.kind === 'advance'), '暫付款');
      push(rows.filter((r) => r.isCommunal), '開伙');
      push(rows.filter((r) => r.isEstimated), '估算');
      push(rows.filter((r) => r.isFixed), '固定');
      console.log(`  ${month} 月　${parts.join('　·　')}`);
    }

    console.log('\n【待結清】');
    for (const s of SETTLEMENTS) {
      const amount = s.expected === null ? '金額未定' : s.expected.toLocaleString();
      console.log(`  ${s.direction === 'receivable' ? '會回來' : '要還出去'}　${s.title}　${amount}`);
    }

    if (notes.length > 0) {
      console.log('\n【我自己決定的，你可能想確認一下】');
      for (const line of notes) console.log(`  · ${line}`);
    }

    if (skipped.length > 0) {
      console.log(`\n【沒有匯入的 ${skipped.length} 列】`);
      for (const line of skipped) console.log(`  · ${line}`);
    }

    if (!WRITE) {
      console.log('\n這只是預演，資料庫沒有動。確定要寫進去就跑：');
      console.log('  npm run import -- --write');
      return;
    }

    let written = 0;
    let duplicated = 0;

    await sql.begin(async (tx) => {
      for (const m of missing) {
        const [row] = await tx`
          insert into categories (name, kind, is_fixed, sort_order, is_active)
          values (${m.name}, ${m.kind}, false, 100, true)
          on conflict (name, kind) do update set name = excluded.name
          returning id`;
        byName.set(`${m.kind}:${m.name}`, row.id);
      }

      for (const r of kept) {
        const categoryKind = r.kind === 'income' ? 'income' : 'expense';
        const categoryId = byName.get(`${categoryKind}:${r.categoryName}`);
        if (!categoryId) throw new Error(`分類對不到：${r.categoryName}`);

        const key = [r.date, r.amount, categoryId, r.kind, r.note ?? ''].join('|');
        if (seen.has(key)) {
          duplicated += 1;
          continue;
        }
        seen.add(key);

        await tx`
          insert into transactions
            (date, amount, category_id, kind, note, is_fixed, is_communal, is_estimated, source)
          values
            (${r.date}, ${r.amount}, ${categoryId}, ${r.kind}, ${r.note},
             ${r.isFixed}, ${r.isCommunal}, ${r.isEstimated}, 'import')`;
        written += 1;
      }

      for (const s of SETTLEMENTS) {
        const [exists] = await tx`select id from settlements where title = ${s.title}`;
        if (exists) continue;
        await tx`
          insert into settlements (title, expected_amount, direction, status, note)
          values (${s.title}, ${s.expected}, ${s.direction}, 'open', ${s.note})`;
      }
    });

    console.log(`\n寫進去了 ${written} 筆${duplicated ? `，跳過 ${duplicated} 筆重複的` : ''}。`);
    console.log("要反悔的話：delete from transactions where source = 'import';");
  } finally {
    await sql.end();
  }
}

await main();
