import { config } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

config({ path: '.env.local' });

/**
 * 驗收測試會寫進真實的 Supabase 資料庫（個人專案沒有另開測試庫），
 * 所以每筆測試資料都帶 E2E 標記，跑完一律清乾淨。見 tests/helpers.ts。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 每個測試都會登入 + 連真實的 Supabase，30 秒預設值不夠用
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Gino 主要在 iPhone 上用，手機版一定要一起驗
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
