/**
 * 每一頁最上面的標題。
 *
 * 存在的理由只有一個：一致。原本待結清跟分類頁是小小的 text-sm 標題，
 * 首頁跟月結算是大標，同一個 app 裡兩種輕重看起來像兩個人做的。
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  /** 標題右邊的東西，例如一顆「匯出」按鈕 */
  action?: React.ReactNode;
}) {
  return (
    <header className="pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl">{title}</h1>
        {action}
      </div>
      {description && <p className="mt-1.5 text-xs text-text-faint">{description}</p>}
    </header>
  );
}
