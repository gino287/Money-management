import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

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

export async function cleanup() {
  await sql`delete from transactions where note like ${MARK + '%'}`;
  await sql`delete from settlements where title like ${MARK + '%'}`;
  await sql`delete from categories where name like ${MARK + '%'}`;
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('密碼').fill(process.env.APP_PASSWORD!);
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

type Entry = {
  kind?: '支出' | '收入' | '暫付款';
  amount?: string;
  category: string;
  note: string;
  estimated?: boolean;
  communal?: boolean;
  date?: '今天' | '昨天' | '前天';
};

/** 用首頁的快速記帳表單記一筆，走的是使用者真正會走的路徑 */
export async function record(page: Page, entry: Entry) {
  await page.goto('/');

  if (entry.kind && entry.kind !== '支出') {
    await page.getByRole('button', { name: entry.kind, exact: true }).click();
  }
  if (entry.date && entry.date !== '今天') {
    await page.getByRole('button', { name: entry.date, exact: true }).click();
  }
  if (entry.communal) {
    await page.getByLabel('開伙').check();
  } else {
    await page.getByPlaceholder('0', { exact: true }).fill(entry.amount!);
  }
  if (entry.estimated) await page.getByLabel('估算金額').check();

  await categoryButton(page, entry.category).click();
  await page.getByPlaceholder('備註（可留空）').fill(`${MARK} ${entry.note}`);
  await page.getByRole('button', { name: '記一筆' }).click();

  await expect(page.getByText('記好了')).toBeVisible({ timeout: 15_000 });
}
