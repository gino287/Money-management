/**
 * 看看 `匯入/` 裡的舊 Excel 長什麼樣子。
 *
 * 跑法：npm run check:excel
 *
 * 這支**只讀不寫** —— 不碰資料庫、不改 Excel、不需要 .env.local。
 * 目的只有一個：把每個分頁的實際結構印出來，好對出匯入規則。
 * 規格書第 7 節寫了「如果 Excel 裡藏著文件沒提到的規則，以實際資料為準」，
 * 這支就是拿來看清楚實際資料的。
 *
 * 為什麼不直接寫匯入程式？因為「五個分頁」只是口頭描述，欄位順序、
 * 標題怎麼寫、開伙跟暫付款在檔案裡是用哪一欄標的，都要看過真的檔案才知道。
 * 猜錯的匯入會把幾個月的帳寫歪，比慢一天糟得多。
 */
import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import ExcelJS from 'exceljs';

/** 預設看 `匯入/`；要看別的資料夾就 `node scripts/檢查excel.mjs 某個路徑` */
const DIR = process.argv[2] ?? '匯入';

/** 每個分頁最多印幾列資料 —— 夠看出格式就好，不是要把帳本倒出來 */
const SAMPLE_ROWS = 6;
/** 單一儲存格印出來最多幾個字 */
const CELL_WIDTH = 20;
/** 某一欄不同的值少於這個數，就當它是分類／標記欄，把值全部列出來 */
const DISTINCT_LIMIT = 30;

const warnings = [];

function warn(file, sheet, message) {
  warnings.push(`${file}｜${sheet ? `${sheet}｜` : ''}${message}`);
}

/**
 * 把 exceljs 的儲存格值變成一段字。
 *
 * 值可能是這幾種形狀，每一種都遇得到：
 * - 公式 `{ formula, result }` —— 月結算那種分頁整頁都是公式
 * - 超連結 `{ text, hyperlink }`
 * - 富文字 `{ richText: [...] }` —— 儲存格裡有一段字被標紅或加粗就會變這樣
 * - 錯誤 `{ error: '#DIV/0!' }`
 * - 日期 `Date` —— exceljs 把 Excel 的序號日期讀成 UTC 午夜，
 *   所以 toISOString 前十碼剛好就是原本格子裡那天，不會差一天
 */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text);
    if ('error' in value) return String(value.error);
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function kindOf(value) {
  if (value === null || value === undefined || cellText(value) === '') return 'empty';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object' && 'result' in value) return kindOf(value.result);
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  const text = cellText(value);
  // 日期常常是被存成文字的，「2026/5/1」「2026-05-01」都算
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text)) return 'date';
  // 「$150」「1,200」「150元」這種也是金額，只是打字的時候多打了東西
  if (/^[$NT￥]*-?[\d,]+(\.\d+)?\s*(元|塊)?$/.test(text)) return 'number';
  return 'text';
}

function pad(text, width) {
  const wide = [...text].reduce((n, ch) => n + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - wide));
}

function clip(text) {
  return [...text].length > CELL_WIDTH ? `${[...text].slice(0, CELL_WIDTH - 1).join('')}…` : text;
}

/** 讀一整列，回傳字串陣列（exceljs 的 row.values 是 1-based，第 0 格是空的） */
function rowValues(row, columnCount) {
  const out = [];
  for (let c = 1; c <= columnCount; c++) out.push(row.getCell(c).value);
  return out;
}

/**
 * 猜標題列。
 *
 * 帳本上面常常有一兩列標題（「2026年5月 記帳明細」之類的合併儲存格），
 * 所以不能直接假設第 1 列。取前八列裡「文字格最多、而且下一列有東西」的那列。
 *
 * 合併儲存格要特別擋掉：exceljs 讀出來的時候，被合併的每一格都會拿到同一個值，
 * 所以一列橫幅在這裡看起來會像「六個文字欄的漂亮標題列」，分數比真正的標題列還高。
 * 判斷方式是「整列的值只有一種」—— 真的標題列每欄名字都不一樣。
 */
function findHeaderRow(sheet, columnCount) {
  let best = { index: 1, score: -1 };
  const limit = Math.min(8, sheet.rowCount);

  for (let r = 1; r <= limit; r++) {
    const values = rowValues(sheet.getRow(r), columnCount);
    const texts = values.filter((v) => kindOf(v) === 'text').length;
    const filled = values.filter((v) => kindOf(v) !== 'empty').length;
    if (filled < 2) continue;

    const distinct = new Set(values.map(cellText).filter(Boolean));
    if (distinct.size === 1) continue; // 合併出來的橫幅，不是標題列

    const next = r < sheet.rowCount ? rowValues(sheet.getRow(r + 1), columnCount) : [];
    const nextFilled = next.filter((v) => kindOf(v) !== 'empty').length;
    // 標題列的特徵：整列都是文字，而且底下真的有資料
    const score = texts * 2 + filled + (nextFilled >= 2 ? 3 : 0);
    if (score > best.score) best = { index: r, score };
  }
  return best.index;
}

function describeSheet(fileName, sheet) {
  const columnCount = Math.min(sheet.columnCount || 0, 40);
  const rowCount = sheet.rowCount || 0;

  console.log(`\n  【分頁：${sheet.name}】${rowCount} 列 × ${sheet.columnCount} 欄`);

  if (rowCount === 0 || columnCount === 0) {
    console.log('    （空的）');
    warn(fileName, sheet.name, '這個分頁是空的');
    return;
  }

  const headerRow = findHeaderRow(sheet, columnCount);
  const headerCells = rowValues(sheet.getRow(headerRow), columnCount);
  const headers = headerCells.map(cellText);

  if (headerRow > 1) {
    const which = headerRow === 2 ? '第 1 列' : `第 1～${headerRow - 1} 列`;
    console.log(`    ${which}不是資料，看起來是標題：`);
    for (let r = 1; r < headerRow; r++) {
      // 合併的格子每一格都會回同一個值，重複印沒有意義
      const line = [...new Set(rowValues(sheet.getRow(r), columnCount).map(cellText))]
        .filter(Boolean)
        .join(' | ');
      if (line) console.log(`      ${line}`);
    }
  }

  // 逐欄統計，順便記下每一欄出現過哪些值
  const columns = headers.map((title, i) => ({
    letter: sheet.getColumn(i + 1).letter,
    title: title || '（沒有標題）',
    counts: { date: 0, number: 0, text: 0, boolean: 0, empty: 0 },
    distinct: new Map(),
    sample: '',
    hasFormula: false,
  }));

  for (let r = headerRow + 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c);
      const column = columns[c - 1];
      const kind = kindOf(cell.value);
      column.counts[kind] += 1;
      if (cell.formula) column.hasFormula = true;
      if (kind === 'empty') continue;

      const text = cellText(cell.value);
      if (!column.sample) column.sample = text;
      if (column.distinct.size <= DISTINCT_LIMIT) {
        column.distinct.set(text, (column.distinct.get(text) ?? 0) + 1);
      }
    }
  }

  const dataRows = Math.max(0, rowCount - headerRow);
  console.log(`    標題列在第 ${headerRow} 列，底下有 ${dataRows} 列資料`);

  // 「月結算」那種左邊項目名、右邊金額的分頁根本沒有標題列，要講清楚，
  // 不然下面印出來的「欄位名稱」其實是第一列資料，看的人會被誤導
  if (headerCells.some((cell) => ['date', 'number'].includes(kindOf(cell)))) {
    console.log('    （這一列裡有日期或數字，這個分頁大概沒有標題列，那就是第一筆資料）');
  }

  console.log('    每一欄：');

  for (const column of columns) {
    const { date, number, text, boolean, empty } = column.counts;
    if (date + number + text + boolean === 0) continue; // 整欄都是空的就不用印

    const parts = [];
    if (date) parts.push(`日期 ${date}`);
    if (number) parts.push(`數字 ${number}`);
    if (text) parts.push(`文字 ${text}`);
    if (boolean) parts.push(`是否 ${boolean}`);
    if (empty) parts.push(`空 ${empty}`);

    console.log(
      `      ${column.letter}  ${pad(clip(column.title), 14)}${pad(parts.join(' / '), 30)}` +
        `例：${clip(column.sample)}${column.hasFormula ? '（公式）' : ''}`,
    );

    // 分類欄、標記欄這種「來來去去就那幾個值」的，直接把值全列出來最有用
    const isEnumLike =
      text > 0 && column.distinct.size <= DISTINCT_LIMIT && column.distinct.size < dataRows;
    if (isEnumLike) {
      const listed = [...column.distinct.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, n]) => `${value}(${n})`)
        .join('　');
      console.log(`          出現過的值：${listed}`);
    }
  }

  console.log('    前幾列資料：');
  let printed = 0;
  for (let r = headerRow + 1; r <= rowCount && printed < SAMPLE_ROWS; r++) {
    const values = rowValues(sheet.getRow(r), columnCount).map(cellText);
    if (values.every((v) => v === '')) continue;
    console.log(`      ${values.map(clip).join(' | ')}`);
    printed += 1;
  }

  // 匯入時真正會卡住的東西，在這裡就先講
  const hasDate = columns.some((c) => c.counts.date > 0);
  const hasNumber = columns.some((c) => c.counts.number > 0);
  if (!hasDate && dataRows > 0) {
    warn(fileName, sheet.name, '找不到日期欄，匯入時要另外指定日期（例如用檔名的月份）');
  }
  if (!hasNumber && dataRows > 0) {
    warn(fileName, sheet.name, '找不到金額欄');
  }

  const merges = sheet.model?.merges ?? [];
  if (merges.length > 0) {
    warn(
      fileName,
      sheet.name,
      `有 ${merges.length} 處合併儲存格（${merges.slice(0, 3).join(', ')}…），只有左上角那格讀得到值`,
    );
  }

  for (const column of columns) {
    // 金額欄裡混著文字，通常是「300多」「約 500」這種 —— 正好對應系統的「估算金額」
    if (column.counts.number > 3 && column.counts.text > 0) {
      const oddballs = [...column.distinct.keys()].filter((v) => kindOf(v) === 'text').slice(0, 5);
      warn(
        fileName,
        sheet.name,
        `${column.letter} 欄（${column.title}）大部分是數字，但有 ${column.counts.text} 格是文字：${oddballs.join('、')}`,
      );
    }
  }
}

async function main() {
  let entries;
  try {
    entries = readdirSync(DIR);
  } catch {
    console.log(`找不到 ${DIR}/ 資料夾。它應該在專案根目錄，裡面有一份 README.md。`);
    process.exit(1);
  }

  const files = entries
    .filter((name) => !name.startsWith('~$')) // Excel 開著的時候會產生的暫存檔
    .filter((name) => ['.xlsx', '.xlsm', '.xls', '.csv'].includes(extname(name).toLowerCase()));

  if (files.length === 0) {
    console.log(`${DIR}/ 裡還沒有 Excel。`);
    console.log('把過去幾個月的月度帳本拖進去，再跑一次這個指令就行。');
    console.log(`（說明在 ${DIR}/README.md）`);
    return;
  }

  console.log(`${DIR}/ 裡有 ${files.length} 個檔案\n`);

  for (const name of files.sort()) {
    const path = join(DIR, name);
    const size = statSync(path).size;
    const ext = extname(name).toLowerCase();

    console.log('='.repeat(72));
    console.log(`${name}　${(size / 1024).toFixed(0)} KB`);

    if (ext !== '.xlsx' && ext !== '.xlsm') {
      console.log(`  讀不了 ${ext} —— 用 Excel 開起來另存成 .xlsx 再放回來。`);
      warn(name, '', `${ext} 格式讀不了，請另存成 .xlsx`);
      continue;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(path);
    } catch (error) {
      console.log(`  打不開：${error.message}`);
      warn(name, '', `打不開：${error.message}`);
      continue;
    }

    const sheets = workbook.worksheets;
    console.log(`  ${sheets.length} 個分頁：${sheets.map((s) => s.name).join('、')}`);
    for (const sheet of sheets) describeSheet(name, sheet);
    console.log('');
  }

  console.log('='.repeat(72));
  if (warnings.length === 0) {
    console.log('沒有發現會卡住匯入的問題。');
  } else {
    console.log(`匯入前要留意 ${warnings.length} 件事：`);
    for (const line of warnings) console.log(`  · ${line}`);
  }
  console.log('\n把上面整段貼給 Claude，就可以開始寫匯入規則了。');
}

await main();
