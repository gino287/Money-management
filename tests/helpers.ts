import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

import { defaultCategoryRows } from '../src/db/default-categories';
import { hashPassword } from '../src/lib/auth';
import { currentMonth, monthRange } from '../src/lib/format';

/**
 * 測試打的是 Gino 的真實資料庫，所以所有測試資料都要能認出來、能清掉。
 * 備註與標題一律帶這個前綴，清理只刪帶前綴的列，絕不 truncate。
 */
export const MARK = '[E2E]';

/**
 * 測試自己的連線也要省著用。預設 max 是 10 且不會閒置回收，
 * 測試中途被中斷時這些連線會留在 pooler 上不放，累積幾次之後
 * 整個 pooler 就開始讓人排隊，症狀是應用程式無限轉圈。
 */
export const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

/**
 * 主要帳號 —— 也就是 Gino 自己那本帳。改造時用 APP_PASSWORD 開的，
 * 所以測試沿用同一組（見 src/db/migrate-multiuser.ts）。
 */
export const OWNER_NAME = process.env.OWNER_NAME?.trim() || 'Gino';
export const OWNER_PASSWORD = process.env.APP_PASSWORD!;

/** 「看不看得到別人的帳」要有第二個人才驗得了。名字帶 MARK，跑完一起刪掉 */
export const OTHER_NAME = `${MARK}另一個人`;
export const OTHER_PASSWORD = 'e2e-other-password';

export async function cleanup() {
  await sql`delete from transactions where note like ${MARK + '%'}`;
  await sql`delete from settlements where title like ${MARK + '%'}`;
  await sql`delete from categories where name like ${MARK + '%'}`;

  /*
   * 測試用的第二個人，連同他名下的所有東西。
   *
   * 順序不能反：user_id 的外鍵是 restrict（刻意的，見 schema.ts），
   * 先刪 users 會直接被資料庫擋下來。交易要排在待結清前面，
   * 因為交易上的 settlement_id 指著待結清項目。
   */
  const [other] = await sql<{ id: string }[]>`select id from users where name = ${OTHER_NAME}`;
  if (!other) return;

  await sql`delete from transactions where user_id = ${other.id}`;
  await sql`delete from raw_inputs where user_id = ${other.id}`;
  await sql`delete from settlements where user_id = ${other.id}`;
  await sql`delete from categories where user_id = ${other.id}`;
  await sql`delete from users where id = ${other.id}`;
}

/**
 * 開一個測試用的帳號，附上預設分類（跟 npm run user -- add 做的事一樣）。
 * 清理是在 afterAll 才做的，所以中間每一個測試呼叫它都要拿到同一個人。
 */
export async function createOtherUser(): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from users where name = ${OTHER_NAME}`;
  if (existing) return existing.id;

  const [user] = await sql<{ id: string }[]>`
    insert into users (name, password_hash)
    values (${OTHER_NAME}, ${await hashPassword(OTHER_PASSWORD)})
    returning id`;

  for (const row of defaultCategoryRows(user.id)) {
    await sql`
      insert into categories (user_id, name, kind, is_fixed, sort_order)
      values (${row.userId}, ${row.name}, ${row.kind}, ${row.isFixed}, ${row.sortOrder})`;
  }

  return user.id;
}

export async function login(page: Page, name = OWNER_NAME, password = OWNER_PASSWORD) {
  await page.goto('/login');
  await page.getByPlaceholder('名字').fill(name);
  await page.getByPlaceholder('密碼').fill(password);
  await page.getByRole('button', { name: '進入' }).click();
  await expect(page.getByRole('link', { name: '明細' })).toBeVisible();
}

/**
 * 分類按鈕不能用 exact 比對：固定支出的分類（房租、壇費）名稱後面
 * 還跟著一個「固定」標籤，可讀名稱其實是「房租 固定」。
 */
export function categoryButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: false });
}

/** 明細頁的搜尋與分類篩選也是收起來的，同上 */
export async function openFilters(page: Page) {
  const filters = page.locator('details').first();
  if (!(await filters.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await filters.locator('summary').click();
  }
}

/** 備註與標記預設是收起來的，要先打開才點得到裡面的東西 */
export async function openMarks(page: Page) {
  const marks = page.locator('form details').first();
  if (!(await marks.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await marks.locator('summary').click();
  }
}

type Entry = {
  kind?: '支出' | '收入' | '暫付款';
  amount?: string;
  category: string;
  note: string;
  estimated?: boolean;
  communal?: boolean;
  date?: '今天' | '昨天' | '前天';
};

/**
 * 首頁的手動表單預設是收起來的（2026-08-20 那次「首頁收乾淨」之後），
 * 要先按「自己填」才展開。
 *
 * **一定要真的展開，不能靠 Playwright 說它看得見。** 收起來時外層 grid
 * 把高度壓成 0，但按鈕自己的 bounding box 還在，所以 Playwright 回報
 * 「看得見」（見《踩過的雷》）；而收起來時整塊是 `inert`，點下去會穿透過去
 * 被別的元素接走，症狀是 `click` 一直重試到逾時、錯誤訊息說
 * 「something intercepts pointer events」。
 *
 * scripts/verify.mjs 從那天起就有這一段，這裡漏掉了 —— 所以這套 Playwright
 * 驗收從 2026-08-20 起就一直是壞的，直到 2026-08-26 才發現。
 */
export async function openManualForm(page: Page) {
  const toggle = page.getByRole('button', { name: '自己填' });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await expect(page.getByRole('button', { name: '收起來' })).toBeVisible();
  }
}

/** 用首頁的快速記帳表單記一筆，走的是使用者真正會走的路徑 */
export async function record(page: Page, entry: Entry) {
  await page.goto('/');
  await openManualForm(page);

  if (entry.kind && entry.kind !== '支出') {
    await page.getByRole('button', { name: entry.kind, exact: true }).click();
  }
  if (entry.date && entry.date !== '今天') {
    await page.getByRole('button', { name: entry.date, exact: true }).click();
  }
  // 開伙是表單上的一種性質（存進資料庫仍是 expense + is_communal）
  if (entry.communal) {
    await page.getByRole('button', { name: '開伙', exact: true }).click();
  } else {
    await page.getByPlaceholder('0', { exact: true }).fill(entry.amount!);
  }

  await categoryButton(page, entry.category).click();

  await openMarks(page);
  if (entry.estimated) await page.getByLabel('估算金額').check();
  await page.getByPlaceholder('備註（可留空）').fill(`${MARK} ${entry.note}`);
  await page.getByRole('button', { name: '記一筆' }).click();

  await expect(page.getByText('記好了')).toBeVisible({ timeout: 15_000 });
}

/* ─────────────────────────────────────────── 以「你原本就有的帳」為基準 ─── */

/**
 * 這些測試打的是 Gino 真正的帳本，裡面已經有四百筆帳。
 *
 * 所以畫面上的數字**永遠不可以寫死**。「固定支出應該顯示 6,000」那種寫法
 * 只有在帳本全空時才成立 —— 實際上會看到 17,700（他八月本來就有 11,700 房租壇費）。
 * 《踩過的雷》2026-08-21 記過這件事，但當時只修了 scripts/verify.mjs，
 * 這套 Playwright 一直沒跟上，到 2026-08-26 才補。
 *
 * 正確的問法是「記完之後，畫面上的數字有沒有跟資料庫對得起來」，
 * 以及「這一筆讓哪個數字動了多少」。
 */
export type MonthTotals = {
  variable: number;
  fixed: number;
  income: number;
  advance: number;
  communal: number;
};

/** 主要帳號這個月的各項合計，直接從資料庫算，規則跟 src/lib/queries.ts 一致 */
export async function monthTotals(): Promise<MonthTotals> {
  const { start, end } = monthRange(currentMonth());
  const [row] = await sql<MonthTotals[]>`
    select
      coalesce(sum(t.amount) filter (where t.kind = 'expense' and not t.is_fixed), 0)::float8 as variable,
      coalesce(sum(t.amount) filter (where t.kind = 'expense' and t.is_fixed), 0)::float8 as fixed,
      coalesce(sum(t.amount) filter (where t.kind = 'income'), 0)::float8 as income,
      coalesce(sum(t.amount) filter (where t.kind = 'advance'), 0)::float8 as advance,
      count(*) filter (where t.is_communal)::int as communal
    from transactions t
    join users u on u.id = t.user_id
    where u.name = ${OWNER_NAME} and t.date >= ${start} and t.date < ${end}`;
  return row;
}

/**
 * 首頁會提醒的待結清筆數。
 *
 * 不是「所有沒結清的」，是「該追的」—— 押金那種還早的不會出現在首頁
 * （規則見 src/lib/queries.ts 的 isDue，這裡是同一條的 SQL 版）。
 */
export async function dueSettlementCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
    from settlements s
    join users u on u.id = s.user_id
    where u.name = ${OWNER_NAME}
      and s.status = 'open'
      and (s.due_month is null or s.due_month <= ${currentMonth()})`;
  return row.n;
}
