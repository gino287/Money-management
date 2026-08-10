import { Nav } from '@/components/Nav';
import { getSettlements } from '@/lib/queries';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  /**
   * 待結清數量放在導覽列上，走到哪一頁都看得到（規格書 2.2 的漏記痛點）。
   * getSettlements 有 React cache 包著，首頁同時也要用這份資料時只會查一次。
   */
  const open = await getSettlements('open');

  return (
    <div className="flex min-h-dvh flex-col sm:flex-col-reverse sm:justify-end">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-8">{children}</main>
      <Nav openCount={open.length} />
    </div>
  );
}
