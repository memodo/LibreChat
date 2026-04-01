/**
 * Playwright config specifically for PII detection e2e tests.
 * Uses pii-auth-setup which logs in with existing credentials
 * instead of trying to register a new user.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  globalSetup: require.resolve('./setup/pii-auth-setup'),
  testDir: 'specs/',
  outputDir: 'specs/.pii-test-results',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3080',
    video: 'on-first-retry',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    headless: true,
    storageState: path.resolve(process.cwd(), 'e2e/storageState.json'),
    screenshot: 'only-on-failure',
  },
  expect: {
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
