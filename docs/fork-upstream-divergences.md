# Fork ↔ Upstream Divergence Registry

**Single index of every place the MemodoAI fork hooks into or modifies upstream LibreChat.**
Read this **before any merge from upstream `main` or version upgrade** — each entry is something a
naive merge can silently clobber or a conflict resolution can drop. This file is the map; the
authoritative *detail* for each entry lives in the linked doc (ADR / spec / feature checklist), which
this registry deliberately does **not** duplicate.

> Created 2026-07-15 (prompted by the Finding #6 M365 OBO patch — a fork edit to upstream MCP internals
> that would otherwise have no home). **Living doc:** when you add a fork feature that touches an
> upstream file, add an entry here.

## Why this exists

The fork's customizations are individually documented, but were **scattered** across per-feature docs,
so there was no single "did the upgrade preserve all of it?" view. Two aggravating facts make an index
necessary rather than nice-to-have:

- **CI does not run on the `pablo`/feature merge path** (SPEC-018 Item 15) — a broken fork hook will not
  be caught automatically at merge time. Re-checks are local/manual (plus the Husky hook below).
- Several divergences are **edits to upstream files** (not just fork-owned new files), so upstream
  changes to those same files produce conflicts or silent overwrites on merge.

## How to use on an upstream merge / upgrade

1. Merge upstream (or bump the base version).
2. **Run the automation** — the `.husky/post-merge` hook fires on `git merge`/`git pull` and
   `scripts/pii-merge-verify.sh` runs on demand. It covers entries **1 (PII)** and **2 (reporting)**.
3. **Walk every entry below** and perform its *Re-check* for anything the automation does not cover
   (entries 3–7 are manual). The *Invariant* column is what must stay true regardless of how upstream
   refactored the surrounding code.
4. **Rebuild + redeploy the affected `dist`** — build with **Node 22.18** (`.nvmrc` says 24 but none is
   installed; the tsdown/rolldown toolchain was validated on 22.18), then ship per the deploy discipline
   in `CLAUDE.md` (bind-mounted `dist` → `prod-sync.sh` for prod, `rsync packages/*/dist` + `./test.sh`
   for the test box — **not** git-pull for `packages/*/src` changes).

---

## Divergence entries

### 1. PII / redakt detection (streaming guardrail)

- **What:** redakt-backed PII detection hooked into the chat request/stream path; warn-toast + block modes.
- **Upstream files touched:** `client/src/hooks/SSE/useSSE.ts`, `client/src/hooks/SSE/useResumableSSE.ts`
  (warning handling); route middleware chains in `api/server/routes/agents/chat.js`,
  `assistants/chatV1.js`/`chatV2.js`, `agents/openai.js`, `agents/responses.js`;
  `api/server/middleware/index.js` (exports); `packages/data-provider/src/config.ts`
  (`ErrorTypes.PII_DETECTION`); `packages/data-schemas/src/models/index.ts` (`GuardrailEvent`).
- **Fork-owned new files:** `api/server/middleware/detectPII.js`, guardrailEvent schema/model, reporting
  components (see entry 2), e2e specs.
- **Invariant:** `createDetectPII` present in the correct position of **every** chat route's middleware
  chain; SSE `data.warning` handling present in both hooks; `ErrorTypes.PII_DETECTION` present.
- **Detail + re-check:** **`docs/pii-merge-checklist.md`** (§2 high-risk files, §4 conflict patterns).
- **Automation:** `.husky/post-merge` Phases 0–3 + `scripts/pii-merge-verify.sh`. ✅ covered.

### 2. Admin reporting dashboard (`/d/reporting`)

- **What:** fork-added admin usage/cost/activity reporting + guardrail-events view + conversation viewer.
- **Upstream files touched:** `api/server/routes/index.js` (`adminUsage` import + re-export — upstream's
  `adminUsers`/`adminGrants` neighbours can displace it on merge), `api/server/index.js`
  (`app.use('/api/admin/usage', …)` mount), `client/src/routes/index.tsx` (viewer route), nav links.
- **Fork-owned new files:** `api/server/routes/admin/usage.js`,
  `client/src/components/Admin/Reporting/*`.
- **Invariant:** `adminUsage` imported **and** re-exported **and** mounted (all three); reporting routes
  registered — else `/d/reporting` shows "Failed to load overview/trends data".
- **Detail + re-check:** **`docs/pii-merge-checklist.md`** (§2 "Admin & reporting"); SPEC-008.
- **Automation:** `.husky/post-merge` Phase 3 (post-merge Playwright hits the dashboard). ✅ covered.

### 3. M365 MCP native-OBO authentication

- **What:** Entra-delegated M365 MCP server authenticated via LibreChat-native On-Behalf-Of (fork owns
  the OBO resolver + trust-gate wiring and has **patched upstream MCP internals** where the inherited
  OBO path was incomplete — Finding #6).
- **Upstream files touched:** `packages/api/src/mcp/MCPManager.ts` (`callTool` forwards the OBO/graph
  resolvers), `packages/api/src/mcp/oauth/OAuthReconnectionManager.ts` (`tryReconnect` skips OBO
  servers), `MCPConnectionFactory.ts`, `UserConnectionManager.ts`, `oauth/tokens.ts`, `oauth/obo.ts`;
  `librechat.yaml` (`Microsoft365.obo` + `serverInstructions` + REQ-028 checksum).
- **Fork-owned new files:** `api/server/services/OboTokenService.js`, `OboPolicyService.js`,
  `GraphTokenService.js`, `packages/api/src/utils/graph.ts` (also shared with people-search).
- **Invariant:** **every MCP connection-creation path for an OBO server must receive `oboTokenResolver`
  (so `usesObo` is true), or must not attempt the connection at all** (background / no-live-assertion
  contexts). If upstream later fixes the resolver threading itself, drop our patch in favour of upstream.
- **Detail + re-check:** **`SDD/adr/0004-mcp-native-obo-over-handrolled-byot.md`** (2026-07-15 follow-up
  has the step-by-step re-check). Run `cd packages/api && npx jest src/mcp/__tests__/MCPManager.test.ts
  src/mcp/oauth/OAuthReconnectionManager.test.ts` — 2 regression tests guard the Finding #6 edits.
- **Automation:** ❌ none — **manual re-check required.** Consider upstreaming the fix.

### 4. conv-log sidecar + guardrail mirror

- **What:** a sidecar service streams conversation + guardrail events to Postgres for Grafana; the app
  back-links guardrail events to the real message/conversation ids.
- **Upstream files touched:** the guardrail/PII join-key back-link in `ResumableAgentController` and the
  `request.js` message-id path (fork insertions on the response path).
- **Fork-owned new files:** the `conv-log` sidecar service (builds from source on the box), its Postgres
  schema, Grafana dashboards.
- **Invariant:** guardrail events mirror to Postgres with `message_id`/`conversation_id` back-links; the
  guardrail sync watermark stays **decoupled** from the message-sync watermark.
- **Detail + re-check:** SPEC-016 / SPEC-017; memory `project_convlog_guardrail_mirror`,
  `project_grafana_conv_log_dashboards`. Deploy = `./test.sh up -d --build conv-log` (sidecar builds
  from source; not a `packages/*/dist` change).
- **Automation:** ❌ none — manual.

### 5. Serper dashboard nav link

- **What:** admin-gated external nav link to the Serper usage dashboard.
- **Upstream files touched:** `client/src/hooks/Nav/useSideNavLinks.ts` (+ `com_nav_serper_dashboard`
  localization key in `client/src/locales/en/translation.json`).
- **Invariant:** link present and **admin-gated** (`isAdmin`). Low clobber risk (additive), but a nav
  refactor upstream can drop it.
- **Detail:** memory `project_m365_mcp_integration` (2026-07-06 update).
- **Automation:** ❌ none — manual (visual check).

### 6. Build-metadata injection (Settings → About)

- **What:** inject git commit/branch/date so the About panel shows real build info (Finding #3).
- **Upstream files touched:** `docker-compose.override.yml` + `docker-compose.prod.yml` (pass
  `BUILD_COMMIT`/`BUILD_BRANCH`/`BUILD_DATE` env to the api service). Consumer
  `packages/api/src/app/build.ts` (`resolveBuildInfo`) is upstream but already prefers env.
- **Fork-owned surface:** `prod.sh` / `test.sh` / `rebuild-local.sh` export the `BUILD_*` vars from host
  git at recreate time.
- **Invariant:** `BUILD_*` exported at recreate → passed to the container → consumed by `resolveBuildInfo`
  → `/api/config` `buildInfo` populated (not `–`).
- **Detail:** Finding #3 in `docs/test-verification-015-m365-obo-v0.8.7.md`.
- **Automation:** ❌ none — manual.

### 7. Compose fork-customization bind-mounts

- **What:** the mechanism that overlays the upstream image with the fork's built `dist` + `api/server`.
- **Upstream/infra files:** `docker-compose.override.yml` (dev/base) and `docker-compose.prod.yml`
  (`volumes: !override`) each list the **same five** bind-mount paths: `packages/api/dist`,
  `packages/data-schemas/dist`, `packages/data-provider/dist`, `client/dist`, `api/server`.
- **Invariant:** both files list the identical five paths (prod uses `!override`, so the list is
  duplicated and must be kept in sync — the files carry in-line "KEEP IN SYNC" comments). `prod-sync.sh`
  pushes exactly these paths.
- **Detail:** in-file comments; `CLAUDE.md` "Production Deploy Discipline"; `prod-sync.sh`.
- **Automation:** `prod-sync.sh` has a guard that refuses to run if a local `dist` dir is missing.

---

## Config-level divergences (fork-owned files, lower clobber risk)

These live in fork-owned config (`librechat.yaml`, `.env`/`.env.prod`, compose), so an upstream **code**
merge does not overwrite them — but a schema/interface change upstream can still require re-alignment:

- `librechat.yaml` `endpoints.agents.capabilities` must include `"tools"` (gates all MCP tools) and the
  adopted set `memory`/`chain`/`skills` (see `docs/v0.8.7-feature-adoption-decisions.md`).
- Legacy `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY` must stay **neutralized** for the LibreChat
  container (v0.8.7 regression — misroutes tool-bearing completions to Switzerland → 401). See memory
  `project_azure_endpoint_env_leak` + deploy-checklist item 1b.
- `modelSpecs.enforce` must stay `false` (true breaks agent chat — memory `project_modelspecs_agents_gotcha`).
- Entra OBO `.env` scope set (`OPENID_SCOPE` incl. the `api://…/access_as_user` app scope, userinfo OBO
  flow vars) — deploy-checklist item 1.

## Related indexes

- **Deploy:** `CLAUDE.md` "Production Deploy Discipline"; `docs/deploy-checklist-015-m365-obo-v0.8.7.md`.
- **Upstream changelog (what upstream itself changed):** `docs/upgrade-v0.8.7-rc1-changes.md`.
- **Operational runbooks (not divergences):** `docs/runbooks/`.
