# PII Detection — Merge from Main Checklist

> **This is one entry in the fork↔upstream divergence set.** For the full index of *all* fork
> customizations that a merge can clobber (M365 OBO, conv-log, reporting, …), see
> **[`docs/fork-upstream-divergences.md`](fork-upstream-divergences.md)**. This doc is the detailed
> re-check for the **PII/redakt** and **admin reporting** entries.

Run this checklist after every merge from `main` into the PII feature branch (or any branch carrying the PII customization).

> ## ⚙️ Most of this is automated — read this first
>
> The Husky hook at `.husky/post-merge` runs automatically on every `git merge` / `git pull` and covers the bulk of this checklist for you:
>
> | Phase | What it does | Replaces |
> |---|---|---|
> | **Phase 0** | `scripts/pii-merge-verify.sh` — static checks that every PII insertion (route middleware ordering, registry exports, SSE warning handling, admin endpoints, owned files) is still in place | Sections **2** and **6** |
> | **Phase 1** | `detectPII` + `pii-middleware-chain` Jest suites | Section **1** unit/integration commands |
> | **Phase 2** | Playwright `pii-detection.spec.ts` (skipped if `redakt` is not running) | Section **1** PII e2e |
> | **Phase 3** | Playwright `post-merge.playwright.config.ts` (admin dashboard, auth, routes, package integrity) | Section **1** post-merge e2e |
>
> If the hook is green end-to-end, sections 1, 2, and 6 of this document are already verified — the only things you still do by hand are:
>
> - **Section 3** — rebuild + restart (intentionally not in the hook; has side effects and is slow)
> - **Section 4** — conflict-resolution guidance (consult only when Phase 0/1 fails)
> - **Section 5** — manual smoke test in the browser (optional sanity check beyond the e2e)
>
> Run the static checks any time on demand: `sh scripts/pii-merge-verify.sh`.

## 0. One-time setup (Playwright e2e tests)

The post-merge git hook automatically runs unit + integration tests on every merge. For the Playwright e2e tests to also run automatically, complete this one-time setup:

1. **Add e2e credentials to `.env`** (already done if you see `E2E_USER_EMAIL` in your `.env`):
   ```
   E2E_USER_EMAIL=e2e-test@memodo-eng.de
   E2E_USER_PASSWORD=E2eTestPass123!
   ```

2. **Install Playwright browsers** (one-time download, ~370MB):
   ```bash
   npx playwright install
   ```

3. **Create the auth state** by running the tests once with the full stack running:
   ```bash
   # Make sure LibreChat and redakt are running first
   npx playwright test e2e/specs/pii-detection.spec.ts --config e2e/pii.playwright.config.ts
   ```
   This logs in with your E2E credentials and saves `e2e/storageState.json` (gitignored).

4. **Verify the hook works**:
   ```bash
   sh .husky/post-merge
   ```
   You should see Phase 1 (unit + integration) and Phase 2 (e2e) both run.

After this setup, the post-merge hook runs everything automatically on `git merge` or `git pull`.

## 1. Run the tests

```bash
# Unit tests (62 tests — middleware logic)
cd api && npx jest --testPathPatterns=detectPII --no-coverage

# Integration tests (24 tests — middleware chain on all routes)
cd api && npx jest --testPathPatterns=pii-middleware-chain --no-coverage

# E2e tests (requires running stack with PII_DETECTION=true and redakt)
npx playwright test e2e/specs/pii-detection.spec.ts --config e2e/pii.playwright.config.ts
```

```bash
# Post-merge e2e tests (dashboard, auth, routes, package integrity)
# Runs automatically in Phase 3 of the post-merge hook.
# Manual run:
npx playwright test --config e2e/post-merge.playwright.config.ts
```

If all tests pass, you're likely safe. If any fail, check the sections below.

## 2. High-risk files to inspect after merge

These files have our middleware insertions. If they have merge conflicts or upstream changes, verify the middleware chain is correct.

### Route files (middleware chain order matters)

| File | What to check |
|------|--------------|
| `api/server/routes/agents/chat.js` | `createDetectPII({ responseFormat: 'sse' })` is in `router.use()` after `moderateText` |
| `api/server/routes/assistants/chatV1.js` | `createDetectPII(...)` before `validateModel`, `sendPiiWarning` after `setHeaders` |
| `api/server/routes/assistants/chatV2.js` | Same as chatV1 |
| `api/server/routes/agents/openai.js` | `createDetectPII({ responseFormat: 'json', isApiRoute: true })` after `checkRemoteAgentsFeature` |
| `api/server/routes/agents/responses.js` | Same as openai.js |

### Middleware registry

| File | What to check |
|------|--------------|
| `api/server/middleware/index.js` | `createDetectPII` and `sendPiiWarning` are imported and exported |
| `api/server/middleware/detectPII.js` | Our file — shouldn't conflict, but verify imports still resolve |

### Client SSE hooks

| File | What to check |
|------|--------------|
| `client/src/hooks/SSE/useResumableSSE.ts` | `useToastContext` import, `data.warning` check in `startGeneration` |
| `client/src/hooks/SSE/useSSE.ts` | `useToastContext` import, `data.warning` check in message handler |

### Package files

| File | What to check |
|------|--------------|
| `packages/data-provider/src/config.ts` | `PII_DETECTION` in `ErrorTypes` enum |
| `packages/data-schemas/src/models/index.ts` | `GuardrailEvent` in `createModels()` |

### Admin & reporting

| File | What to check |
|------|--------------|
| `api/server/routes/admin/usage.js` | Our guardrail endpoints and conversation viewer endpoint still present |
| `api/server/routes/index.js` | `adminUsage` is imported and re-exported (alphabetical neighbours `adminUsers`/`adminGrants` from main can silently displace it on merge) |
| `api/server/index.js` | `app.use('/api/admin/usage', routes.adminUsage)` is mounted; without it `/d/reporting` shows "Failed to load overview/trends data" |
| `client/src/routes/index.tsx` | Admin conversation viewer route still registered |

## 3. After resolving conflicts

```bash
# Rebuild all packages
npm run build:packages

# Rebuild frontend
npm run frontend

# Run ALL PII tests
cd api && npx jest --testPathPatterns="detectPII|pii-middleware" --no-coverage

# Restart Docker container
docker compose restart api
```

## 4. Common merge conflict patterns

### New middleware added to a route
If upstream adds a new middleware to a route we modified, our `createDetectPII` line may shift. Resolve by ensuring it stays in the correct position:
- Agent chat: after `moderateText`, before access checks
- Assistant chat: before `validateModel`
- API routes: after `checkRemoteAgentsFeature`, before `checkAgentPermission`

### SSE hook refactored
If upstream refactors `useResumableSSE.ts` or `useSSE.ts`, re-add the warning handling:
- Import `useToastContext` from `@librechat/client`
- In `startGeneration`: check `data.warning` after getting the POST response
- In SSE message handler: check `data.warning` before other event types

### ErrorTypes enum changed
If upstream modifies `packages/data-provider/src/config.ts`, ensure `PII_DETECTION = 'pii_detection'` is still in the `ErrorTypes` enum.

### New chat route type added
If upstream adds a new chat route (e.g., a new API format), it needs:
1. `createDetectPII(...)` in its middleware chain
2. Text extraction support in `extractTextForPII()` for its request body format
3. An integration test in `pii-middleware-chain.spec.js`

## 5. Quick smoke test (manual)

After merge + rebuild + restart:
1. Set `PII_DETECTION_MODE=warn` in `.env`
2. Send a message with PII (e.g., "My name is John Smith")
3. Verify: warning toast appears, message goes through, guardrail event shows in admin dashboard
4. Set `PII_DETECTION_MODE=detect`
5. Send a PII message
6. Verify: message is blocked with error

## 6. Files we own (low conflict risk)

These are new files we created — they shouldn't conflict with upstream:
- `api/server/middleware/detectPII.js`
- `api/server/middleware/__tests__/detectPII.spec.js`
- `api/server/routes/__tests__/pii-middleware-chain.spec.js`
- `e2e/specs/pii-detection.spec.ts`
- `client/src/components/Admin/Reporting/GuardrailEventsSection.tsx`
- `client/src/components/Admin/Reporting/AdminConversationViewer.tsx`
- `packages/data-schemas/src/schema/guardrailEvent.ts`
- `packages/data-schemas/src/models/guardrailEvent.ts`
