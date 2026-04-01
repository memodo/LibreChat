/**
 * Shared helper: re-authenticate if the session has expired.
 *
 * After successful re-auth, the updated storage state is persisted to disk
 * so subsequent tests in the same run reuse it without re-authenticating.
 *
 * Reused by all post-merge spec files.
 */
import path from 'path';

const storageStatePath = path.resolve(process.cwd(), 'e2e/storageState.json');

export async function ensureLoggedIn(page: import('@playwright/test').Page, baseURL: string) {
  const initialUrl = `${baseURL}/c/new`;
  await page.goto(initialUrl, { timeout: 15000 });

  const chatTextarea = page.getByTestId('text-input');
  const loginEmail = page.locator('input[name="email"]');

  const which = await Promise.race([
    chatTextarea.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'chat' as const),
    loginEmail.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login' as const),
  ]).catch(() => 'unknown' as const);

  if (which === 'chat') {
    // Always persist the current storage state — the server may have refreshed
    // tokens (e.g., refresh token rotation), so the browser context now has
    // updated cookies that must be saved for subsequent tests.
    await page.context().storageState({ path: storageStatePath });
    return;
  }

  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for re-authentication');
  }

  await loginEmail.fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press('Enter');

  // Check for rate limiting before waiting for navigation
  const rateLimitMsg = page.locator('text=/too many login attempts/i');
  const navigated = page.waitForURL(/\/c\//, { timeout: 15000 });

  const result = await Promise.race([
    navigated.then(() => 'navigated' as const),
    rateLimitMsg.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'rate-limited' as const),
  ]).catch(() => 'timeout' as const);

  if (result === 'rate-limited') {
    throw new Error(
      'Login rate limited — too many login attempts. Wait a few minutes and retry. ' +
      'The login rate limiter allows LOGIN_MAX (default 7) attempts per LOGIN_WINDOW (default 5) minutes.',
    );
  }

  if (result === 'timeout') {
    throw new Error('ensureLoggedIn: login succeeded but navigation to /c/ timed out');
  }

  // Persist updated storage state so subsequent tests don't re-auth (P1-2 / spec requirement)
  await page.context().storageState({ path: storageStatePath });
}
