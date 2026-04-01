import { expect, test } from '@playwright/test';
import { ensureLoggedIn } from '../helpers/ensure-logged-in';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3080';

/**
 * Post-Merge Auth E2E Tests
 *
 * Test 3: Auth Flow Stability (REQ-013 to REQ-016)
 *
 * Verifies login, invalid login, unauthenticated redirect, and user menu visibility.
 * Auth tests use 30s timeout per PERF-002.
 */

test.describe('Post-Merge: Auth Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page, baseURL);
  });

  test('REQ-013: Valid login redirects to /c/', async ({ page }) => {
    test.setTimeout(30000);

    // Clear auth state to force login
    await page.context().clearCookies();
    await page.goto('/login', { timeout: 15000 });

    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set');
    }

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password"]').press('Enter');

    await page.waitForURL(/\/c\//, { timeout: 15000 });
    expect(page.url()).toMatch(/\/c\//);
  });

  test('REQ-014: Invalid login shows error message', async ({ page }) => {
    test.setTimeout(30000);

    // Clear auth state to force login
    await page.context().clearCookies();
    await page.goto('/login', { timeout: 15000 });

    await page.locator('input[name="email"]').fill('invalid@example.com');
    await page.locator('input[name="password"]').fill('wrongpassword123');
    await page.locator('input[name="password"]').press('Enter');

    // Should show an error message on the login page
    await expect(
      page.locator('[role="alert"], .text-red-500, .text-red-600, [data-testid="login-error"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // URL should still be on login, not /c/
    expect(page.url()).not.toMatch(/\/c\//);
  });

  test('REQ-015: Unauthenticated access redirects to login', async ({ page }) => {
    test.setTimeout(30000);

    // Clear auth state
    await page.context().clearCookies();
    await page.goto('/c/new', { timeout: 15000 });

    // Should redirect to login page
    await page.waitForURL(/\/login/, { timeout: 15000 });
    expect(page.url()).toMatch(/\/login/);
  });

  test('REQ-016: User menu visible after login', async ({ page }) => {
    test.setTimeout(30000);

    // ensureLoggedIn already ran in beforeEach, so we should be on /c/new
    // The user menu/avatar button should be visible in the navigation
    // Look for common user menu patterns: avatar button, user icon, profile menu
    const userMenu = page.locator(
      'nav button[aria-label*="ser"], ' +
      'button[data-testid="nav-user"], ' +
      '[data-testid="user-menu"], ' +
      'nav img[alt*="vatar"], ' +
      'button:has(img[alt*="vatar"])',
    );

    await expect(userMenu.first()).toBeVisible({ timeout: 10000 });
  });
});
