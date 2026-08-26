import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import type { User } from '@/db/schema';

import { SESSION_COOKIE, verifySessionToken } from './auth';
import { getUserById } from './queries';

/**
 * 「現在是誰在用」。
 *
 * 跟 src/lib/auth.ts 分開的理由寫在那支的開頭：auth 會被 proxy（可能跑在
 * edge runtime）import，不能碰資料庫；這支會碰，所以只給頁面、Server Action
 * 與 route handler 用。
 *
 * 憑證裡已經有使用者編號，為什麼還要查一次資料庫：
 * 要拿到「叫什麼名字」（畫面上要顯示），也要確認這個人還沒被停用 ——
 * 憑證有九十天效期，停用一個人之後不該還能靠舊憑證繼續用。
 *
 * 用 React cache 包住，所以 layout、page、Server Action 在同一次請求裡
 * 各問各的也只會真的查一次。查詢本身在 queries.ts（照 AGENTS.md 的分工，
 * 也才吃得到那邊的逾時重試 —— 每一頁都會跑的查詢最不能卡住）。
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await verifySessionToken(token);
  if (!userId) return null;

  return (await getUserById(userId)) ?? null;
});

/**
 * 拿到目前的使用者，沒有就送回登入頁。
 *
 * proxy 已經擋過一次了，這裡是第二道 —— Server Action 是公開端點
 * （AGENTS.md 的規矩），不能因為「正常情況下走不到這裡」就假設一定有人。
 * 而且每一支寫入都需要「這筆記在誰名下」，本來就得問一次。
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}
