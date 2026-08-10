import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 開發模式熱重載會重跑整個模組，用 globalThis 才留得住連線。
 */
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof postgres>; db?: Db };

/**
 * 模組層級的快取。下面的 Proxy 每次取屬性都會呼叫 connect()，
 * 少了這個就會每查一次資料就開一組新連線池，把 Supabase pooler 的
 * 連線數吃光，請求全部卡住。
 */
let cached: Db | undefined;

function connect(): Db {
  if (cached) return cached;
  if (globalForDb.db) return (cached = globalForDb.db);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('缺少 DATABASE_URL，請確認 .env.local（本機）或 Vercel 環境變數已設定');
  }

  const client =
    globalForDb.client ??
    postgres(connectionString, {
      /**
       * Supabase 的 transaction pooler（6543 port）不支援 prepared statements，
       * prepare 沒關掉的話部署到 Vercel 後查詢會炸。
       */
      prepare: false,
      /**
       * 併發連線開太多會把 pooler 的名額吃光，而 pgbouncer 滿了不是回錯誤
       * 而是讓你排隊，症狀就是整頁無限轉圈。但也不能設成 1 ——
       * 只要有一條查詢卡住，整個站就跟著卡死。3 是實測下來的折衷。
       */
      max: 3,
      /** 閒置就把連線還給 pooler，否則會一直佔著名額不放 */
      idle_timeout: 20,
      /** 連不上就快點失敗，不要無限期等下去 */
      connect_timeout: 10,
      /**
       * 避免「連線其實已經死掉，但程式還在傻等」，那會把連線池慢慢吃光，
       * 症狀是頁面隨機無限轉圈。
       *
       * 注意：不要透過 connection 選項設 statement_timeout。那是走 startup
       * parameter，pgbouncer 會擋掉不認得的參數，連線反而直接建不起來。
       */
      keep_alive: 30,
      max_lifetime: 60 * 10,
    });
  const instance = drizzle(client, { schema });

  cached = instance;
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
