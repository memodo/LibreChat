/**
 * PII test auth setup — logs in with existing credentials and saves storageState.
 * Unlike the default global-setup which tries to register a new user,
 * this just logs in with E2E_USER_EMAIL / E2E_USER_PASSWORD.
 *
 * Usage:
 *   npx playwright test e2e/specs/pii-detection.spec.ts --global-setup e2e/setup/pii-auth-setup.ts
 *
 * Or run standalone:
 *   npx tsx e2e/setup/pii-auth-setup.ts
 */
import { chromium, type FullConfig } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3080';
const storageStatePath = path.resolve(process.cwd(), 'e2e/storageState.json');

async function piiAuthSetup(_config?: FullConfig) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    console.error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env');
    process.exit(1);
  }

  console.log(`[pii-auth-setup] Logging in as ${email} at ${baseURL}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(baseURL, { timeout: 10000 });

    // Wait for login form
    await page.waitForSelector('input[name="email"]', { timeout: 10000 });

    // Fill login credentials
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password"]').press('Enter');

    // Wait for redirect to chat
    await page.waitForURL(/\/c\//, { timeout: 15000 });
    console.log('[pii-auth-setup] Login successful');

    // Save auth state
    await page.context().storageState({ path: storageStatePath });
    console.log(`[pii-auth-setup] Auth state saved to ${storageStatePath}`);
  } catch (error) {
    console.error('[pii-auth-setup] Login failed:', error);
    // Take a screenshot for debugging
    await page.screenshot({ path: 'e2e/pii-auth-setup-failure.png' });
    console.error('[pii-auth-setup] Screenshot saved to e2e/pii-auth-setup-failure.png');
    process.exit(1);
  } finally {
    await browser.close();
  }
}

export default piiAuthSetup;
