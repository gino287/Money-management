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
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

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

/**
 * 只刪自己造出來的東西。
 *
 * 這裡每一句 delete 都必須綁在 [E2E] 標記上，**永遠不要用 source、日期
 * 這種會掃到真實資料的條件**。2026-08-20 就是因為臨時測試腳本寫了
 * `delete from transactions where date = 今天`，把 Gino 當天真的記的一筆刪掉
 * （靠 raw_inputs 存的原句才救回來）。口語輸入與 LINE 記的帳，備註是 AI 寫的、
 * 不會帶標記，所以改成從原句反查。
 */
async function cleanup() {
  await sql`
    delete from transactions
    where raw_input_id in (select id from raw_inputs where text like ${MARK + '%'})`;
  await sql`delete from transactions where note like ${MARK + '%'}`;
  await sql`delete from settlements where title like ${MARK + '%'}`;
  await sql`delete from categories where name like ${MARK + '%'}`;
  await sql`delete from raw_inputs where text like ${MARK + '%'}`;
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

/** 首頁載好了沒。口語輸入框永遠在，手動表單則是預設收起來的 */
const homeReady = (page, timeout = 20000) =>
  page.getByPlaceholder('用講的：剛剛午餐 150').waitFor({ state: 'visible', timeout });

/**
 * 首頁的手動表單預設收起來，要先按「自己填」才展開。
 * 展開後才點得到性質、分類、日期那些按鈕。
 */
async function openForm(page, timeout = 20000) {
  await homeReady(page, timeout);
  const toggle = page.getByRole('button', { name: '自己填' });
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.getByRole('button', { name: '收起來' }).waitFor({ state: 'visible', timeout: 5000 });
  }
}

/** 用首頁表單記一筆，走 Gino 真正會走的路徑 */
async function record(page, e) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await openForm(page);

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
  const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).slice(0, 7);

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
  await homeReady(page);
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
  // 限定在月結算卡片裡找：招呼底下的「今天」那一行也會講開伙幾次，
  // 不指名的話兩個都會被算到，數字對了測試反而會掛
  check(
    `開伙次數看得到（${base.communal + 1} 次）`,
    (await page
      .getByTestId('month-summary')
      .getByText(`開伙 ${base.communal + 1} 次`)
      .count()) === 1,
  );

  console.log();
  console.log('【首頁：第一眼要乾淨】');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await homeReady(page);
  /*
   * 收起來與否要量高度。
   * 不能用 Playwright 的 isVisible()：收合是靠外層 grid 把高度壓成 0 再 overflow 裁掉，
   * 裡面的按鈕自己仍然有一個 bounding box，它就會回報「看得見」。
   * 使用者看不看得到，看的是外層那個容器的高度。
   */
  const formHeight = (p) =>
    p.locator('#manual-form > div').evaluate((el) => el.getBoundingClientRect().height);
  const settled = (p, want) =>
    p.waitForFunction(
      (tall) => {
        const el = document.querySelector('#manual-form > div');
        if (!el) return false;
        const h = el.getBoundingClientRect().height;
        return tall ? h > 100 : h < 1;
      },
      want,
      { timeout: 5000 },
    );

  check('進首頁先看到打招呼', (await page.getByText(/，Gino$/).count()) === 1);
  check('今天的狀況有一行話', (await page.getByText(/今天(還沒記帳|花了|記了)/).count()) === 1);
  check('口語輸入框永遠露在外面', await page.getByPlaceholder('用講的：剛剛午餐 150').isVisible());
  check('手動表單預設收起來', (await formHeight(page)) < 1);
  await page.getByRole('button', { name: '自己填' }).click();
  await settled(page, true);
  check('按「自己填」會展開', true);
  await page.getByRole('button', { name: '收起來' }).click();
  await settled(page, false);
  check('按「收起來」會收回去', true);

  // 收起來的時候鍵盤不能 Tab 進看不見的表單裡
  check(
    '收起來時表單不吃鍵盤焦點',
    await page.locator('#manual-form').evaluate((el) => el.hasAttribute('inert')),
  );

  console.log();
  console.log('【網址帶一句話進來】');
  await page.goto(`${BASE}/?say=${encodeURIComponent(`${MARK} 剛剛午餐 88`)}`, {
    waitUntil: 'domcontentloaded',
  });
  await homeReady(page, 25000);
  check(
    '?say= 會把口語輸入框先填好',
    (await page.getByPlaceholder('用講的：剛剛午餐 150').inputValue()) === `${MARK} 剛剛午餐 88`,
  );
  check('但不會自動送出（送出要花錢呼叫 AI）', (await page.getByText(/聽成這樣/).count()) === 0);
  console.log();
  console.log('【匯出 CSV】');
  // 直接組 CRLF 常數，不要在字串裡寫跳脫字元 —— 這個檔案是用 heredoc 寫進去的，
  // 跳脫序列會在半路被吃掉變成真的換行，把腳本弄壞（已經中過兩次）
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
  const csvRes = await page.request.get(`${BASE}/api/export?month=${currentMonth}`);
  const csv = await csvRes.text();
  check('匯出端點回得了 CSV', csvRes.status() === 200);
  check('CSV 有 UTF-8 BOM（不然 Excel 開中文會亂碼）', csv.charCodeAt(0) === 0xfeff);
  check('第一行是欄位名稱', csv.split(CRLF)[0].includes('日期,性質,分類,金額'));
  check('匯出得到剛剛記的那幾筆', csv.includes(`${MARK} 午餐`) && csv.includes('6000'));
  check('性質用中文寫', csv.includes('暫付款') && csv.includes('收入'));
  check(
    '每一行的欄位數都對得上（含逗號的備註有被引號包好）',
    csv
      .split(CRLF)
      .filter(Boolean)
      .every((line) => line.split(',').length >= 8),
  );


  console.log('\n【月結算頁與圖表】');
  await page.goto(`${BASE}/summary`, { waitUntil: 'domcontentloaded' });
  await page.getByText('這個月花了').waitFor({ timeout: 25000 });
  const summaryPage = await page.locator('main').innerText();

  check(
    `月結算的支出總額 ${money(base.variable + base.fixed + 6950)}`,
    summaryPage.includes(money(base.variable + base.fixed + 6950)),
    summaryPage.split('\n').slice(0, 8).join(' '),
  );
  check(
    `暫付款 ${money(base.advance + 500)} 單獨一格，沒併進支出`,
    summaryPage.includes(money(base.advance + 500)),
  );
  check(`收入 ${money(base.income + 12000)} 單獨一格`, summaryPage.includes(money(base.income + 12000)));
  check('開伙次數看得到', /開伙 \d+ 次/.test(summaryPage));

  // 趨勢圖：六個月份都要有柱子（沒帳的月份畫底線，但標籤還是在）
  const monthLabels = await page.getByText(/^\d{1,2}月$/).count();
  check('趨勢圖有六個月份', monthLabels === 6, `實際 ${monthLabels} 個`);

  // 分類佔比
  check('分類佔比列得出房租', summaryPage.includes('房租'));
  check('分類佔比列得出餐食', summaryPage.includes('餐食'));
  const pcts = [...summaryPage.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
  check(
    '各分類百分比加起來接近 100',
    pcts.length > 0 && Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) <= pcts.length,
    `實際 ${pcts.join('+')}`,
  );

  // 月份切換
  await page.getByLabel('上個月').click();
  await page.waitForURL(/month=/, { timeout: 25000 });
  check('可以往前翻月份', await page.getByText('回到本月').isVisible());
  await page.getByText('回到本月').click();
  await page.waitForURL((u) => !u.search.includes('month='), { timeout: 25000 });
  check('可以跳回本月', true);

  check('導覽列有月結算分頁', (await page.getByRole('link', { name: '月結算' }).count()) >= 1);

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
  // 用 testid 而不是連結的無障礙名稱：名稱是「圖示徽章 + 文字」拼出來的，
  // 動一下版面順序就變，測試會為了排版變動而假失敗
  check('導覽列顯示未結清數量', (await page.getByTestId('open-count').innerText()) === '1');

  await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '標記結清' }).click();
  await page.getByText('都結清了').waitFor({ timeout: 25000 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await homeReady(page);
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
  await openForm(page);
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
  await openForm(page);
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

  /**
   * 口語輸入。沒設 DEEPSEEK_API_KEY 就跳過而不是算失敗 ——
   * 這支腳本要能在沒有金鑰的環境跑完（例如別人 clone 下來）。
   * 只打一次 API，成本可以忽略。
   */
  console.log('\n【口語輸入】');
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('  － 沒有 DEEPSEEK_API_KEY，跳過');
  } else {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await homeReady(page);
    await page.getByPlaceholder('用講的：剛剛午餐 150').fill(`${MARK} 今天中午吃便當 123 元`);
    await page.getByRole('button', { name: '送出' }).click();

    // 解析大約 1～1.5 秒，給寬一點；填進表單才算成功
    await page.waitForFunction(
      () => document.querySelector('input[name="amount"]')?.value === '123',
      null,
      { timeout: 30000 },
    );
    check('一句話能解析出金額並填進表單', true);
    check('解析完會顯示原句讓人核對', await page.getByText(/聽成這樣/).isVisible());

    const rawBefore = await sql`
      select accepted from raw_inputs where text = ${`${MARK} 今天中午吃便當 123 元`}
      order by created_at desc limit 1`;
    check('原句有存下來，且還沒標記採用', rawBefore.length === 1 && rawBefore[0].accepted === false);

    // 備註蓋掉 AI 寫的，測試資料才帶得上 [E2E] 標記、跑完清得掉
    await openMarks(page);
    await page.getByPlaceholder('備註（可留空）').fill(`${MARK} 口語輸入`);
    await page.getByRole('button', { name: '記一筆' }).click();
    await page.getByText('記好了').waitFor({ timeout: 25000 });

    const [saved] = await sql`
      select amount::float8 as amount, source, raw_input_id
      from transactions where note = ${MARK + ' 口語輸入'} limit 1`;
    check('確認後才寫進資料庫，金額正確', Boolean(saved) && saved.amount === 123);
    check('來源標記成 web_agent', saved?.source === 'web_agent');
    check('交易指得回原句', Boolean(saved?.raw_input_id));

    const rawAfter = await sql`
      select accepted from raw_inputs where id = ${saved?.raw_input_id ?? null}`;
    check('採用之後原句被標記成 accepted', rawAfter[0]?.accepted === true);

    // 看不懂的句子不該預填任何東西，也不該把手動填到一半的東西清掉
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await openForm(page);
    await page.getByPlaceholder('0', { exact: true }).fill('77');
    await page.getByPlaceholder('用講的：剛剛午餐 150').fill(`${MARK} 今天天氣真好`);
    await page.getByRole('button', { name: '送出' }).click();
    await page.getByText(/看不太出來/).waitFor({ timeout: 30000 });
    check('看不懂的句子不會硬記一筆', true);
    check(
      '解析失敗不會清掉手動填到一半的金額',
      (await page.getByPlaceholder('0', { exact: true }).inputValue()) === '77',
    );
  }

  /**
   * LINE 記帳。不需要真的 LINE 帳號 —— 自己用 channel secret 簽一份 webhook
   * 打進 /api/line，再開一台假的 LINE 伺服器接回覆，就能把整條路走完。
   */
  console.log('\n【LINE 記帳】');
  if (!process.env.DEEPSEEK_API_KEY || !process.env.LINE_CHANNEL_SECRET || !process.env.LINE_USER_ID) {
    console.log('  － 缺 DEEPSEEK_API_KEY 或 LINE 設定，跳過');
  } else {
    const replies = [];
    const fakeLine = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          replies.push({ path: req.url, ...JSON.parse(body) });
        } catch {
          replies.push({ path: req.url, raw: body });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise((r) => fakeLine.listen(3999, '127.0.0.1', r));

    const say = async (text, { signed = true, userId = process.env.LINE_USER_ID } = {}) => {
      const payload = JSON.stringify({
        destination: 'Utest',
        events: [
          {
            type: 'message',
            message: { type: 'text', id: '1', text },
            source: { type: 'user', userId },
            replyToken: 'reply-token-test',
            mode: 'active',
          },
        ],
      });
      const signature = signed
        ? createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(payload).digest('base64')
        : 'this-is-not-a-valid-signature';
      const before = replies.length;
      const res = await fetch(`${BASE}/api/line`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-signature': signature },
        body: payload,
      });
      return { status: res.status, reply: replies[before]?.messages?.[0]?.text ?? null };
    };

    /*
     * 這一段的「改成」「刪掉」是對『最近一筆 LINE 紀錄』動手的，
     * 而那一筆有可能是 Gino 自己剛剛用 LINE 記的真帳。
     *
     * 2026-08-21 就這樣刪掉過他早上記的一筆晚餐 20 元 ——
     * 測試資料刪完之後又送了一次「刪掉」去驗『沒東西可刪』，
     * 結果指令往下找，找到的就是真的那筆。
     *
     * 所以：先數清楚帳本裡有沒有「不是 [E2E] 的、12 小時內的」LINE 紀錄。
     * 有的話，會誤傷的那幾項一律跳過，不是想辦法繞過去。
     * 測試絕對不可以碰到真的帳，寧可少驗一項。
     */
    const realLine = await sql`
      select count(*)::int as n from transactions
      where source = 'line'
        and created_at > now() - interval '12 hours'
        and (raw_input_id is null
             or raw_input_id not in (select id from raw_inputs where text like ${MARK + '%'}))`;
    const hasRealLine = realLine[0].n > 0;
    if (hasRealLine) {
      console.log(`  － 帳本裡有 ${realLine[0].n} 筆真的 LINE 紀錄，會動到它的項目跳過`);
    }

    try {
      const bad = await say('午餐 55', { signed: false });
      check('簽章不對就擋下來', bad.status === 401);

      const stranger = await say(`${MARK} 午餐 55`, { userId: 'Usomeone-else' });
      // 只數自己的測試資料。整張表的 source='line' 會把 Gino 真的紀錄也數進來
      const strangerRows = await sql`
        select count(*)::int as n from transactions
        where source = 'line'
          and raw_input_id in (select id from raw_inputs where text like ${MARK + '%'})`;
      check(
        '別人傳訊息不會被記帳',
        stranger.status === 200 && stranger.reply === null && strangerRows[0].n === 0,
      );

      const recorded = await say(`${MARK} 今天午餐花了 55`);
      const [row] = await sql`
        select id, amount::float8 as amount, kind, source, is_estimated, raw_input_id
        from transactions where source = 'line' order by created_at desc limit 1`;
      check('LINE 傳一句話就記一筆', Boolean(row) && row.amount === 55 && row.kind === 'expense');
      check('回覆訊息說得出記了什麼', /記好了/.test(recorded.reply ?? ''));
      check('原句有存下來並標記採用', Boolean(row?.raw_input_id));

      // 最近一筆必須是自己剛剛記的那筆，才敢對它下「改成」「刪掉」
      const [mine] = row?.raw_input_id
        ? await sql`select id from raw_inputs where id = ${row.raw_input_id} and text like ${MARK + '%'}`
        : [];

      if (!row) {
        // 沒記成功就別再往下戳，後面每一項都會踩到 undefined 讓整支腳本中斷
        check('LINE 後續檢查（記帳沒成功，跳過）', false, recorded.reply ?? '沒有回覆');
      } else if (!mine) {
        // 走到這裡代表最近一筆不是我們插進去的，那「改成／刪掉」會打到別人身上
        console.log('  － 最近一筆 LINE 紀錄不是這次測試記的，改／刪那幾項跳過');
      } else {
      const amended = await say('改成 88');
      const [after] = await sql`
        select amount::float8 as amount, is_estimated from transactions where id = ${row.id}`;
      const revisions = await sql`
        select count(*)::int as n from transaction_revisions where transaction_id = ${row.id}`;
      check('回「改成 88」會改掉金額', after.amount === 88);
      check('改金額有寫進稽核表', revisions[0].n === 1);
      check('回覆說得出改成多少', /88/.test(amended.reply ?? ''));

      const removed = await say('刪掉');
      const left = await sql`select count(*)::int as n from transactions where id = ${row.id}`;
      check('回「刪掉」就把那筆刪掉', left[0].n === 0);
      check('刪掉也會回一句', /刪掉了/.test(removed.reply ?? ''));

      if (hasRealLine) {
        // 這一項一定要在「一筆 LINE 紀錄都不剩」的狀態下驗，
        // 有真帳在的時候驗它，等於叫系統去刪 Gino 的東西
        console.log('  － 「沒有東西可刪」這項會刪到真的紀錄，跳過');
      } else {
        const nothing = await say('刪掉');
        check('沒有東西可刪時不會炸掉', nothing.status === 200 && /沒有/.test(nothing.reply ?? ''));
      }

      const help = await say('說明');
      check('回「說明」看得到用法', /記帳/.test(help.reply ?? ''));
      }
    } finally {
      await new Promise((r) => fakeLine.close(r));
    }

    console.log('\n【每日提醒】');
    const noAuth = await fetch(`${BASE}/api/cron/reminder`);
    check('提醒端點沒有密碼打不動', noAuth.status === 401);
  }

  console.log('\n【畫面截圖】');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await homeReady(page);
  await page.screenshot({ path: 'screenshots/desktop-home.png', fullPage: true });

  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p2.getByPlaceholder('密碼').fill(process.env.APP_PASSWORD);
  await p2.getByRole('button', { name: '進入' }).click();
  await homeReady(p2, 25000);
  check('iPhone 尺寸下也能登入並看到記帳頁', true);
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
