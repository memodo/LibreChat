/**
 * Post-merge test auth setup — logs in admin and optional non-admin users.
 *
 * Admin user: E2E_USER_EMAIL / E2E_USER_PASSWORD → saves storageState.json
 * Non-admin user: E2E_USER2_EMAIL / E2E_USER2_PASSWORD → saves storageState-nonadmin.json
 *
 * The non-admin user is optional. If E2E_USER2_EMAIL / E2E_USER2_PASSWORD are not set,
 * only the admin user is authenticated and Test 2 (access control) will be skipped.
 *
 * Usage:
 *   npx playwright test --config e2e/post-merge.playwright.config.ts
 */
import { chromium, type FullConfig } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3080';
const adminStoragePath = path.resolve(process.cwd(), 'e2e/storageState.json');
const nonAdminStoragePath = path.resolve(process.cwd(), 'e2e/storageState-nonadmin.json');

async function loginUser(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
  storagePath: string,
  label: string,
) {
  const page = await browser.newPage();
  try {
    await page.goto(baseURL, { timeout: 10000 });
    await page.waitForSelector('input[name="email"]', { timeout: 10000 });

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password"]').press('Enter');

    await page.waitForURL(/\/c\//, { timeout: 15000 });
    console.log(`[post-merge-auth-setup] ${label} login successful`);

    await page.context().storageState({ path: storagePath });
    console.log(`[post-merge-auth-setup] ${label} auth state saved to ${storagePath}`);
  } catch (error) {
    console.error(`[post-merge-auth-setup] ${label} login failed:`, error);
    await page.screenshot({
      path: `e2e/post-merge-auth-setup-${label.toLowerCase().replace(/\s+/g, '-')}-failure.png`,
    });
    throw error;
  } finally {
    await page.close();
  }
}

async function postMergeAuthSetup(_config?: FullConfig) {
  const adminEmail = process.env.E2E_USER_EMAIL;
  const adminPassword = process.env.E2E_USER_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      '[post-merge-auth-setup] E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env',
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // Admin user (required)
    console.log(`[post-merge-auth-setup] Logging in admin user (${adminEmail}) at ${baseURL}`);
    await loginUser(browser, adminEmail, adminPassword, adminStoragePath, 'Admin');

    // Non-admin user (optional)
    const user2Email = process.env.E2E_USER2_EMAIL;
    const user2Password = process.env.E2E_USER2_PASSWORD;

    if (user2Email && user2Password) {
      console.log(
        `[post-merge-auth-setup] Logging in non-admin user (${user2Email}) at ${baseURL}`,
      );
      await loginUser(browser, user2Email, user2Password, nonAdminStoragePath, 'Non-admin');

      // FAIL-002/FAIL-003: Verify the non-admin user actually lacks admin role.
      // Navigate to /d/reporting and confirm "Access Denied" is shown.
      const verifyPage = await browser.newPage({
        storageState: nonAdminStoragePath,
      });
      try {
        await verifyPage.goto(`${baseURL}/d/reporting`, { timeout: 15000 });
        const accessDenied = verifyPage.locator('h1:has-text("Access Denied")');
        const usageReports = verifyPage.locator('h1:has-text("Usage Reports")');

        const result = await Promise.race([
          accessDenied.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'denied' as const),
          usageReports.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'admin' as const),
        ]).catch(() => 'unknown' as const);

        if (result === 'admin') {
          console.error(
            `[post-merge-auth-setup] WARNING: Non-admin user (${user2Email}) has admin access! ` +
            'Test 2 (REQ-011) will not provide meaningful access control verification. ' +
            'Configure E2E_USER2_EMAIL to point to a user WITHOUT admin role.',
          );
        } else if (result === 'denied') {
          console.log('[post-merge-auth-setup] Non-admin role verified (sees Access Denied)');
        }
      } finally {
        await verifyPage.close();
      }
    } else {
      console.log(
        '[post-merge-auth-setup] E2E_USER2_EMAIL / E2E_USER2_PASSWORD not set — ' +
          'non-admin access control test (Test 2) will be skipped',
      );
    }
  } catch (error) {
    console.error('[post-merge-auth-setup] Setup failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

export default postMergeAuthSetup;
