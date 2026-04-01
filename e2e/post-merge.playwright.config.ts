/**
 * Playwright config for post-merge e2e tests.
 *
 * Verifies custom MemodoAI features (PII detection, admin reporting dashboard)
 * survive upstream merges from main. Uses post-merge-auth-setup which logs in
 * with existing credentials (admin + optional non-admin user).
 *
 * CONCURRENT EXECUTION WARNING: This suite and the PII suite (pii.playwright.config.ts)
 * share e2e/storageState.json for the admin user. Do NOT run both simultaneously —
 * concurrent execution can cause authentication state corruption.
 *
 * PREREQUISITE: Set LOGIN_MAX=50 (or higher) in .env before running.
 * The default LOGIN_MAX=7 is too low — each test context triggers a refresh
 * token exchange, and when tokens rotate, ensureLoggedIn must re-authenticate,
 * quickly exhausting the login rate limit.
 *
 * Run manually:
 *   npx playwright test --config e2e/post-merge.playwright.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  globalSetup: require.resolve('./setup/post-merge-auth-setup'),
  testDir: 'specs/',
  testMatch: 'post-merge-*.spec.ts',
  outputDir: 'specs/.post-merge-test-results',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3080',
    video: 'retain-on-failure',
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
