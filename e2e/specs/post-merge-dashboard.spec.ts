import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { ensureLoggedIn } from '../helpers/ensure-logged-in';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3080';

/**
 * Post-Merge Dashboard E2E Tests
 *
 * Test 1: Admin Reporting Dashboard Smoke Test (REQ-001 to REQ-010)
 * Test 2: Admin Access Control (REQ-011 to REQ-012)
 *
 * These tests verify the admin reporting dashboard survives upstream merges.
 * The dashboard has NO data-testid attributes — all selectors are semantic.
 */

test.describe('Post-Merge: Admin Dashboard', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page, baseURL);
  });

  test.describe('Test 1: Dashboard Smoke Test', () => {
    test('REQ-001: Dashboard page loads with Usage Reports heading', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });

      await expect(
        page.getByRole('heading', { name: /Usage Reports/ }),
      ).toBeVisible({ timeout: 15000 });
    });

    test('REQ-002: All 6 overview cards render', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      // Overview cards use <h3> elements for their labels
      const cardLabels = [
        'Registered Users',
        'Active Users',
        'Conversations',
        'Total Spend',
        'Transactions',
        'Cancelled Request Spend',
      ];

      for (const label of cardLabels) {
        await expect(
          page.getByRole('heading', { level: 3, name: label, exact: true }),
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test('REQ-003: Usage Trends section renders with granularity buttons', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('heading', { name: 'Usage Trends' }),
      ).toBeVisible({ timeout: 10000 });

      // Granularity toggle buttons (exact: true to avoid matching "7 days", "30 days", etc.)
      for (const granularity of ['day', 'week', 'month']) {
        await expect(
          page.getByRole('button', { name: granularity, exact: true }),
        ).toBeVisible();
      }
    });

    test('REQ-004: Cost by Model section renders with table headers', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('heading', { name: 'Cost by Model' }),
      ).toBeVisible({ timeout: 10000 });

      // Verify the table renders with expected column headers.
      // Actual columns: Model, Spend, Prompt Tokens, Completion Tokens, Transactions.
      // Use cell role with exact match to avoid ambiguity with other tables.
      await expect(page.getByRole('cell', { name: 'Prompt Tokens' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Completion Tokens' })).toBeVisible();
    });

    test('REQ-005: Top Users by Spend section renders with search input', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('heading', { name: 'Top Users by Spend' }),
      ).toBeVisible({ timeout: 10000 });

      // Search input within the Top Users section
      // TopUsersTable contains a search input for filtering users
      await expect(
        page.locator('input[placeholder*="earch"]').first(),
      ).toBeVisible();
    });

    test('REQ-006: User Activity section renders', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('heading', { name: /User Activity/ }),
      ).toBeVisible({ timeout: 10000 });
    });

    test('REQ-007: Guardrail Events section renders with filter controls', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('heading', { name: 'Guardrail Events' }),
      ).toBeVisible({ timeout: 10000 });

      // GuardrailEventsSection has two <select> filter controls (type and action)
      const guardrailSection = page.locator('section').filter({ hasText: 'Guardrail Events' });
      const selects = guardrailSection.locator('select');
      await expect(selects.first()).toBeVisible({ timeout: 5000 });
    });

    test('REQ-008: Date range picker renders with preset buttons', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      // Date preset buttons: 7 days, 30 days, 90 days, 1 year
      for (const preset of ['7 days', '30 days', '90 days', '1 year']) {
        await expect(
          page.getByRole('button', { name: preset }),
        ).toBeVisible({ timeout: 5000 });
      }
    });

    test('REQ-009: Refresh button is present', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByRole('button', { name: 'Refresh' }),
      ).toBeVisible();
    });

    test('REQ-010: Back to Chat link navigates to /c/new', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Usage Reports/ })).toBeVisible({ timeout: 15000 });

      const backLink = page.getByRole('link', { name: /Back to Chat/ });
      await expect(backLink).toBeVisible();

      await backLink.click();
      await page.waitForURL(/\/c\/new/, { timeout: 10000 });
    });
  });
});

/**
 * Test 2: Admin Access Control (REQ-011)
 *
 * Separated from the serial dashboard smoke tests because this test uses the
 * `browser` fixture (not `page`) to create a non-admin browser context, which
 * is incompatible with the serial block's beforeEach that expects `page`.
 */
test.describe('Post-Merge: Admin Access Control', () => {
  const nonAdminStoragePath = path.resolve(process.cwd(), 'e2e/storageState-nonadmin.json');
  const hasNonAdminUser =
    !!process.env.E2E_USER2_EMAIL && !!process.env.E2E_USER2_PASSWORD;

  test('REQ-011: Non-admin user sees Access Denied on /d/reporting', async ({ browser }) => {
    const nonAdminStorageExists = fs.existsSync(nonAdminStoragePath);

    test.skip(
      !hasNonAdminUser || !nonAdminStorageExists,
      'Skipped: E2E_USER2_EMAIL / E2E_USER2_PASSWORD not set or storageState-nonadmin.json missing',
    );
    test.setTimeout(30000);

    const context = await browser.newContext({
      storageState: nonAdminStoragePath,
    });
    const page = await context.newPage();

    try {
      await page.goto('/d/reporting', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      });

      await expect(
        page.getByRole('heading', { level: 1, name: 'Access Denied' }),
      ).toBeVisible({ timeout: 15000 });

      await expect(
        page.getByText('You do not have permission to view usage reports'),
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
    }
  });
});
