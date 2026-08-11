import { sql } from 'drizzle-orm';

import { db } from '@/db';

/**
 * 診斷用：回報這台伺服器在哪個機房、連資料庫要花多久。
 *
 * 刻意不需要登入 —— 登不進去的時候才最需要它。回傳的內容只有機房代號
 * 與毫秒數，沒有任何帳務資料。診斷完就可以把這支檔案刪掉。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const region = process.env.VERCEL_REGION ?? '本機';

  const runs: number[] = [];
  let error: string | null = null;

  try {
    // 跑三次取中位數，避免第一次連線的建立成本失真
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      await db.execute(sql`select 1`);
      runs.push(Date.now() - started);
    }
  } catch (e) {
    error = (e as Error).message;
  }

  const sorted = [...runs].sort((a, b) => a - b);

  return Response.json({
    機房: region,
    資料庫來回毫秒: runs,
    中位數: sorted[Math.floor(sorted.length / 2)] ?? null,
    判讀:
      error !== null
        ? '連不上資料庫'
        : (sorted[1] ?? 999) < 30
          ? '很好，機房跟資料庫在同一區'
          : (sorted[1] ?? 999) < 80
            ? '可以接受'
            : '太慢了，機房跟資料庫大概不在同一洲',
    錯誤: error,
  });
}
