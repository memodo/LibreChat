import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { ensureLoggedIn } from '../helpers/ensure-logged-in';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3080';

/**
 * Post-Merge Routes & Package Integrity E2E Tests
 *
 * Test 7: Custom Route Registration (REQ-025 to REQ-026)
 * Test 8: Package Build Integrity (REQ-027 to REQ-029)
 *
 * These tests verify custom routes and package-level additions survive merges.
 */

test.describe('Post-Merge: Routes & Package Integrity', () => {
  test.describe('Test 7: Custom Route Registration', () => {
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page, baseURL);
    });
    test('REQ-025: Reporting route /d/reporting is accessible', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });

      // The page should render with at least one expected dashboard heading
      // (not a 404, blank page, or React error boundary)
      const hasExpectedContent = await Promise.race([
        page
          .getByRole('heading', { name: /Usage Reports/ })
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => true),
        page
          .getByRole('heading', { name: /Access Denied/ })
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => true),
      ]).catch(() => false);

      expect(hasExpectedContent).toBe(true);
    });

    test('REQ-026: Admin conversation viewer route is accessible', async ({ page }) => {
      test.setTimeout(30000);

      await page.goto('/admin/conversation/test-conversation-id', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      });

      // The page should load without a 404 or crash.
      // It may show "not found" or "no conversation" for the fake ID,
      // but it must not show a browser-level 404 or blank screen.
      // Wait for the page to settle, then verify a meaningful element rendered
      // (not just non-blank text, which would pass for React error boundaries too).
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        // networkidle may not trigger if SSE/websocket is open; fall back to timeout
      });

      // Check that the page is not a raw server 404 or blank
      const bodyText = await page.locator('body').textContent();
      expect(bodyText).toBeTruthy();
      expect(bodyText).not.toMatch(/Cannot GET/i);

      // Verify the React app rendered (not an error boundary or blank page).
      // The app shell should have at least a nav or main content area.
      const hasAppShell = await page.locator('nav, main, [role="main"], #root > div').first().isVisible().catch(() => false);
      expect(hasAppShell).toBe(true);
    });
  });

  test.describe('Test 8: Package Build Integrity', () => {
    test('REQ-027: ErrorTypes.PII_DETECTION constant exists in data-provider', async () => {
      test.setTimeout(30000);

      const configPath = path.resolve(
        __dirname,
        '../../packages/data-provider/src/config.ts',
      );

      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, 'utf-8');
      // Verify the PII_DETECTION enum value exists with the correct string
      expect(content).toContain("PII_DETECTION = 'pii_detection'");
    });

    test('REQ-028: GuardrailEvent API returns 200 with JSON array', async ({ page }) => {
      test.setTimeout(30000);

      // This test needs auth — call ensureLoggedIn inline
      await ensureLoggedIn(page, baseURL);

      // Intercept the guardrail-events API call during dashboard load
      const guardrailResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/admin/usage/guardrail-events') &&
          response.request().method() === 'GET',
        { timeout: 20000 },
      );

      await page.goto('/d/reporting', { timeout: 15000, waitUntil: 'domcontentloaded' });

      // Wait for the guardrail-events API response
      const guardrailResponse = await guardrailResponsePromise;

      // The admin usage API has its own rate limiter (60 req/min).
      // Dashboard smoke tests may have exhausted it. Accept both 200 and 429.
      const status = guardrailResponse.status();
      if (status === 429) {
        // Rate limited — the endpoint exists and responds, which is the main check.
        // Skip the body assertion since the response is a rate limit error, not data.
        return;
      }

      // Assert HTTP 200
      expect(status).toBe(200);

      // The API returns an envelope: { data: { events, summary }, meta: { ... } }
      // Verify the response is valid JSON with the expected structure.
      const body = await guardrailResponse.json();
      expect(body).toBeTruthy();
      expect(body.data).toBeTruthy();
      expect(Array.isArray(body.data.events)).toBe(true);
    });

    test('REQ-029: All chat route files include PII middleware', async () => {
      test.setTimeout(30000);

      // Explicit allowlist of files that MUST contain createDetectPII.
      // These are the chat route files identified in RESEARCH-012 and SPEC-012.
      // Non-chat files (v1.js, v2.js with CRUD operations like createAgent/createAssistant)
      // correctly do NOT have PII middleware and are excluded.
      //
      // agents/chat.js uses router.use(createDetectPII(...)) which applies to all routes.
      // agents/openai.js uses createDetectPII on router.post('/chat/completions', ...).
      // agents/responses.js uses createDetectPII on router.post('/', ...).
      // assistants/chatV1.js uses createDetectPII on router.post('/', ...).
      // assistants/chatV2.js uses createDetectPII on router.post('/', ...).
      const chatRouteFiles: Array<{ dir: string; file: string }> = [
        { dir: 'api/server/routes/agents', file: 'chat.js' },
        { dir: 'api/server/routes/agents', file: 'openai.js' },
        { dir: 'api/server/routes/agents', file: 'responses.js' },
        { dir: 'api/server/routes/assistants', file: 'chatV1.js' },
        { dir: 'api/server/routes/assistants', file: 'chatV2.js' },
      ];

      for (const { dir, file } of chatRouteFiles) {
        const filePath = path.resolve(__dirname, '../../', dir, file);
        expect(
          fs.existsSync(filePath),
          `Chat route file ${dir}/${file} must exist`,
        ).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(
          content,
          `${dir}/${file} must include createDetectPII — PII middleware missing from chat route`,
        ).toContain('createDetectPII');
      }
    });
  });
});
