import { toggleCategoryActive, toggleCategoryFixed } from '@/app/actions/categories';
import { CategoryForm } from '@/components/CategoryForm';
import { CategoryName } from '@/components/CategoryName';
import { getCategories, getCategoryUsage } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const [categories, usage] = await Promise.all([
    getCategories({ activeOnly: false }),
    getCategoryUsage(),
  ]);

  const groups = [
    { kind: 'expense' as const, label: '支出' },
    { kind: 'income' as const, label: '收入' },
  ];

  return (
    <div className="space-y-6">
      <header className="px-1">
        <h1 className="text-sm">分類</h1>
        <p className="mt-1 text-xs text-text-faint">
          不用的分類請停用而不是刪掉，這樣舊紀錄才不會失去分類。
        </p>
      </header>

      <CategoryForm />

      {groups.map((group) => (
        <section key={group.kind}>
          <h2 className="mb-2 px-1 text-sm text-text-muted">{group.label}</h2>
          <ul className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
            {categories
              .filter((c) => c.kind === group.kind)
              .map((c) => {
                const used = usage.get(c.id) ?? 0;
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 ${
                      c.isActive ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <CategoryName id={c.id} name={c.name} />
                      <p className="mt-0.5 text-xs text-text-faint">
                        {used === 0 ? '還沒用過' : `用過 ${used} 筆`}
                        {!c.isActive && ' · 已停用'}
                      </p>
                    </div>

                    {group.kind === 'expense' && (
                      <form action={toggleCategoryFixed}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          title="固定支出在月結算時跟變動支出分開計算"
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            c.isFixed
                              ? 'border-accent/40 text-accent'
                              : 'border-border text-text-faint hover:text-text-muted'
                          }`}
                        >
                          固定
                        </button>
                      </form>
                    )}

                    <form action={toggleCategoryActive}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="shrink-0 text-xs text-text-faint transition-colors hover:text-text-muted"
                      >
                        {c.isActive ? '停用' : '啟用'}
                      </button>
                    </form>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <form method="post" action="/api/logout" className="border-t border-border pt-5">
        <button
          type="submit"
          className="w-full py-2 text-center text-xs text-text-faint transition-colors hover:text-text-muted"
        >
          登出
        </button>
      </form>
    </div>
  );
}
