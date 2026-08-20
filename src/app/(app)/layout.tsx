import { Nav } from '@/components/Nav';
import { getSettlements, isDue } from '@/lib/queries';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  /**
   * 待結清數量放在導覽列上，走到哪一頁都看得到（規格書 2.2 的漏記痛點）。
   * getSettlements 有 React cache 包著，首頁同時也要用這份資料時只會查一次。
   *
   * 只算「該追的」：押金要等到 2027 年退租，讓那個 3 一直掛在導覽列上，
   * 兩個星期後就變成背景，真正該追的那筆反而被淹掉。
   */
  const open = (await getSettlements('open')).filter((s) => isDue(s));

  return (
    <div className="flex min-h-dvh flex-col sm:flex-col-reverse sm:justify-end">
      {/*
        pad-top 是 iPhone 的安全區。從主畫面開啟時是全螢幕，
        沒墊這一段的話最上面那一行會被時間、訊號、電量圖示壓到。
      */}
      <main className="pad-top mx-auto w-full max-w-2xl flex-1 px-4 pb-10">{children}</main>
      <Nav openCount={open.length} />
    </div>
  );
}
