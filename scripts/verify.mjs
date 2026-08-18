/**
 * P1 驗收腳本。
 *
 * 跑法：先 `npm run build && npm run start`，另一個視窗執行
 *   node scripts/verify.mjs
 *
 * 刻意不用 Playwright test runner：那會為每個測試開新的瀏覽器 context、
 * 反覆重載整個站，對 Supabase 免費方案的 pooler 太粗暴，測到後面會開始
 * 卡住，分不清是程式壞了還是環境撐不住。這裡改成單一瀏覽器、單一連線、
 * 一條龍走完，跟 Gino 實際使用的節奏接近。
 *
 * 測試資料都帶 [E2E] 標記，跑完會刪乾淨，不會弄髒真正的帳。
 */
import { config } from 'dotenv';
import { chromium, devices } from '@playwright/test';
import postgres from 'postgres';

config({ path: '.env.local' });

const BASE = 'http://localhost:3000';
const MARK = '[E2E]';

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✘ ${label}${detail ? `  ← ${detail}` : ''}`);
  }
}

async function cleanup() {
  await sql`delete from transactions where note like ${MARK + '%'}`;
  await sql`delete from settlements where title like ${MARK + '%'}`;
  await sql`delete from categories where name like ${MARK + '%'}`;
}

/** 收尾的清理失敗不該蓋掉真正的測試結果，也不該讓行程整個炸掉 */
async function cleanupQuietly() {
  try {
    await cleanup();
  } catch (e) {
    console.log(`\n⚠ 清理測試資料時出錯：${e.message.split('\n')[0]}`);
    console.log(`  資料庫裡可能留著帶 ${MARK} 的測試資料，下次跑會自動清掉。`);
  }
}

const wait = (page, sel, timeout = 20000) =>
  page.locator(sel).first().waitFor({ state: 'visible', timeout });

/** 「備註與標記」預設收起來，要先打開才點得到裡面的東西 */
async function openMarks(page) {
  const marks = page.locator('form details').first();
  if (!(await marks.evaluate((el) => el.open))) await marks.locator('summary').click();
}

/** 用首頁表單記一筆，走 Gino 真正會走的路徑 */
async function record(page, e) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });

  if (e.kind && e.kind !== '支出') {
    await page.getByRole('button', { name: e.kind, exact: true }).click();
  }
  // 開伙是表單上的一種性質（存進資料庫仍是 expense + is_communal）
  if (e.communal) await page.getByRole('button', { name: '開伙', exact: true }).click();
  else await page.getByPlaceholder('0', { exact: true }).fill(String(e.amount));

  // 固定支出的分類按鈕名稱後面還跟著「固定」標籤，不能用 exact 比對
  await page.getByRole('button', { name: e.category }).first().click();

  await openMarks(page);
  if (e.estimated) await page.getByLabel('估算金額').check();
  await page.getByPlaceholder('備註（可留空）').fill(`${MARK} ${e.note}`);
  await page.getByRole('button', { name: '記一筆' }).click();
  await page.getByText('記好了').waitFor({ timeout: 25000 });
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Desktop Chrome'], baseURL: BASE });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('    [瀏覽器錯誤]', e.message.slice(0, 160)));

try {
  await cleanupQuietly();

  console.log('\n【登入】');
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  check('未登入會被導到登入頁，且記住原本要去的頁面', page.url().includes('next=%2Ftransactions'));

  await page.getByPlaceholder('密碼').fill('definitely-wrong');
  await page.getByRole('button', { name: '進入' }).click();
  await wait(page, 'text=密碼不對');
  check('密碼錯誤不放行', true);

  await page.getByPlaceholder('密碼').fill(process.env.APP_PASSWORD);
  await page.getByRole('button', { name: '進入' }).click();
  await page.getByRole('link', { name: '明細' }).waitFor({ timeout: 25000 });
  check('密碼正確後回到原本要去的頁面', page.url().endsWith('/transactions'));

  /**
   * 月結算的期望值要以「你原本就有的帳」為基準往上加。
   * 寫死 950 那種寫法只有在當月完全沒帳時才成立，
   * 你八月本來就有幾筆，腳本會誤判成程式壞掉。
   */
  const [base] = await sql`
    select
      coalesce(sum(amount) filter (where kind = 'expense' and not is_fixed), 0)::float8 as variable,
      coalesce(sum(amount) filter (where kind = 'expense' and is_fixed), 0)::float8 as fixed,
      coalesce(sum(amount) filter (where kind = 'income'), 0)::float8 as income,
      coalesce(sum(amount) filter (where kind = 'advance'), 0)::float8 as advance,
      count(*) filter (where is_communal)::int as communal
    from transactions
    where date >= date_trunc('month', (now() at time zone 'Asia/Taipei'))::date
      and date < (date_trunc('month', (now() at time zone 'Asia/Taipei')) + interval '1 month')::date`;

  const money = (n) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(n);

  console.log('\n【記帳：五種性質】');
  await record(page, { category: '餐食', amount: 150, note: '午餐' });
  await record(page, { category: '房租', amount: 6000, note: '房租' });
  await record(page, { category: '食材採買', communal: true, note: '開伙' });
  await record(page, { category: '醫療', amount: 800, note: '估算', estimated: true });
  await record(page, { kind: '暫付款', category: '雜支', amount: 500, note: '幫同學代墊' });
  await record(page, { kind: '收入', category: '工讀薪水', amount: 12000, note: '薪水' });

  const rows = await sql`
    select kind, amount::float8 as amount, is_fixed, is_communal, is_estimated, note
    from transactions where note like ${MARK + '%'}`;
  const by = (s) => rows.find((r) => r.note.includes(s)) ?? {};

  check('六筆都寫進去了', rows.length === 6, `實際 ${rows.length} 筆`);
  check('開伙記 0 元但保留紀錄', by('開伙').amount === 0 && by('開伙').is_communal === true);
  check('暫付款是獨立性質 advance', by('幫同學代墊').kind === 'advance');
  check('房租標記為固定支出', by('房租').is_fixed === true);
  check('餐食是變動支出', by('午餐').is_fixed === false);
  check('估算金額有標記', by('估算').is_estimated === true);
  check('收入性質正確', by('薪水').kind === 'income');

  console.log('\n【月結算：固定／變動／暫付款分開】');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });
  const summary = await page.getByTestId('month-summary').innerText();
  const seen = summary.split('|').join(' ');
  check(
    `變動支出 ${money(base.variable + 950)}（原有 ${money(base.variable)} 再加 150、800，開伙 0 不影響）`,
    summary.includes(money(base.variable + 950)),
    seen,
  );
  check(
    `固定支出 ${money(base.fixed + 6000)} 獨立顯示`,
    summary.includes(money(base.fixed + 6000)),
    seen,
  );
  check(`收入 ${money(base.income + 12000)}`, summary.includes(money(base.income + 12000)), seen);
  check(
    `暫付款 ${money(base.advance + 500)} 不併入支出`,
    summary.includes(money(base.advance + 500)),
    seen,
  );
  check(
    `開伙次數看得到（${base.communal + 1} 次）`,
    (await page.getByText(`開伙 ${base.communal + 1} 次`).count()) === 1,
  );

  console.log('\n【事後修正：估算改實際，留稽核】');
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /估算/ }).first().click();
  await page.getByPlaceholder('0', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByPlaceholder('0', { exact: true }).fill('1250');
  await openMarks(page);
  await page.getByLabel('估算金額').uncheck();
  await page.getByRole('button', { name: '儲存修改' }).click();
  await page.waitForURL('**/transactions', { timeout: 25000 });

  const [edited] = await sql`
    select id, amount::float8 as amount, is_estimated from transactions
    where note like ${MARK + '%估算%'}`;
  check('金額直接覆蓋成 1250', edited?.amount === 1250, `實際 ${edited?.amount}`);
  check('估算標記已取消', edited?.is_estimated === false);

  const revs = await sql`select * from transaction_revisions where transaction_id = ${edited.id}`;
  check('修改有寫進稽核表', revs.length === 1, `實際 ${revs.length} 筆`);

  await page.goto(`${BASE}/transactions/${edited.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('改過 1 次').waitFor({ timeout: 20000 });
  const diffText = await page.locator('body').innerText();
  check('稽核看得到金額怎麼改的', diffText.includes('800') && diffText.includes('1,250'));

  console.log('\n【待結清：沒結清就一直看得到】');
  await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '＋ 新增待結清項目' }).click();
  await page.getByPlaceholder(/押金待回收/).fill(`${MARK} 押金待回收`);
  await page.getByPlaceholder(/預計金額/).fill('8000');
  await page.getByRole('button', { name: '新增待結清' }).click();
  await page.getByText(`${MARK} 押金待回收`).waitFor({ timeout: 25000 });
  check('新增待結清成功', true);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/還有 1 筆沒結清/).waitFor({ timeout: 20000 });
  check('首頁常駐提醒出現', true);
  check('導覽列顯示未結清數量', (await page.getByRole('link', { name: /待結清\s*1/ }).count()) === 1);

  await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '標記結清' }).click();
  await page.getByText('都結清了').waitFor({ timeout: 25000 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });
  check('結清後提醒消失', (await page.getByText(/還有 .* 筆沒結清/).count()) === 0);

  await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '還原' }).click();
  await page.getByRole('button', { name: '標記結清' }).waitFor({ timeout: 25000 });
  check('按錯可以還原', true);

  console.log('\n【分類：停用不影響舊紀錄】');
  await page.goto(`${BASE}/categories`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('新分類名稱').fill(`${MARK}臨時分類`);
  await page.getByRole('button', { name: '新增' }).click();
  await page.getByText(`${MARK}臨時分類`).first().waitFor({ timeout: 25000 });
  check('可以自己新增分類', true);

  await record(page, { category: `${MARK}臨時分類`, amount: 99, note: '用臨時分類記的' });

  await page.goto(`${BASE}/categories`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('li').filter({ hasText: `${MARK}臨時分類` }).first();
  await row.getByRole('button', { name: '停用' }).click();
  await row.getByText('已停用').waitFor({ timeout: 25000 });
  check('分類可以停用', true);
  check('看得到用過幾筆', (await row.getByText('用過 1 筆').count()) === 1);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });
  check(
    '停用後新增表單不再出現該分類',
    (await page.getByRole('button', { name: `${MARK}臨時分類` }).count()) === 0,
  );
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await page.getByText('明細').first().waitFor({ timeout: 20000 });
  check(
    '舊紀錄仍然顯示該分類',
    (await page.getByText(`${MARK}臨時分類`).count()) > 0,
  );

  console.log('');
  console.log('【明細篩選】');
  /**
   * 定位一律限定在清單的 li 裡面。
   * 「篩選」收合區裡也有一顆叫「工讀薪水」的分類按鈕，它是收起來的、永遠不可見，
   * 直接用 getByText('薪水').first() 會抓到那顆，然後一路等到逾時。
   */
  const listItem = (text) => page.locator('li').filter({ hasText: text });

  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: '收入', exact: true }).click();
  // 一定要等網址真的換過去。分頁是普通的 <a>，點下去到頁面換掉之間有空窗，
  // 沒等的話會在「還沒篩選」的清單上做檢查，然後得到看起來像壞掉的結果。
  await page.waitForURL(/kind=income/, { timeout: 25000 });
  await listItem('薪水').first().waitFor({ timeout: 25000 });
  check('依性質篩選只留收入', (await listItem('午餐').count()) === 0);

  await page.goto(`${BASE}/transactions?q=${encodeURIComponent('午餐')}`, {
    waitUntil: 'domcontentloaded',
  });
  await listItem('午餐').first().waitFor({ timeout: 25000 });
  check('備註搜尋找得到', (await listItem('薪水').count()) === 0);


  console.log('\n【表單驗證】');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });
  await page.getByPlaceholder('0', { exact: true }).fill('100');
  await page.getByRole('button', { name: '記一筆' }).click();
  await page.getByText('請選一個分類').waitFor({ timeout: 25000 });
  check('沒選分類會擋下來', true);

  await page.getByRole('button', { name: '餐食' }).first().click();
  await page.getByPlaceholder('0', { exact: true }).fill('-50');
  await page.getByRole('button', { name: '記一筆' }).click();
  await page.getByText(/金額不能是負數/).waitFor({ timeout: 25000 });
  check('負數金額會擋下來', true);

  console.log('\n【刪除】');
  await page.goto(`${BASE}/transactions?q=${encodeURIComponent('午餐')}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('link', { name: /午餐/ }).first().click();
  await page.getByRole('button', { name: '刪除這筆' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '刪除這筆' }).click();
  await page.waitForURL('**/transactions**', { timeout: 25000 });
  const left = await sql`select count(*)::int as n from transactions where note like ${MARK + '%午餐%'}`;
  check('刪掉之後資料庫也沒有了', left[0].n === 0);

  console.log('\n【畫面截圖】');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: 'screenshots/desktop-home.png', fullPage: true });

  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p2.getByPlaceholder('密碼').fill(process.env.APP_PASSWORD);
  await p2.getByRole('button', { name: '進入' }).click();
  await p2.getByRole('button', { name: '記一筆' }).waitFor({ timeout: 25000 });
  check('iPhone 尺寸下也能登入並看到記帳表單', true);
  await p2.screenshot({ path: 'screenshots/iphone-home.png', fullPage: true });
  await p2.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await p2.getByText('明細').first().waitFor({ timeout: 20000 });
  await p2.screenshot({ path: 'screenshots/iphone-transactions.png', fullPage: true });
  await phone.close();
  console.log('  截圖存到 screenshots/');
} catch (e) {
  failed++;
  failures.push(`腳本中斷：${e.message.split('\n')[0]}`);
  console.log('\n✘ 腳本中斷：', e.message.split('\n')[0]);
  await page.screenshot({ path: 'screenshots/failure.png' }).catch(() => {});
} finally {
  await cleanupQuietly();
  await browser.close();
  await sql.end({ timeout: 5 });
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通過 ${passed} 項，失敗 ${failed} 項`);
if (failures.length) {
  console.log('失敗項目：');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
