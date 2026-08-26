import { formatMonth } from '@/lib/format';
import { getTransactions } from '@/lib/queries';
import { currentUser } from '@/lib/session';

/**
 * 把帳匯出成 CSV。`?month=YYYY-MM` 匯出單月，不帶就是全部。
 *
 * 這支**沒有**放進 src/proxy.ts 的放行清單，所以一樣要登入才打得開 ——
 * 它會吐出全部的帳，是這個系統裡最不該公開的端點。
 * 多人之後「全部」的意思是**你自己的全部**，不是所有人的。
 *
 * 為什麼是 CSV 不是 xlsx：xlsx 要多背一個套件，而 Excel、Numbers、
 * Google 試算表都直接開得了 CSV。等 P5 真的要做 Excel 匯入時再一起處理。
 */
export const dynamic = 'force-dynamic';

const KIND_LABEL = { expense: '支出', income: '收入', advance: '暫付款' } as const;

/** RFC 4180：含逗號、引號、換行的欄位要用引號包起來，裡面的引號寫兩次 */
function cell(value: string | number | null): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  /*
   * 這裡用 currentUser 回 401，不是 requireUser 導去登入頁 ——
   * 這支是拿來下載檔案的，導頁的結果是存下一個叫「記帳.csv」的登入頁 HTML。
   */
  const user = await currentUser();
  if (!user) return new Response('請先登入', { status: 401 });

  const month = new URL(request.url).searchParams.get('month');
  const valid = month && /^\d{4}-\d{2}$/.test(month) ? month : undefined;

  const rows = await getTransactions(user.id, valid ? { month: valid } : {});

  const header = ['日期', '性質', '分類', '金額', '固定支出', '開伙', '估算', '備註'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.date,
        KIND_LABEL[r.kind],
        r.categoryName,
        r.amount,
        r.isFixed ? '是' : '',
        r.isCommunal ? '是' : '',
        r.isEstimated ? '是' : '',
        r.note ?? '',
      ]
        .map(cell)
        .join(','),
    ),
  ];

  /*
   * 開頭的 \uFEFF 是 UTF-8 BOM。Windows 版 Excel 沒有它會把中文當成 Big5 解，
   * 開出來整片亂碼 —— 這是匯出中文 CSV 最常見的抱怨，一個字元就能避免。
   * 換行用 CRLF，同樣是為了 Excel。
   */
  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  const name = `記帳-${valid ? formatMonth(valid).replaceAll(' ', '') : '全部'}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // 檔名有中文，要用 RFC 5987 的寫法，不然瀏覽器會存成亂碼
      'Content-Disposition': `attachment; filename="ledger.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
