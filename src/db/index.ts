import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 開發模式熱重載會重跑這個模組，用 global 快取避免連線數爆掉。
 */
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof postgres>; db?: Db };

function connect(): Db {
  if (globalForDb.db) return globalForDb.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('缺少 DATABASE_URL，請確認 .env.local（本機）或 Vercel 環境變數已設定');
  }

  /**
   * Supabase 的 transaction pooler（6543 port）不支援 prepared statements，
   * prepare 沒關掉的話部署到 Vercel 後查詢會炸。
   */
  const client = globalForDb.client ?? postgres(connectionString, { prepare: false, max: 5 });
  const instance = drizzle(client, { schema });

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.client = client;
    globalForDb.db = instance;
  }
  return instance;
}

/**
 * 延遲連線：`next build` 會 import 整個模組樹，如果在模組載入當下就檢查
 * DATABASE_URL，還沒設好資料庫時連 build 都跑不動。改成第一次真的用到才連。
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});
