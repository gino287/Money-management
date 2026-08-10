import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js 讀 .env.local，drizzle-kit 是獨立 CLI 不會自己讀，要明講
config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
