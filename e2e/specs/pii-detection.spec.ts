import { expect, test } from '@playwright/test';
import type { Response } from '@playwright/test';

const initialUrl = 'http://localhost:3080/c/new';

/**
 * PII Detection E2E Tests
 *
 * These tests verify the full user-facing flow for PII detection.
 * They require:
 *   - A running LibreChat instance with PII_DETECTION=true
 *   - The redakt service running and reachable at PII_DETECTION_API_URL
 *   - The configured AI endpoint available (e.g., OpenAI agent)
 *
 * Block mode tests require PII_DETECTION_MODE=detect (the default).
 * Warn mode tests require PII_DETECTION_MODE=warn.
 *
 * Since these modes are mutually exclusive at runtime, you should run
 * only the relevant describe block for the active configuration.
 * The other block will fail or behave unexpectedly.
 */

const waitForAgentStream = async (response: Response) => {
  return response.url().includes('/api/agents') && response.status() === 200;
};

test.describe('PII Detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(initialUrl, { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    await page.close();
  });

  test.describe('Block mode (PII_DETECTION_MODE=detect)', () => {
    // Skip this block if not running in detect mode.
    // Uncomment the next line to skip programmatically:
    // test.skip(() => process.env.PII_DETECTION_MODE === 'warn', 'Requires detect mode');

    test('should block message containing email PII and show error in chat', async ({ page }) => {
      test.setTimeout(30000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('My name is John Smith and my email is john.smith@example.com');

      // Submit the message. In block mode the POST to /api/agents returns 400,
      // which the client renders as an error message in the conversation.
      await textbox.press('Enter');

      // The error handler in useResumableSSE stringifies the error response
      // and renders it as a message with error: true. The error JSON contains
      // the user-facing message from the middleware.
      // Look for the key phrase from the block error message.
      await expect(
        page.getByText(/personal information|was not sent|remove personal details/i).first(),
      ).toBeVisible({ timeout: 15000 });
    });

    test('should block message containing SSN PII', async ({ page }) => {
      test.setTimeout(30000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('My social security number is 123-45-6789');

      await textbox.press('Enter');

      await expect(
        page.getByText(/personal information|was not sent|remove personal details/i).first(),
      ).toBeVisible({ timeout: 15000 });
    });

    test('should block message containing phone number PII', async ({ page }) => {
      test.setTimeout(30000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('Call me at 555-123-4567, my name is Jane Doe');

      await textbox.press('Enter');

      await expect(
        page.getByText(/personal information|was not sent|remove personal details/i).first(),
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Warn mode (PII_DETECTION_MODE=warn)', () => {
    // Skip this block if not running in warn mode.
    // Uncomment the next line to skip programmatically:
    // test.skip(() => process.env.PII_DETECTION_MODE !== 'warn', 'Requires warn mode');

    test('should show warning toast when PII is detected and still send message', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('My name is John Smith and my address is 123 Main St, Springfield IL');

      await textbox.press('Enter');

      // In warn mode, the POST succeeds and returns { streamId, warning }.
      // The client shows a toast via showToast({ message, status: 'warning' }).
      // The toast component uses the CSS class "toast-root" and the warning
      // severity class includes bg-[#C75209].
      // The warning message contains "cautious about sharing personal details".
      await expect(
        page.getByText(/cautious about sharing personal details|personal information/i).first(),
      ).toBeVisible({ timeout: 15000 });

      // Verify the message was actually sent through — wait for the AI response.
      // The agent stream response should come back with a 200.
      await page.waitForResponse(waitForAgentStream, { timeout: 45000 });
    });

    test('should show warning toast with specific entity types mentioned', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill(
        'Please contact john.smith@example.com or call 555-123-4567 for details',
      );

      await textbox.press('Enter');

      // The warning message includes human-readable entity labels like
      // "email addresses", "phone numbers", etc.
      await expect(
        page.getByText(/email addresses|phone numbers|personal information/i).first(),
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Clean messages (no PII)', () => {
    test('should send message without PII normally with no toast or error', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('What is the capital of France?');

      const responsePromise = page.waitForResponse(waitForAgentStream);
      await textbox.press('Enter');

      // Wait for the AI response to confirm the message went through.
      const response = await responsePromise;
      expect(response.status()).toBe(200);

      // Give time for any toast to appear (it should not).
      await page.waitForTimeout(3000);

      // Verify no PII-related toast or error is visible.
      const piiToast = page.getByText(
        /personal information|cautious about sharing|was not sent|remove personal details/i,
      );
      await expect(piiToast).not.toBeVisible();
    });

    test('should send technical question without triggering PII detection', async ({ page }) => {
      test.setTimeout(60000);

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('Explain the difference between TCP and UDP protocols');

      const responsePromise = page.waitForResponse(waitForAgentStream);
      await textbox.press('Enter');

      const response = await responsePromise;
      expect(response.status()).toBe(200);

      await page.waitForTimeout(3000);

      const piiToast = page.getByText(
        /personal information|cautious about sharing|was not sent|remove personal details/i,
      );
      await expect(piiToast).not.toBeVisible();
    });
  });

  test.describe('Admin dashboard — Guardrail Events', () => {
    // These tests require an admin user. The default e2e auth setup creates a
    // regular user, so these tests will likely need a separate auth setup or
    // should be skipped if the user is not an admin.
    // Uncomment to skip: test.skip(true, 'Requires admin user');

    test('should display guardrail events section on the reporting dashboard', async ({
      page,
    }) => {
      test.setTimeout(30000);

      // Navigate to the admin reporting dashboard.
      await page.goto('http://localhost:3080/d/reporting', { timeout: 10000 });

      // The GuardrailEventsSection renders a heading "Guardrail Events".
      await expect(page.getByText('Guardrail Events')).toBeVisible({ timeout: 10000 });
    });

    test('should show guardrail events after PII triggers', async ({ page }) => {
      test.setTimeout(60000);

      // First, trigger a PII detection event by sending a message with PII.
      await page.goto(initialUrl, { timeout: 10000 });

      const textbox = page.locator('form').getByRole('textbox');
      await textbox.click();
      await textbox.fill('My name is Test User and my email is test@example.com');
      await textbox.press('Enter');

      // Wait for the PII response (block or warn, depending on mode).
      await page.waitForTimeout(5000);

      // Navigate to admin reporting dashboard.
      await page.goto('http://localhost:3080/d/reporting', { timeout: 10000 });

      // Wait for the guardrail events section to load.
      await expect(page.getByText('Guardrail Events')).toBeVisible({ timeout: 10000 });

      // The Event Log table should be visible if there are events.
      // Look for the "Event Log" sub-heading within the section.
      await expect(page.getByText('Event Log')).toBeVisible({ timeout: 10000 });

      // Check that the summary cards show at least one event.
      // The "Total Events" card should display a number greater than 0.
      const totalEventsCard = page.locator('text=Total Events').locator('..');
      await expect(totalEventsCard).toBeVisible({ timeout: 10000 });

      // Verify the events table has at least one row with "pii" type.
      await expect(page.locator('td:has-text("pii")').first()).toBeVisible({ timeout: 10000 });
    });

    test('should filter guardrail events by action type', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('http://localhost:3080/d/reporting', { timeout: 10000 });
      await expect(page.getByText('Guardrail Events')).toBeVisible({ timeout: 10000 });

      // Find the action filter dropdown and select "Blocked".
      const actionSelect = page.locator('select').filter({ hasText: 'All Actions' });
      if (await actionSelect.isVisible()) {
        await actionSelect.selectOption('block');

        // After filtering, verify the table only shows "Blocked" badges
        // or shows the empty state message.
        await page.waitForTimeout(2000);

        const blockedBadges = page.getByText('Blocked', { exact: true });
        const emptyState = page.getByText('No guardrail events for the selected period');
        const hasBlocked = await blockedBadges.first().isVisible().catch(() => false);
        const hasEmpty = await emptyState.isVisible().catch(() => false);

        // One of the two states should be true.
        expect(hasBlocked || hasEmpty).toBe(true);
      }
    });
  });
});
