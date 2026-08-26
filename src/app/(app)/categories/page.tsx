import { toggleCategoryActive, toggleCategoryFixed } from '@/app/actions/categories';
import { CategoryForm } from '@/components/CategoryForm';
import { CategoryName } from '@/components/CategoryName';
import { PageHeader } from '@/components/PageHeader';
import { getCategories, getCategoryUsage } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const user = await requireUser();

  // 排隊查，不要一次開好幾條新連線（見首頁那段註解）
  const categories = await getCategories(user.id, { activeOnly: false });
  const usage = await getCategoryUsage(user.id);

  const groups = [
    { kind: 'expense' as const, label: '支出' },
    { kind: 'income' as const, label: '收入' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="分類"
        description="不用的分類請停用而不是刪掉，這樣舊紀錄才不會失去分類。"
      />

      <CategoryForm />

      {groups.map((group) => (
        <section key={group.kind}>
          <h2 className="mb-2 px-1 text-sm text-text-muted">{group.label}</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
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

      {/*
        多人之後這裡要寫出「現在是誰」。每個人的分類長得都不一樣，
        一打開看到一整排不認得的分類時，第一個該回答的問題就是
        「我是不是登錯人了」—— 讓答案就在同一個畫面上。
      */}
      <form method="post" action="/api/logout" className="border-t border-border pt-5">
        <button
          type="submit"
          className="w-full py-2 text-center text-xs text-text-faint transition-colors hover:text-text-muted"
        >
          以 {user.name} 的身分登入中 · 登出
        </button>
      </form>
    </div>
  );
}
