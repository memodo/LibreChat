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
  await page.waitForURL(/\/c\//, { timeout: 15000 });

  // Persist updated storage state so subsequent tests don't re-auth (P1-2 / spec requirement)
  await page.context().storageState({ path: storageStatePath });
}
