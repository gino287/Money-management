'use client';

import { useState } from 'react';

import { renameCategory } from '@/app/actions/categories';

/** 點名字就能改，不用另外進編輯頁 */
export function CategoryName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="truncate text-left text-sm transition-colors hover:text-accent"
      >
        {name}
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await renameCategory(formData);
        setEditing(false);
      }}
      className="flex items-center gap-1.5"
    >
      <input type="hidden" name="id" value={id} />
      <input
        name="name"
        defaultValue={name}
        autoFocus
        // 不在 onBlur 取消編輯 —— 那會跟 Enter 送出打架，改到一半被吃掉
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        className="min-w-0 flex-1 rounded border border-border-strong bg-bg px-2 py-1 outline-none"
      />
      <button type="submit" className="shrink-0 px-1 text-xs text-accent">
        存
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="shrink-0 px-1 text-xs text-text-faint"
      >
        取消
      </button>
    </form>
  );
}
