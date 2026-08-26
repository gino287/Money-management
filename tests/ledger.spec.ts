import { expect, test } from '@playwright/test';

import { formatAmount } from '../src/lib/format';

import {
  categoryButton,
  cleanup,
  createOtherUser,
  dueSettlementCount,
  login,
  MARK,
  monthTotals,
  openFilters,
  openManualForm,
  OTHER_NAME,
  OTHER_PASSWORD,
  OWNER_NAME,
  OWNER_PASSWORD,
  record,
  sql,
} from './helpers';

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
  await page.getByPlaceholder('名字').fill(OWNER_NAME);
  await page.getByPlaceholder('密碼').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: '進入' }).click();
  await expect(page).toHaveURL(/\/transactions/);
});

test('密碼錯誤不會放行', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login');
  await page.getByPlaceholder('名字').fill(OWNER_NAME);
  await page.getByPlaceholder('密碼').fill('definitely-not-the-password');
  await page.getByRole('button', { name: '進入' }).click();
  await expect(page.getByText('名字或密碼不對')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('名字不存在時，錯誤訊息跟密碼打錯時一模一樣', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login');
  await page.getByPlaceholder('名字').fill('根本沒有這個人');
  await page.getByPlaceholder('密碼').fill('whatever');
  await page.getByRole('button', { name: '進入' }).click();
  // 訊息不一樣的話，等於免費告訴外面哪些名字是存在的
  await expect(page.getByText('名字或密碼不對')).toBeVisible();
});

test('五種性質的帳都記得起來，月結算分開計算', async ({ page }) => {
  // 先記下「原本就有多少」。這些測試打的是真的帳本，數字不能寫死（見 helpers.ts）
  const before = await monthTotals();

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

  /*
   * 這六筆讓每一格各動了多少 —— 這才是規格書 2.2 真正要保證的事：
   * 固定跟變動不會互相污染、暫付款不併入支出、開伙的 0 元不影響金額。
   */
  const after = await monthTotals();
  expect(after.fixed - before.fixed).toBe(6000); // 房租
  expect(after.variable - before.variable).toBe(950); // 150 + 800，開伙的 0 不影響
  expect(after.advance - before.advance).toBe(500); // 暫付款自己一格，沒混進支出
  expect(after.income - before.income).toBe(12000);
  expect(after.communal - before.communal).toBe(1);

  // 畫面層：顯示出來的數字要跟資料庫對得起來
  await page.goto('/');
  const summary = page.getByTestId('month-summary');
  await expect(summary).toContainText(formatAmount(after.fixed));
  await expect(summary).toContainText(formatAmount(after.income));
  await expect(summary).toContainText(formatAmount(after.advance));
  await expect(summary).toContainText(formatAmount(after.variable));
  // 只在月結算卡片裡面找 —— 首頁招呼底下那一行也會寫開伙次數（見《踩過的雷》）
  await expect(summary).toContainText(`開伙 ${after.communal} 次`);
});

test('改估算金額會直接覆蓋，並留下修改紀錄', async ({ page }) => {
  await record(page, { category: '醫療', amount: '800', note: '牙醫估算', estimated: true });

  await page.goto('/transactions');
  await page.getByRole('link', { name: /牙醫估算/ }).click();

  await page.getByPlaceholder('0', { exact: true }).fill('1250');
  await page.getByLabel('估算金額').uncheck();
  await page.getByRole('button', { name: '儲存修改' }).click();

  /*
   * 一定要等到真的回到明細頁。
   *
   * 原本寫 /\/transactions/，但那個樣式在 `/transactions/<id>` 上就已經成立 ——
   * 存檔還在進行中（按鈕上寫著「儲存中…」）測試就往下跑去查資料庫，
   * 讀到的當然還是舊金額。收尾的 $ 讓它只認明細頁本身。
   */
  await expect(page).toHaveURL(/\/transactions$/);

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
  // 帳本裡本來就有沒結清的，數字要以它為基準往上加
  const before = await dueSettlementCount();

  await page.goto('/settlements');
  await page.getByRole('button', { name: '＋ 新增待結清項目' }).click();
  await page.getByPlaceholder(/押金待回收/).fill(`${MARK} 押金待回收`);
  await page.getByPlaceholder(/預計金額/).fill('8000');
  await page.getByRole('button', { name: '新增待結清' }).click();

  await expect(page.getByText(`${MARK} 押金待回收`)).toBeVisible();

  /*
   * 首頁常駐提醒。文案是「有 N 筆該追了」——
   * 「還有 N 筆沒結清」是 LINE 每日提醒的用詞，不是畫面上的（測試以前抓錯了）。
   */
  await page.goto('/');
  await expect(page.getByText(`有 ${before + 1} 筆該追了`)).toBeVisible();

  // 導覽列上的數字。抓 testid 而不是連結的無障礙名稱 —— 那個名稱是
  // 圖示上的徽章加標籤拼出來的，順序會隨版面調整而變（見《踩過的雷》）
  await expect(page.getByTestId('open-count')).toHaveText(String(before + 1));

  /*
   * 手動結清後才消失。
   *
   * 按鈕一定要從「測試那一筆自己的那一列」裡面找 —— 帳本裡本來就有別的
   * 待結清項目，每一列都有一顆「標記結清」，直接 getByRole 會抓到一整把，
   * Playwright 的 strict mode 會拒絕動作（而且錯誤訊息長得完全看不出是這個原因）。
   */
  await page.goto('/settlements');
  const row = page.locator('li').filter({ hasText: `${MARK} 押金待回收` });
  await row.getByRole('button', { name: '標記結清' }).click();
  await expect(page.getByText(`${MARK} 押金待回收`)).toBeVisible();

  await page.goto('/');
  // 結清之後只剩原本就有的那幾筆。本來就是 0 的話，整個提醒都不該出現
  if (before === 0) {
    await expect(page.getByText(/筆該追了/)).toHaveCount(0);
  } else {
    await expect(page.getByText(`有 ${before} 筆該追了`)).toBeVisible();
  }
  await expect(page.getByTestId('open-count')).toHaveText(String(before));

  // 按錯要能還原
  await page.goto('/settlements');
  const settled = page.locator('li').filter({ hasText: `${MARK} 押金待回收` });
  await settled.getByRole('button', { name: '還原' }).click();
  await expect(settled.getByRole('button', { name: '標記結清' })).toBeVisible();
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
  // 手動表單預設收起來，收起來時是 inert 點不到（見 helpers.ts 的長註解）
  await openManualForm(page);
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
  await openManualForm(page);
  await page.getByPlaceholder('0', { exact: true }).fill('100');
  await page.getByRole('button', { name: '記一筆' }).click();
  await expect(page.getByText('請選一個分類')).toBeVisible();
});

/**
 * 多人的核心：兩本帳完全看不到對方。
 *
 * 這是整個多人改造唯一真正不能壞的一條 —— 其他地方壞掉是不方便，
 * 這裡壞掉是把一個人的錢攤在另一個人面前。
 */
test('另一個人看不到、也動不了你的帳', async ({ page, context }) => {
  await record(page, { category: '餐食', amount: '333', note: '只有本人看得到' });
  await record(page, { kind: '暫付款', category: '雜支', amount: '900', note: '只有本人的暫付款' });

  const [mine] = await sql<{ id: string }[]>`
    select id from transactions where note like ${MARK + '%只有本人看得到%'}`;
  expect(mine).toBeTruthy();

  await createOtherUser();
  await context.clearCookies();
  await login(page, OTHER_NAME, OTHER_PASSWORD);

  /*
   * 首頁：招呼語是自己的名字，而且看不到對方的任何一筆。
   *
   * 用 toContainText 而不是把名字塞進 getByRole 的 name 選項 ——
   * 那個選項會把字串當成正規表示式處理，而測試帳號的名字帶著 `[E2E]`，
   * 中括號在正規表示式裡是字元集合，比對永遠不會成立。
   */
  await expect(page.getByRole('heading', { level: 1 })).toContainText(OTHER_NAME);
  await expect(page.getByText('只有本人看得到')).toHaveCount(0);

  // 明細：一筆都撈不到
  await page.goto('/transactions');
  await expect(page.getByText('只有本人看得到')).toHaveCount(0);
  await expect(page.getByText('只有本人的暫付款')).toHaveCount(0);

  // 搜尋也翻不出來 —— 過濾條件不該變成繞過歸屬檢查的後門
  await openFilters(page);
  await page.getByPlaceholder('搜尋備註').fill('只有本人');
  await page.getByRole('button', { name: '搜尋' }).click();
  await expect(page.getByText('只有本人看得到')).toHaveCount(0);

  /*
   * 直接打對方那筆帳的網址：要看到「找不到」，不是那筆帳的內容。
   *
   * 檢查的是**畫面內容**不是 HTTP 狀態碼。這一頁是 force-dynamic 會串流，
   * 標頭（200）在伺服器跑到 notFound() 之前就已經送出去了，所以狀態碼永遠是 200 ——
   * 那是 Next 串流的性質，不是權限沒擋住。2026-08-26 特地拿真的第二個帳號驗過：
   * 頁面上沒有那筆備註、也沒有金額輸入框，渲染出來的就是找不到頁面。
   */
  await page.goto(`/transactions/${mine.id}`);
  await expect(page.getByText('只有本人看得到')).toHaveCount(0);
  await expect(page.locator('input[name="amount"]')).toHaveCount(0);

  // 匯出只匯自己的，對方的備註不會出現在 CSV 裡
  const csv = await page.request.get('/api/export');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).not.toContain('只有本人看得到');

  // 分類頁顯示的是自己那份，而且畫面上寫得出「現在是誰」
  await page.goto('/categories');
  await expect(page.getByText(`以 ${OTHER_NAME} 的身分登入中`)).toBeVisible();

  // 對方的帳一筆都沒被動到
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from transactions where note like ${MARK + '%只有本人%'}`;
  expect(count).toBe(2);
});

test('另一個人記的帳不會混進你的月結算', async ({ page, context }) => {
  await createOtherUser();
  await context.clearCookies();
  await login(page, OTHER_NAME, OTHER_PASSWORD);

  await record(page, { category: '餐食', amount: '777', note: '別人記的' });

  await context.clearCookies();
  await login(page);

  await page.goto('/transactions');
  await expect(page.getByText('別人記的')).toHaveCount(0);

  // 資料層再確認一次：那筆的確存在，只是掛在別人名下
  const [row] = await sql<{ name: string }[]>`
    select u.name from transactions t
    join users u on u.id = t.user_id
    where t.note like ${MARK + '%別人記的%'}`;
  expect(row.name).toBe(OTHER_NAME);
});
