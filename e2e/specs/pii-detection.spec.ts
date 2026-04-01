import { expect, test } from '@playwright/test';

const baseURL = 'http://localhost:3080';
const initialUrl = `${baseURL}/c/new`;

/**
 * PII Detection E2E Tests
 *
 * These tests verify the full user-facing flow for PII detection.
 * They require:
 *   - A running LibreChat instance with PII_DETECTION=true
 *   - The redakt service running and reachable at PII_DETECTION_API_URL
 *   - The configured AI endpoint available (e.g., OpenAI agent)
 *
 * Tests are mode-agnostic: they pass whether PII_DETECTION_MODE is
 * "detect" (block) or "warn". PII detection triggers either an error
 * message in chat or a warning toast — both are accepted.
 *
 * Only PII types reliably detected by Presidio/redakt are used:
 *   - PERSON (names)
 *   - EMAIL_ADDRESS (email addresses)
 *   - LOCATION (street addresses)
 */

/** Regex that matches PII feedback text in both block and warn modes. */
const PII_DETECTED_REGEX =
  /personal information|cautious about sharing|was not sent|remove personal details/i;

/**
 * Re-authenticate once if the session has expired. Saves the new storage state
 * so subsequent tests in the same run reuse it without hitting the rate limiter.
 */
async function ensureLoggedIn(page: import('@playwright/test').Page) {
  await page.goto(initialUrl, { timeout: 15000 });

  // Wait for either the chat textarea or the login form to appear
  const chatTextarea = page.getByTestId('text-input');
  const loginEmail = page.locator('input[name="email"]');

  const which = await Promise.race([
    chatTextarea.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'chat' as const),
    loginEmail.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login' as const),
  ]).catch(() => 'unknown' as const);

  if (which === 'chat') {
    return; // Already authenticated
  }

  // On login page — re-authenticate
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for re-authentication');
  }

  await loginEmail.fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press('Enter');
  await page.waitForURL(/\/c\//, { timeout: 15000 });
}

test.describe('PII Detection', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test.describe('PII Detection', () => {
    test('should detect name and email PII', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.getByTestId('text-input');
      await textbox.click();
      await textbox.fill('My name is John Smith and my email is john.smith@example.com');
      await textbox.press('Enter');

      // In block mode this shows an error message in chat; in warn mode a toast.
      await expect(
        page.getByText(PII_DETECTED_REGEX).first(),
      ).toBeVisible({ timeout: 30000 });
    });

    test('should detect address PII', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.getByTestId('text-input');
      await textbox.click();
      await textbox.fill('I live at 2343 Walnut Ave, Pasadena, CA 91107');
      await textbox.press('Enter');

      await expect(
        page.getByText(PII_DETECTED_REGEX).first(),
      ).toBeVisible({ timeout: 30000 });
    });

    test('should send clean message without triggering PII detection', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.getByTestId('text-input');
      await textbox.click();
      await textbox.fill('What is the capital of France?');
      await textbox.press('Enter');

      // Wait for any PII feedback to potentially appear.
      await page.waitForTimeout(3000);

      // Verify no PII-related text is visible.
      const piiText = page.getByText(PII_DETECTED_REGEX);
      await expect(piiText).not.toBeVisible();
    });
  });

  test.describe('Admin Dashboard', () => {
    test('should display Guardrail Events heading on reporting dashboard', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto(`${baseURL}/d/reporting`, { timeout: 15000, waitUntil: 'domcontentloaded' });

      await expect(page.getByText('Guardrail Events')).toBeVisible({ timeout: 15000 });
    });

    test('should have at least one row in the event log table', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto(`${baseURL}/d/reporting`, { timeout: 15000, waitUntil: 'domcontentloaded' });

      await expect(page.getByText('Guardrail Events')).toBeVisible({ timeout: 15000 });

      // The event log table should contain at least one row with a "pii" type
      // from previous test runs or the PII detection tests above.
      await expect(page.locator('td:has-text("pii")').first()).toBeVisible({ timeout: 15000 });
    });
  });
});
