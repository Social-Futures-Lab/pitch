import { defineConfig, devices } from "@playwright/test";

const slowMo = process.env.PLAYWRIGHT_SLOW_MO
  ? Number(process.env.PLAYWRIGHT_SLOW_MO)
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      slowMo,
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "cd ../backend && uvicorn app.main:app --port 8000",
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        DATABASE_URL: "sqlite+aiosqlite:///e2e_test.db",
        JWT_SECRET_KEY: "e2e-test-secret-key-not-for-production",
      },
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
