import { eq, sql } from 'drizzle-orm';

import { Nav } from '@/components/Nav';
import { db } from '@/db';
import { settlements } from '@/db/schema';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // 待結清數量放在導覽列上，走到哪一頁都看得到（規格書 2.2 的漏記痛點）
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(settlements)
    .where(eq(settlements.status, 'open'));

  return (
    <div className="flex min-h-dvh flex-col sm:flex-col-reverse sm:justify-end">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-8">{children}</main>
      <Nav openCount={count} />
    </div>
  );
}
