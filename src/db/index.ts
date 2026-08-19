import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 連線一律掛在 globalThis 上，正式環境也一樣。
 *
 * 常見寫法是「只有開發模式才快取，因為正式環境模組只會載入一次」，
 * 但那個前提在這裡不成立：打包後 RSC 與 SSR 是不同的 chunk，這支模組
 * 會被實體化不只一次，每一份都自己開一組連線池。連線就這樣一直累積，
 * 直到 pooler 滿了開始讓人排隊 —— 症狀是伺服器剛開沒事，用一下之後
 * 每一頁都無限轉圈，重開 node 又好了。
 */
const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
  db?: Db;
  /** 連線池重建了幾次。要跟 client 一起放在 globalThis，理由同上 */
  generation?: number;
  /** 上次重建的時間，用來擋住連環重建 */
  lastResetAt?: number;
};

/**
 * 模組層級的快取。下面的 Proxy 每次取屬性都會呼叫 connect()，
 * 少了這個就會每查一次資料就開一組新連線池，把 Supabase pooler 的
 * 連線數吃光，請求全部卡住。
 *
 * **一定要跟著記下它是哪一代的**，這是 2026-08-21 抓到的 bug：
 * 這支模組會被實體化不只一次（見上面 globalForDb 的說明），
 * resetDb 只清得掉「呼叫它的那一份」的 cached。另一份還握著已經
 * end() 掉的舊連線池，之後每一支查詢都立刻收到 write CONNECTION_ENDED，
 * 而且因為 generation 守衛與冷卻時間，它也重建不了 —— 等於那一份模組
 * 就此永久壞掉，症狀是「重試四次全是 CONNECTION_ENDED 然後放棄」。
 * 比對代號就能讓每一份模組在任何一次重建之後自己丟掉舊的。
 */
let cached: Db | undefined;
let cachedGeneration = -1;

/** 現在這一代連線池的編號，用來判斷「我失敗的那一代是不是已經被別人重建過了」 */
export function dbGeneration(): number {
  return globalForDb.generation ?? 0;
}

/**
 * 把整組連線池丟掉重來。
 *
 * 為什麼需要這個：連線有可能變成「看起來還在、但送進去的查詢永遠不會有回應」
 * 的殭屍狀態。實測過最糟的情況是整個池子都變殭屍，連 /api/health 都不回，
 * 而同一時間用獨立腳本開全新的池子連同一個資料庫卻完全正常 ——
 * 也就是說壞的是我們手上這幾條連線，不是資料庫。
 * 沒有這段的話，只能等使用者自己把伺服器重開，症狀就是「一直轉、等很久」。
 *
 * sinceGeneration 是呼叫者失敗當下看到的代號。如果已經有別人重建過了，
 * 這次就不要再重建一次，否則同一頁的好幾支查詢會互相把對方的新連線砍掉。
 *
 * 還有兩層保護，都是 2026-08-21 被連環重建咬到之後才加的，別拿掉：
 *
 * 1. **舊池子給五秒善終，不要 timeout: 0。**
 *    原本是直接砍，結果把「剛好也在跑、但完全健康」的查詢一起砍掉
 *    （日誌裡一整排 write CONNECTION_ENDED）。那些查詢會重試、重試又要開新連線，
 *    而「一次開很多新連線」正是最初那個 pooler bug 的觸發條件 —— 變成正回饋，
 *    重建次數在幾秒內從 10 衝到 15。給緩衝期之後，健康的查詢會自己跑完，
 *    真正卡住的那幾條反正也不會回應，五秒後照樣被強制關掉，我們沒有在等它。
 *
 * 2. **冷卻時間。** 剛重建完幾秒內又有查詢逾時，那多半是它本來就跑在舊池子上，
 *    再重建一次只是再送一波新連線出去。這種時候讓它用現有的新池子重試就好。
 */
const RESET_COOLDOWN_MS = 3_000;
const DRAIN_TIMEOUT_S = 30;

export function resetDb(sinceGeneration: number, reason: string): void {
  if (sinceGeneration !== dbGeneration()) return;

  const since = Date.now() - (globalForDb.lastResetAt ?? 0);
  if (since < RESET_COOLDOWN_MS) {
    console.warn(`[db] ${reason}，但 ${since}ms 前才重建過，這次直接用現有的池子重試`);
    return;
  }

  const dying = globalForDb.client;
  globalForDb.generation = dbGeneration() + 1;
  globalForDb.lastResetAt = Date.now();
  globalForDb.client = undefined;
  globalForDb.db = undefined;
  cached = undefined;
  cachedGeneration = -1;

  console.warn(`[db] 連線池重建（第 ${globalForDb.generation} 次）：${reason}`);
  // 不 await。新的查詢都走新池子了，舊池子自己慢慢收尾
  dying?.end({ timeout: DRAIN_TIMEOUT_S }).catch(() => {});
}

function connect(): Db {
  // 代號對不上就代表這份是重建前的舊貨，丟掉重拿
  if (cached && cachedGeneration === dbGeneration()) return cached;
  if (globalForDb.db) {
    cachedGeneration = dbGeneration();
    return (cached = globalForDb.db);
  }

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
       * postgres.js 每建立一條新連線，都會先自己跑一支查詢去問資料庫
       * 有哪些陣列型別（select b.oid, b.typarray from pg_catalog.pg_type ...）。
       * 這支查詢在 Supabase 的 transaction pooler 上會被 statement timeout 砍掉，
       * 而且它是「連線的第一支查詢」—— 它一死，排在同一條連線後面的真正查詢
       * 全部跟著失敗。
       *
       * 症狀非常明確：首頁一次要發四支查詢，等於要同時開好幾條新連線，
       * 所以只有首頁會卡；明細、分類那些一次只查一兩支、重用既有連線，就沒事。
       * 2026-08-18 用連線層的 trace 抓到的。
       *
       * 我們的資料表沒有任何陣列欄位，關掉不影響任何東西。
       */
      fetch_types: false,
      /**
       * 一定要 ≥ 單一頁面同時發出的查詢數，否則會出事。
       *
       * postgres.js 在連線用完時不會等，而是把多的查詢疊到同一條既有連線上
       * （pipelining）。經過 pgbouncer 之後，疊在後面那支的回應會有機率
       * 永遠不回來 —— 前一支 59ms 就回了，後一支等到 statement timeout。
       * 症狀就是「其他頁都好，只有首頁隨機卡住轉圈」，因為只有首頁一次要 4 支。
       *
       * 首頁目前是 4 支（分類、當月、最近、待結清），留一點餘裕設 5。
       * 之後如果有頁面查更多支，這個數字要跟著上去。
       * 2026-08-18 用連線層 trace 抓到的，別再調小。
       */
      max: 5,
      /**
       * 閒置多久就把連線還給 pooler。
       *
       * 原本是 20 秒，太短了。實測有一次卡住剛好發生在連續靜置 25 秒之後，
       * 懷疑是查詢送出的瞬間撞上連線正在被回收（送進一條正在關閉的連線，
       * 回應就永遠不會回來）。這一點沒有百分之百證實，但把它拉長到 3 分鐘
       * 沒有任何壞處：一次操作期間本來就不該回收連線。
       * 真正的保險是 queries.ts 那道 5 秒逾時重試。
       */
      idle_timeout: 180,
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

  globalForDb.client = client;
  globalForDb.db = instance;
  globalForDb.generation ??= 0;
  cached = instance;
  cachedGeneration = dbGeneration();
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
