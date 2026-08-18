import { expect, test } from '@playwright/test';

import { categoryButton, cleanup, login, MARK, openFilters, record, sql } from './helpers';

/**
 * 驗收清單來自實作計畫的「驗收方式」一節。
 * 每一條對應規格書上一條不能變的規則。
 */

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('未登入時所有頁面都會被擋下來', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/transactions');
  await expect(page).toHaveURL(/\/login\?next=%2Ftransactions/);
  // 登入後要回到原本想去的頁面，不是一律丟回首頁
  await page.getByPlaceholder('密碼').fill(process.env.APP_PASSWORD!);
  await page.getByRole('button', { name: '進入' }).click();
  await expect(page).toHaveURL(/\/transactions/);
});

test('密碼錯誤不會放行', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login');
  await page.getByPlaceholder('密碼').fill('definitely-not-the-password');
  await page.getByRole('button', { name: '進入' }).click();
  await expect(page.getByText('密碼不對')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('五種性質的帳都記得起來，月結算分開計算', async ({ page }) => {
  await record(page, { category: '餐食', amount: '150', note: '午餐' });
  await record(page, { category: '房租', amount: '6000', note: '房租' });
  await record(page, { category: '食材採買', communal: true, note: '開伙' });
  await record(page, { category: '醫療', amount: '800', note: '估算', estimated: true });
  await record(page, { kind: '暫付款', category: '雜支', amount: '500', note: '幫同學代墊' });
  await record(page, { kind: '收入', category: '工讀薪水', amount: '12000', note: '薪水' });

  // 資料層：規格書 2.2 的三條紅線
  const rows = await sql<
    { kind: string; amount: string; is_fixed: boolean; is_communal: boolean; is_estimated: boolean; note: string }[]
  >`select kind, amount, is_fixed, is_communal, is_estimated, note
      from transactions where note like ${MARK + '%'} order by amount`;

  expect(rows).toHaveLength(6);

  const byNote = (s: string) => rows.find((r) => r.note.includes(s))!;

  expect(Number(byNote('開伙').amount)).toBe(0);
  expect(byNote('開伙').is_communal).toBe(true);

  expect(byNote('幫同學代墊').kind).toBe('advance');
  expect(byNote('房租').is_fixed).toBe(true);
  expect(byNote('午餐').is_fixed).toBe(false);
  expect(byNote('估算').is_estimated).toBe(true);

  // 畫面層：暫付款不可以被算進支出
  await page.goto('/');
  const summary = page.getByTestId('month-summary');
  await expect(summary).toContainText('6,000'); // 固定支出
  await expect(summary).toContainText('12,000'); // 收入
  await expect(summary).toContainText('500'); // 暫付款獨立一格
  await expect(page.getByText('開伙 1 次')).toBeVisible();

  // 變動支出 = 150 + 800，開伙的 0 不影響，暫付款 500 不併入
  await expect(summary).toContainText('950');
});

test('改估算金額會直接覆蓋，並留下修改紀錄', async ({ page }) => {
  await record(page, { category: '醫療', amount: '800', note: '牙醫估算', estimated: true });

  await page.goto('/transactions');
  await page.getByRole('link', { name: /牙醫估算/ }).click();

  await page.getByPlaceholder('0', { exact: true }).fill('1250');
  await page.getByLabel('估算金額').uncheck();
  await page.getByRole('button', { name: '儲存修改' }).click();

  await expect(page).toHaveURL(/\/transactions/);

  const [row] = await sql<{ amount: string; is_estimated: boolean; id: string }[]>`
    select id, amount, is_estimated from transactions where note like ${MARK + '%牙醫估算%'}`;
  expect(Number(row.amount)).toBe(1250);
  expect(row.is_estimated).toBe(false);

  // 主表只留一筆乾淨資料，舊值在稽核表
  const revisions = await sql`select * from transaction_revisions where transaction_id = ${row.id}`;
  expect(revisions).toHaveLength(1);

  await page.goto(`/transactions/${row.id}`);
  await expect(page.getByText('改過 1 次')).toBeVisible();
  await expect(page.getByText('金額：800 → 1,250')).toBeVisible();
  await expect(page.getByText('估算：是 → 否')).toBeVisible();
});

test('待結清項目不結清就一直看得到', async ({ page }) => {
  await page.goto('/settlements');
  await page.getByRole('button', { name: '＋ 新增待結清項目' }).click();
  await page.getByPlaceholder(/押金待回收/).fill(`${MARK} 押金待回收`);
  await page.getByPlaceholder(/預計金額/).fill('8000');
  await page.getByRole('button', { name: '新增待結清' }).click();

  await expect(page.getByText(`${MARK} 押金待回收`)).toBeVisible();

  // 首頁常駐提醒
  await page.goto('/');
  await expect(page.getByText(/還有 1 筆沒結清/)).toBeVisible();
  await expect(page.getByText('押金待回收')).toBeVisible();

  // 導覽列上的數字
  await expect(page.getByRole('link', { name: /待結清\s*1/ })).toBeVisible();

  // 手動結清後才消失
  await page.goto('/settlements');
  await page.getByRole('button', { name: '標記結清' }).click();
  await expect(page.getByText('都結清了')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText(/還有 .* 筆沒結清/)).toHaveCount(0);

  // 按錯要能還原
  await page.goto('/settlements');
  await page.getByRole('button', { name: '還原' }).click();
  await expect(page.getByRole('button', { name: '標記結清' })).toBeVisible();
});

test('停用分類不影響舊紀錄', async ({ page }) => {
  await page.goto('/categories');
  await page.getByPlaceholder('新分類名稱').fill(`${MARK}臨時分類`);
  await page.getByRole('button', { name: '新增' }).click();
  await expect(categoryButton(page, `${MARK}臨時分類`)).toBeVisible();

  await record(page, { category: `${MARK}臨時分類`, amount: '99', note: '用臨時分類記的' });

  // 停用
  await page.goto('/categories');
  const row = page.locator('li').filter({ hasText: `${MARK}臨時分類` });
  await row.getByRole('button', { name: '停用' }).click();
  await expect(row.getByText('已停用')).toBeVisible();
  await expect(row.getByText('用過 1 筆')).toBeVisible();

  // 新增表單不再出現，但舊紀錄照常顯示分類名稱
  await page.goto('/');
  await expect(categoryButton(page, `${MARK}臨時分類`)).toHaveCount(0);

  await page.goto('/transactions');
  await expect(page.getByText(`${MARK}臨時分類`)).toBeVisible();
});

test('明細可以依性質與備註篩選，合計跟著篩選走', async ({ page }) => {
  await record(page, { category: '餐食', amount: '150', note: '篩選用午餐' });
  await record(page, { kind: '收入', category: '家人給的', amount: '3000', note: '篩選用收入' });

  await page.goto('/transactions');
  await page.getByRole('link', { name: '收入', exact: true }).click();
  await expect(page.getByText('篩選用收入')).toBeVisible();
  await expect(page.getByText('篩選用午餐')).toHaveCount(0);

  await page.goto('/transactions');
  await openFilters(page);
  await page.getByPlaceholder('搜尋備註').fill('篩選用午餐');
  await page.getByRole('button', { name: '搜尋' }).click();
  await expect(page.getByText('篩選用午餐')).toBeVisible();
  await expect(page.getByText('篩選用收入')).toHaveCount(0);
});

test('刪除一筆之後就不在清單裡', async ({ page }) => {
  await record(page, { category: '雜支', amount: '45', note: '要被刪掉的' });

  await page.goto('/transactions');
  await page.getByRole('link', { name: /要被刪掉的/ }).click();
  await page.getByRole('button', { name: '刪除這筆' }).click();

  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByText('要被刪掉的')).toHaveCount(0);
});

test('金額欄位擋得住亂填', async ({ page }) => {
  await page.goto('/');
  await categoryButton(page, '餐食').click();
  await page.getByPlaceholder('0', { exact: true }).fill('abc');
  await page.getByRole('button', { name: '記一筆' }).click();
  await expect(page.getByText('請填金額')).toBeVisible();

  await page.getByPlaceholder('0', { exact: true }).fill('-50');
  await page.getByRole('button', { name: '記一筆' }).click();
  await expect(page.getByText(/金額不能是負數/)).toBeVisible();
});

test('沒選分類不會硬記進去', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('0', { exact: true }).fill('100');
  await page.getByRole('button', { name: '記一筆' }).click();
  await expect(page.getByText('請選一個分類')).toBeVisible();
});
