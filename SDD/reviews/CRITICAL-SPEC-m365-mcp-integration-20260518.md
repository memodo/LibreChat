# Critical Review: SPEC-014 M365 MCP Integration

**Date:** 2026-05-18
**Spec reviewed:** SDD/requirements/SPEC-014-m365-mcp-integration.md (~593 lines, post-iter3 fixes)
**Research foundation:** SDD/research/RESEARCH-005-m365-mcp-integration.md
**Iter3 panel review:** SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md
**Reviewer role:** Adversarial generalist (complementary to the specialist panel that already ran 3 iterations).

## Executive Summary

The spec is unusually thorough — three iterations of specialist panel, ADRs already published, explicit cancellation semantics, pin-policy unified under OD-1, eight-code error envelope with `schemaVersion`/`throttleSource`, and a 18-step Verification Plan. That maturity narrows the residual surface but does not eliminate it. After dedicated adversarial reading I find **2 HIGH / 8 MEDIUM / 9 LOW** issues, almost all in territory the panel did not cover: build-time supply-chain verification (REQ-002 npm tarball SHA is recorded but no command verifies it), implementation-locus ambiguity (REQ-024 FIFO queue / REQ-025 cancellation / PERF-003 emission-time refresh all live "in LibreChat's MCP layer" without a named file), state hygiene during API restarts (REQ-014's "restart-only deploy" silently drops in-flight tool calls and the spec does not say so), cross-spec interaction with SPEC-009 PII detection (Verification §11 names a "test mailbox" infrastructure that does not exist anywhere else in the repo), and governance-gate enforceability (OD-6 is "blocking for production rollout" but the spec does not say who has authority to attest closure or how CI/release would check it). One HIGH is a structural ambiguity around REQ-024 + REQ-025 cancellation: the spec demands a per-user slot counter with grace-fallback at 50s but never names where the slot counter lives, where AbortController is wired into MCPManager, or which existing class owns the FIFO queue — two reasonable implementers would build this in two incompatible places. The spec is **NOT** implementation-ready as drafted; one more focused pass (≤1 day of edits, no panel re-run) closes the gaps.

## Severity Summary

- HIGH: 2
- MEDIUM: 8
- LOW: 9

## Ambiguities That Will Cause Problems

- **REQ-024 / REQ-025 — implementation locus of the FIFO queue, slot counter, and cancellation pump is unspecified**
  - The spec describes the behavior (cap 4 in-flight per user / 8 per conversation, depth-cap 16/32, queue-wait 14s, FIFO, AbortController-style cancellation, grace fallback at 50s, slot release on outer-MCP-timeout) but never names a class/file in which any of this lives.
  - Possible interpretations:
    - (A) New class in `packages/api/src/mcp/` (e.g., `MCPCallQueue.ts`) wrapping `MCPManager.callTool`.
    - (B) Surgical insertion inside `MCPManager` itself (the file already owns connection lifecycle).
    - (C) A higher-level wrapper at the agent-tool dispatch layer (in `@librechat/agents` or in `api/server/services/MCP.js`).
    - (D) A per-server hook configured under `mcpServers.Microsoft365` (would imply config-shaped semantics; spec mentions no such hook in REQ-004's YAML schema).
  - Each interpretation has different implications for testability (does the unit test in Verification §17 import from `packages/api/src/mcp/...` or from `api/server/services/...`?), backward compatibility (would the queue apply to OTHER MCP servers or only `Microsoft365`?), and risk tier (MODULE-001 or MODULE-002).
  - Recommended clarification: Add a sentence to REQ-024 — "Implementation lives in a new `MCPCallQueue` module at `packages/api/src/mcp/queue.ts`, wired into `MCPManager.callTool` via composition; the queue is per-MCP-server (instance per server name) so its bounds (4/8 in-flight, 16/32 queued) apply to `Microsoft365` only and do not back-port to other servers." Also name the AbortController wiring point ("the queue passes an `AbortSignal` through to the streamable-http transport's `fetch` call").

- **REQ-018 healthcheck — what does `wget --spider /mcp` actually assert?**
  - The combined probe is `nc -z localhost 3000 && (wget --spider /health || wget --spider /mcp)`. `wget --spider` on `/mcp` returns success on *any* non-5xx status. The streamable-http MCP endpoint normally requires an MCP-protocol POST (with `Mcp-Session-Id`/protocol-version headers per the streamable-http spec) — a bare HEAD/GET probe will typically return 400 or 405, which `wget --spider` will treat as failure.
  - Possible interpretations:
    - (A) `--spider` returns success on 400/405 (it does NOT by default — wget treats any non-2xx/3xx as failure with exit code 8).
    - (B) Implementation PR is expected to add a custom non-MCP `/health` endpoint via a wrapper, which contradicts SEC-006 ("install nothing else").
    - (C) The Softeria server happens to return 200 on bare GET `/mcp` even without protocol headers (undocumented, version-dependent).
  - Recommended clarification: Spec should specify either (a) "the readiness probe is `wget --spider --server-response /mcp 2>&1 | grep -E 'HTTP/.* (200|400|405)'` accepting any HTTP response as proof-of-life", or (b) require `/health` and bring OD-5 to a forced decision — if Softeria does not expose `/health`, the implementation PR adds a tiny `/health` endpoint via a thin sidecar proxy (which is allowed under SEC-006 because the proxy is image-build-time content, not runtime mutation).

- **REQ-021 — "≤3 attempts, base 200ms, full jitter" but no statement about WHICH errors are retried inside single-flight vs. surfaced**
  - REQ-021 says "distinguish Entra HTTP 429 (retried inside single-flight as above) from a genuine missing-token / consent-denied failure". But 429 is one specific code; what about HTTP 500/502/503/504 from `login.microsoftonline.com`? Network errors (ECONNRESET, ETIMEDOUT)? The implementer will guess.
  - Possible interpretations: Retry only on 429 (strict); retry on 5xx + 429 + transient network; retry on all non-4xx; retry on everything except 400/401/403.
  - Recommended clarification: Add one line — "Retry inside single-flight on: Entra HTTP 429, 500, 502, 503, 504, and transport-level errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT). Surface immediately (no retry) on: 400, 401 (likely revoked consent), 403 (`AADSTS65001` etc.), 404."

- **REQ-002 — npm tarball SHA-256 is recorded but no command verifies it**
  - REQ-002 says the resolved tarball SHA-256 (via `npm view ... dist.integrity`) is recorded as a Dockerfile comment. The Dockerfile then runs `npm install -g @softeria/ms-365-mcp-server@<resolved-semver>`. `npm install` checks integrity against `package-lock.json` for local installs, NOT against the recorded-in-comment value for a `-g` install of a single package by name. A compromised registry mirror or a tarball overwrite (theoretical for an old version) would not be caught.
  - Possible interpretations:
    - (A) The comment is documentation-only and the implementer is expected to add a verification step.
    - (B) The implementer is expected to use `npm pack`/`npm install --integrity=...`/`npm audit signatures`, but none of those are specified.
    - (C) The implementer trusts the npm registry CDN (this is what `npm install -g <name>@<semver>` does).
  - Recommended clarification: Add an explicit verification step in REQ-002 — "The Dockerfile MUST run `npm pack --pack-destination /tmp/softeria @softeria/ms-365-mcp-server@<semver> && echo '<integrity-hash>  /tmp/softeria/softeria-ms-365-mcp-server-<semver>.tgz' | sha256sum -c -` (or equivalent) BEFORE `npm install -g`, and FAIL the build if the recorded SHA does not match the actual downloaded tarball."

- **REQ-014 — "restart-only deploy" silent about in-flight tool calls**
  - REQ-014 says "Restarting the API (`./prod.sh restart api`) is the only LibreChat-side action needed after `librechat.yaml` changes." OPS-004 reaffirms restarts. But the spec is silent on: (a) what happens to in-flight `Microsoft365` tool calls during the restart, (b) whether conversation state survives, (c) whether agents see a clean error vs. a hung stream.
  - Recommended clarification: Add one sentence to REQ-014 — "In-flight Microsoft365 tool calls during API restart are aborted; affected agent turns surface `code: SidecarUnavailable` per the Error Response Schema. Conversation state (messages already persisted) survives the restart; in-progress non-persisted tool output is lost. Users may need to re-issue the request after restart."

## Missing Specifications

- **Build-time tarball integrity verification (REQ-002)** — see Ambiguity #4 above. The release gate around the recorded SHA does not enforce anything; it documents a value that nothing checks. Impl PR will land with a "we trust the npm registry" posture that is incompatible with the "release-gate Dockerfile integrity" language in REQ-002.

- **Local working-tree vs. committed `mcp-m365/VERSION` reconciliation at build time on prod**
  - REQ-013 says the sidecar builds from the repo path on the prod host (`./prod.sh build mcp-m365`). The Dockerfile reads its values from the prod host's checkout. If `git pull` produces a working tree that does NOT match `mcp-m365/VERSION` (e.g., partial pull, conflict, manual local edit), the build can land with a Dockerfile referring to one version and a `VERSION` file claiming another.
  - Suggested addition: REQ-002 or REQ-013 — "Build sanity check: before `npm install`, the Dockerfile asserts the resolved semver in the `RUN npm install -g ...@<semver>` line matches the contents of `/build/mcp-m365/VERSION` (COPY-d in earlier in the build). Mismatch fails the build."

- **OD-6 enforcement mechanism**
  - OD-6 is "blocking for production rollout" but the spec never says HOW. Who attests OD-6 closure? Manual checklist in the implementation PR description? CI step (and against what)? Tagged release? A `OD-6-closed` git tag? Without this, the gate is honor-system.
  - Why it matters: After 3 iterations and an ADR, OD-6 is the single biggest blocker. If the impl PR merges and reaches prod without OD-6 closure, every iteration's compliance language becomes theatre.
  - Suggested addition: Add an OD-6 closure subsection — "Closure requires: (a) DPO-equivalent written acknowledgement in `SDD/governance/OD-6-closure-2026-NN.md` listing all five preconditions explicitly closed; (b) the implementation PR body includes a checkbox referencing that file; (c) the prod deploy command in §Implementation Plan §6 is gated by a pre-deploy check (`test -f SDD/governance/OD-6-closure-*.md || (echo 'ABORT: OD-6 not closed'; exit 1)`)."

- **Test infrastructure for Verification §11 PII canary**
  - Verification §11 says: "Seed a known synthetic PII token (e.g., a recognizable test email `pii-canary@memodo-test.de`, a synthetic IBAN `DE00 1234 5678 9012 3456 78`) into a test mailbox and/or a test SharePoint document accessible to the test user." The spec does not say: which Entra test user, where this mailbox lives (a real M365 tenant? a fixture? memodo-test.de domain?), how the test sign-in works in CI, or whether this is a one-time manual smoke or an automated regression.
  - Why it matters: SPEC-009 PII detection's tool-output path is the highest-blast-radius privacy assertion of this whole spec (REQ-019 references it). If the test infrastructure is undefined, the assertion is unverified.
  - Suggested addition: A short subsection — "PII canary test infrastructure: requires a dedicated Memodo Entra test account (`librechat-test@memodo.de`, separate from prod-user accounts) with seeded fixtures (one mail with the IBAN/canary, one SharePoint doc with the IBAN). Fixtures are created out-of-band (manual Azure/M365 setup, one-time) and their existence is documented in `mcp-m365/test-fixtures.md`. The test is a manual smoke step in dev, not automated CI (CI lacks Entra-test-user credentials)."

- **`@librechat/agents` upstream-version exposure in spec**
  - REQ-027 names protocolVersion as governed by `@librechat/agents` (and REL-002 corrects to `packages/api/src/mcp/mcpConfig.ts`). But REQ-021/024/025 reference behavior that depends on whether MCPManager uses `AbortController` natively, whether `connection.ts` exposes the bulk of the call-tool path, and whether `MCPManager.callTool` returns a Promise that honors cancellation. None of this is asserted; the impl PR will discover and adapt.
  - Suggested addition: Pin a `@librechat/agents` version + version range in REQ-027 (it currently only pins protocolVersion); add a sanity-check note that the implementation PR verifies `MCPManager.callTool` is wrappable in the queue layer (see ambiguity #1).

- **REQ-024 queue + REQ-025 cancellation interaction with `startup: true`**
  - REQ-004 sets `startup: true` on the `Microsoft365` server, meaning MCPManager connects at API startup, not on first user request. The REQ-021 thundering-herd test in Verification negative tests (and §15) imagines per-user OBO calls at restart, but `startup: true` connects the server (not the per-user tokens). The relationship between `startup: true` (server-level connect) and per-user Bearer header emission (REQ-020 says "at every call") is not stated. Does `startup: true` issue a Bearer-less connect, then per-call Bearer? Or does it defer connect until the first user call?
  - Suggested addition: One sentence in REQ-004 or REQ-007 — "`startup: true` performs the MCP protocol handshake and tool-list registration at API startup with no `Authorization` header (the placeholder resolves to null in the bootstrap context). Per-call Bearer header emission per REQ-020 happens only on `tools/call`, not on `initialize` or `tools/list`. Softeria MUST accept `initialize`/`tools/list` without authentication."

- **Cold-start measurement baseline source**
  - PERF-001 says "store the baseline in `mcp-m365/perf-baseline.json` (cold-start p50/p95/p99 + steady-state p50/p95/p99)." But how is the baseline FIRST established? The impl PR cannot ship a baseline without measurements; measurements require a deploy. Chicken-and-egg.
  - Suggested addition: One sentence — "The first 10 cold-starts post-rollout establish the baseline; the baseline file is committed in a follow-up PR after week 1, not as part of the implementation PR."

- **REQ-024 queue interaction with cross-conversation users**
  - REQ-024 says "per-user wins for a single-conversation user; per-conversation wins when multiple users share one conversation." LibreChat conversations are normally single-user; the "multiple users share one conversation" case is unusual (collaborative agents? shared sessions?). The spec does not say what triggers the second case.
  - Suggested addition: Either explicit "phase-1 conversations are single-user; the per-conversation cap is informational and not currently exercised" — or define the multi-user case (link to whichever feature exposes it).

## Research Disconnects

- **RESEARCH-005 §"LibreChat's Existing M365 Integration Points" mentions the SharePoint file picker.** SPEC-014 declares the picker out of scope (REQ-017) but does not assert the picker remains FUNCTIONAL during SPEC-014 rollout. If both share `OPENID_GRAPH_SCOPES` and the spec adds `Files.Read.All`, that may interact with `SHAREPOINT_PICKER_GRAPH_SCOPE` (default `Files.Read.All`). The interaction direction (positive — picker scopes already included; or negative — order/case in env var matters) is not verified. RESEARCH-005 left this open; SPEC-014 should at minimum note the no-regression expectation.

- **RESEARCH-005 §"Comparison Matrix" notes Softeria supports `--org-mode` for Teams write tools.** SPEC-014 disables `--org-mode` for phase 1 (REQ-010). But Softeria's *read* tools for SharePoint and Teams may behave differently without `--org-mode` — research mentions "`Teams & Chats` requires `--org-mode`" and "`SharePoint` requires `--org-mode`". If `--org-mode` is required even for read access to SharePoint/Teams, the spec contradicts itself (REQ-008 grants `Sites.Read.All` and `Team.ReadBasic.All`/`Chat.Read` are in REQ-008 implicitly via the broad scope grant, but the entrypoint disables the tools that USE those scopes). The implementer will be confused on first dev build.

- **RESEARCH-005 §"Decision Points #2 — Transport type"** explicitly compared stdio vs HTTP and recommended HTTP for Docker deployment. SPEC-014 picks `streamable-http`. Research used `sse`/`streamable-http` interchangeably in places (Option A vs Option B example) — SPEC-014 picks `streamable-http`, which is correct per March 2025 MCP-spec SSE deprecation. The disconnect is minor: SPEC-014 should briefly note "SSE rejected because deprecated in MCP spec March 2025" in REQ-004 — research has this rationale but the spec does not surface it for readers who skip the research.

- **RESEARCH-014 stub** says "the May 2026 verification pass (Pablo's Obsidian note 'LibreChat M365 Integration (May 2026)') re-confirmed RESEARCH-005's findings". That note is NOT in the repo. The spec implicitly relies on it for currency assertions; if a future reader cannot find it, the freshness claim is unverifiable. Recommend either inlining the verification key findings into RESEARCH-014 (it is the right place) or removing the reference.

## Cross-Spec Interactions

- **SPEC-009 (PII Detection) — REQ-019 traversal**
  - REQ-019 records the expectation that Microsoft365 tool output flows through SPEC-009 PII detection. Two cross-spec concerns:
    1. **SPEC-009 modes (`detect`/`warn`/`block`?) and the Error Schema interaction.** What if SPEC-009 is in a `block` mode that prevents tool output from reaching the agent? Verification §11 names `detect` and `warn` only. If SPEC-009 also has a blocking mode, SPEC-014's Error Schema may need a `PIIBlocked` code — not present. Project memory indicates SPEC-009 is `detect/warn` only; if so, OK; otherwise a contract gap.
    2. **Performance budget interaction.** PERF-002 budgets p95 ≤ 3s end-to-end. SPEC-009 PII detection adds per-tool-output traversal cost (Redakt API). Is the SPEC-009 cost included in PERF-002's p95? If not, the real p95 will exceed budget; if yes, it should be noted.
  - Recommended action: Add one sentence to REQ-019 — "SPEC-009 PII detection cost is INCLUDED in PERF-002's end-to-end budget; if SPEC-009 adds >500ms p95, PERF-002 budgets are re-evaluated."

- **SPEC-008 (Admin Reporting Dashboard) — REQ-030 cascade**
  - REQ-030 says "Aggregates derived from M365 content (SPEC-008 admin reporting) MUST be re-aggregated after an erasure." SPEC-008 may or may not yet aggregate M365 tool output (it aggregates conversation-level metrics). Without confirming SPEC-008's aggregation surface, REQ-030 is making a promise on behalf of another spec. If SPEC-008 does not currently surface M365-content-derived aggregates, REQ-030 is vacuously true; if it does, the re-aggregation hook is undefined.
  - Recommended action: One sentence in REQ-030 — "Phase-1 SPEC-008 aggregates do NOT include M365-content-derived fields; if a future SPEC-008 amendment adds such aggregates, that amendment owns the re-aggregation hook."

- **SPEC-010 (Production Readiness)** — REQ-018 defers the liveness/readiness split to "the SPEC-010 Prometheus observability track". SPEC-010 may not have an explicit liveness/readiness split deliverable. If SPEC-010 is silent on this, SPEC-014's deferral is to a non-receiver.
  - Recommended action: Verify SPEC-010 has an "MCP-server liveness/readiness split" deliverable or amend SPEC-010 with a deferred-from-SPEC-014 line.

- **SPEC-012 (Post-Merge E2E Tests)** — No mention in SPEC-014. The Verification Plan §11 PII canary test is the obvious candidate for e2e coverage but Verification §11 says "test mailbox" not "e2e". If SPEC-012 e2e coverage is expected to include Microsoft365 tool calls, SPEC-014 should name the touchpoint; if not, the spec should explicitly opt out.

## Glossary / Vocabulary

- **`throttleSource`** — new term introduced in iter3 (Error Response Schema, REQ-024). Not in `SDD/UBIQUITOUS_LANGUAGE.md`. Should be added with the three values (`graph_429`, `librechat_queue`, `librechat_concurrency_cap`) and the rule that `retryAfter` is authoritative ONLY for `graph_429`.

- **`schemaVersion`** — new term introduced in iter3 (Error Response Schema). Not in the glossary. Should be added with the additive-evolution rule.

- **`InvalidToken` (vs. `Unauthenticated`)** — distinction introduced in iter3. Not in glossary. Worth adding because the distinction is operationally meaningful (loud alert vs. benign).

- **`deterministic-failure short-circuit`** — REQ-027's named concept. Not in glossary. Worth adding because the term is used in the spec without elsewhere reference.

- **"Cascading-timeout invariant"** — REQ-025's named hard constraint. Not in glossary. Worth adding as a named pattern (other future MCP integrations should follow the same).

- **`mcp-m365` vs. `Microsoft365`** — the container name is `mcp-m365` (kebab-case, Docker-DNS-safe) but the `mcpServers` YAML key is `Microsoft365` (CamelCase, prompt-friendly). The two names point at the same entity. The glossary names `mcp-m365` (MCP sidecar entry) but not `Microsoft365`; the spec uses both interchangeably in some places. Should codify which name is used where (cosmetic but reduces friction).

- **`BYOT`, `OBO`, `Graph access token`, `delegated Graph scopes`** — already in glossary, correctly used.

## ADR Consistency

- **ADR 0001 (BYOT over OBO)** — SPEC-014 is consistent. No requirement re-introduces Softeria-side OAuth, app-only, or per-server independent OAuth.

- **ADR 0002 (read-only default scopes)** — SPEC-014 is consistent. REQ-008 phase-1 scopes are all `.Read`/`.Read.All`; REQ-010 disables `--org-mode`; SEC-003 names read-only blast radius; OD-4 names the soak period.

- **No contradictions found** between SPEC-014 and either ADR.

- **One minor observation:** ADR 0002 says "The current shipping scope set (per SPEC-014 REQ-008) is: User.Read, Mail.Read, Calendars.Read, Files.Read.All, Sites.Read.All, Contacts.Read, Tasks.Read, Notes.Read.All, offline_access." This list is 9 scopes; RESEARCH-005's recommended phase-1 scope list mentioned `Team.ReadBasic.All` and `Chat.Read` (Teams read access). SPEC-014 dropped them silently. The ADR matches SPEC-014; the disconnect is with RESEARCH-005 (research disconnect, not ADR disconnect). See research-disconnect section above for Teams-read implications under `--org-mode`-disabled posture.

## Risk Reassessment

- **MODULE-002 risk tier "medium"** — appropriate, possibly understated. Under the iter3 reshuffle MODULE-002 now owns REQ-020 (JWT invariants), REQ-021 (single-flight), REQ-022 (cache key), REQ-024 (queue), REQ-027 (protocol pin), REQ-028 (serverInstructions drift), REQ-029 (retention), REQ-030 (DSR), AND modifies `GraphTokenService`. The risk surface for this module is wider than the "medium" tag suggests; arguably this is the single most touched module in SPEC-014 and warrants either a tier bump or a sub-module split.

- **MODULE-003 risk tier "medium"** — appropriate. Admin-consent irreversibility justifies the tier.

- **MODULE-001 risk tier "medium"** — appropriate, but the iter3 SEC-006 egress restriction (release gate) shifts substantial new responsibility onto this module (network-level egress allowlist mechanism). If the chosen mechanism is `iptables`-on-netns, the module now owns network-policy code that the team has not historically managed. The risk tier covers this; the risk *narrative* in the module description does not name network-policy ownership.

- **Implicit risk under-covered:** the spec assumes the Memodo Entra tenant admin will perform the admin-consent for the 9 delegated scopes (REQ-008) at the right time relative to the deploy. If admin consent lags the deploy, users hit `InsufficientScope` in waves. The spec does not name the consent-grant ordering relative to deploy. (Implementation Plan §4 says "Grant admin consent on the Memodo Entra app registration" — does this happen before or after `./prod.sh up`?)
  - Recommended action: Implementation Plan §6 should be re-ordered to make admin consent step #4 (before deploy step #6), and add a sanity-check ("verify admin-consent before the prod deploy via `https://login.microsoftonline.com/<tenant>/adminconsent?client_id=<client-id>` and confirm all 9 scopes are listed and granted").

## Recommended Actions Before Proceeding

### HIGH

1. **Name the implementation locus of REQ-024 FIFO queue / REQ-025 cancellation / PERF-003 emission-time refresh.** Add a sentence to REQ-024 specifying the new module path (suggested: `packages/api/src/mcp/queue.ts`), how it composes with `MCPManager.callTool`, and the AbortController wiring point. Without this, two reasonable implementers build two incompatible solutions and the panel-pinned cascading-timeout invariant cannot be unit-tested as a single import.

2. **Specify build-time tarball integrity verification in REQ-002.** The recorded SHA-256 is documentation-only as drafted; `npm install -g <name>@<semver>` does not verify against the comment. Add an explicit `npm pack && sha256sum -c` (or equivalent) step in the Dockerfile that FAILS the build on mismatch. Without this, the entire OD-1 supply-chain release gate is bypassable.

### MEDIUM

1. **REQ-018 healthcheck — define what `wget --spider /mcp` asserts.** `wget --spider` returns non-zero on 400/405 (the likely response from streamable-http without protocol headers). Either specify a custom exit-code-tolerant probe OR force OD-5 to "must implement `/health`" with a permitted thin proxy.
2. **REQ-021 — name which Entra errors are retried inside single-flight.** Currently only `429` is named; impl will guess about 5xx and network errors. Add the explicit retry/no-retry table.
3. **REQ-014 — state in-flight tool-call behavior on API restart.** Add one sentence on what users see during/after `./prod.sh restart api`.
4. **OD-6 — name the enforcement mechanism.** "Blocking for production rollout" is honor-system without a CI check, a tag, or a checklist file. Add a closure subsection with a concrete attestation artifact (`SDD/governance/OD-6-closure-2026-NN.md`) and a pre-deploy assertion.
5. **Verification §11 PII canary — name the test infrastructure.** "Test mailbox" is undefined; the implementer will guess (or skip the test). Add a short `mcp-m365/test-fixtures.md` mention or inline the fixture-setup minimum.
6. **SPEC-008 / SPEC-009 / SPEC-010 cross-spec interaction notes.** Add three short lines confirming the no-regression / shared-budget / deferred-receiver assertions named in §Cross-Spec Interactions above.
7. **Glossary additions** — `throttleSource`, `schemaVersion`, `InvalidToken`, `deterministic-failure short-circuit`, `Cascading-timeout invariant`. Five short entries.
8. **MODULE-002 risk re-narrative.** The module now owns 10 REQs + modifies `GraphTokenService`; the risk paragraph should name network/control-flow surface explicitly, even if the tier stays "medium".

### LOW

1. **REQ-013 — local working-tree vs. `mcp-m365/VERSION` reconciliation at build time.** Add a Dockerfile sanity check.
2. **PERF-001 baseline source.** Note that the baseline is established post-rollout, not in the impl PR.
3. **REQ-024 cross-conversation cap clarification.** Phase-1 conversations are single-user; note this explicitly.
4. **REQ-004 `startup: true` semantics.** State that `startup: true` connects without `Authorization` header and tool-list registration is anonymous; per-call Bearer is on `tools/call` only.
5. **REQ-004 — surface the SSE rejection rationale.** Cite March 2025 MCP-spec SSE deprecation.
6. **REQ-008 vs. RESEARCH-005 Teams-read disconnect.** Either restore `Team.ReadBasic.All` / `Chat.Read` (and verify they work without `--org-mode`) or note explicitly that Teams read access is out of scope in phase 1.
7. **Implementation Plan §4 / §6 ordering.** Make admin consent step happen BEFORE deploy step and add a verification command.
8. **RESEARCH-014 stub — inline the May-2026 verification findings** or remove the Obsidian-note reference (currently unverifiable outside the repo).
9. **`mcp-m365` / `Microsoft365` naming codification.** State which name is canonical at the container layer, the YAML key layer, and the user-facing label layer.

## Verdict

**REVISE BEFORE PROCEEDING**

The spec is exceptionally well-developed for a phase-1 integration and the iter3 fix loop covered substantial ground. However, two HIGH findings (implementation-locus of the queue/cancellation/refresh logic; non-enforcement of the npm tarball SHA at build time) and several MEDIUMs around enforceability (OD-6 attestation, healthcheck probe, in-flight tool-call behavior) will cause real disagreement during implementation. A focused ~1-day revision pass — no panel re-run needed — closes the gaps. The spec is NOT implementation-ready as drafted, but it is well within striking distance.

## Findings Addressed

Step 3e fix pass completed 2026-05-18. All HIGH + MEDIUM + LOW findings resolved per the user-walked design decisions and mechanical fixes. Resolution audit trail (inline edits unless flagged as a new subsection — this round did NOT add new REQ-NNN numbers):

### HIGH

- **HIGH-1 — Implementation locus for REQ-024 / REQ-025 / PERF-003** — Resolved by inline edit to REQ-024 — Spec ref: §"Functional Requirements"/REQ-024. User decision: queue lives in NEW module `packages/api/src/mcp/queue.ts` as `MCPCallQueue` class, wired into `MCPManager.callTool` via composition, per-server-instance, bounds apply to `Microsoft365` only, AbortController passed as `AbortSignal` to streamable-http transport's `fetch`, PERF-003 token re-check lives in same dequeue path, unit tests at `packages/api/src/mcp/__tests__/queue.test.ts`. Verification §17 updated to point at this test path.
- **HIGH-2 — REQ-002 npm tarball SHA verification** — Resolved by new build-time-verification subsection appended to REQ-002 + corresponding Dockerfile updates in Implementation Plan §1 + OD-1 closure-language update — Spec ref: §"Functional Requirements"/REQ-002 and §"Implementation Plan"/§1. Dockerfile now runs `npm pack` + `sha256sum -c` against the recorded SHA-256 and FAILS the build on mismatch; verified tarball installed via local-tarball path. Filename pattern documented as PR-time verifiable.

### MEDIUM

- **MEDIUM-1 — Healthcheck probe** — Resolved by REQ-018 inline rewrite + Implementation Plan §2 Compose healthcheck block replacement + OD-5 closure language update — Spec ref: REQ-018, Implementation Plan §2, OD-5. User decision: status-tolerant `wget --server-response --spider` probe parsing HTTP status line, accepting `200|400|405|406` as proof-of-life. OD-5 RESOLVED 2026-05-18; no Softeria `/health` endpoint required.
- **MEDIUM-2 — Single-flight retry classification (REQ-021)** — Resolved by inline edit to REQ-021 adding explicit retry table + extended unit-test stub — Spec ref: REQ-021. Retry table: 429 / 500-504 / network / DNS-transient → retry inside single-flight; 400 / 401 / 403 (`AADSTS65001` etc.) / 404 / malformed-prior-OBO → surface immediately. K=10 test stub extended for 503 case.
- **MEDIUM-3 — REQ-014 in-flight tool-call behavior on API restart** — Resolved by inline edit to REQ-014 — Spec ref: REQ-014. In-flight calls aborted, surface as `code: SidecarUnavailable`; persisted conversation state survives.
- **MEDIUM-4 — OD-6 enforcement (attestation file + pre-deploy assert)** — Resolved by new OD-6 closure subsection + Implementation Plan §6 pre-deploy check — Spec ref: OD-6, Implementation Plan §6. User decision: closure file at `SDD/governance/OD-6-closure-YYYY-NN.md` (committed and tracked), PR-body checkbox, prod deploy command gated by `test -f` assertion. The `SDD/governance/` directory does NOT exist yet — the implementation PR creates it alongside the OD-6 closure file.
- **MEDIUM-5 — Verification §11 PII canary infrastructure** — Resolved by inline subsection added to Verification §11 — Spec ref: Verification Plan §11. `librechat-test@memodo.de` Entra test account + seeded mail/SharePoint fixtures, documented in committed `mcp-m365/test-fixtures.md`, manual dev smoke (not CI).
- **MEDIUM-6 — Cross-spec interaction notes (SPEC-008 / SPEC-009 / SPEC-010 / SPEC-012)** — Resolved by NEW "Cross-Spec Interactions" subsection inserted just before "Out of Scope" — Spec ref: §"Cross-Spec Interactions". Four bullet lines covering SPEC-009 budget inclusion + `PIIBlocked` deferral; SPEC-008 vacuous-truth + future-amendment ownership; SPEC-010 non-blocking deferral; SPEC-012 no automated MCP coverage in phase 1.
- **MEDIUM-7 — Glossary additions** — Resolved by 5 new entries appended to `SDD/UBIQUITOUS_LANGUAGE.md` under new "Error envelope & control-plane vocabulary" section — Glossary ref: §"Error envelope & control-plane vocabulary". Terms: `throttleSource`, `schemaVersion`, `InvalidToken` (vs. `Unauthenticated`), `deterministic-failure short-circuit`, `Cascading-timeout invariant`.
- **MEDIUM-8 — MODULE-002 risk re-narrative** — Resolved by inline edit to MODULE-002 Risk paragraph — Spec ref: §"Modules"/MODULE-002. Now explicitly names the 10+ REQs the module owns post-iter3 + the new `MCPCallQueue` module CREATED + `GraphTokenService` MODIFIED; tier remains "medium" with reviewer-attention guidance scaled to the surface count.

### LOW

- **LOW-1 — REQ-013 working-tree vs `mcp-m365/VERSION` reconciliation** — Resolved by inline addition to REQ-002 build-time block + Dockerfile sanity check in Implementation Plan §1 — Spec ref: REQ-002, Implementation Plan §1. Dockerfile asserts `$(cat /build/mcp-m365/VERSION) == ${SOFTERIA_VERSION}` before install; mismatch fails the build.
- **LOW-2 — PERF-001 baseline source** — Resolved by inline edit to PERF-001 — Spec ref: PERF-001. First 10 cold-starts establish baseline; `mcp-m365/perf-baseline.json` is committed in a week-1 follow-up PR, NOT the implementation PR; alert rule activates once baseline is committed.
- **LOW-3 — REQ-024 cross-conversation cap** — Resolved by inline edit to REQ-024 — Spec ref: REQ-024 (phase-1 cross-conversation cap clarification subsection). Per-user cap is the tighter binding; per-conversation cap is informational for phase 1.
- **LOW-4 — REQ-004 `startup: true` semantics** — Resolved by inline subsection added to REQ-004 — Spec ref: REQ-004. Startup-connect omits `Authorization`; per-call Bearer is on `tools/call` only; Softeria MUST accept `initialize`/`tools/list` anonymously.
- **LOW-5 — REQ-004 SSE rejection rationale** — Resolved by inline subsection in REQ-004 — Spec ref: REQ-004. Cites March 2025 MCP-spec SSE deprecation.
- **LOW-6 — Teams-read scope deferral note** — Resolved by inline expansion of REQ-010 + cross-reference added to REQ-008 + named entry in Out-of-Scope — Spec ref: REQ-008, REQ-010, §"Out of Scope". `--org-mode` OFF, Teams/Chat/Presence/Attendance excluded in phase 1; phase-2 follow-up: single coordinated `--org-mode` decision alongside any write-scope promotion.
- **LOW-7 — Implementation Plan §4 / §6 ordering** — Resolved by adding admin-consent verification command to §4 + reaffirming §4-before-§6 ordering — Spec ref: Implementation Plan §4 and §6. §4 now blocks §6 until admin consent verified via `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=...` with all 9 scopes listed and granted.
- **LOW-8 — RESEARCH-014 stub Obsidian-note reference** — Resolved by inlining the May 2026 verification key findings into `SDD/research/RESEARCH-014-m365-mcp-integration.md` + updating the cross-reference table — Doc ref: RESEARCH-014 §"Why no fresh research was needed". Four key findings now captured in-repo (Softeria still recommended; OBO plumbing intact in v0.8.4-rc; PR #10867 BYOT pattern; no RESEARCH-005 conclusions invalidated). External Obsidian-note dependency removed.
- **LOW-9 — `mcp-m365` / `Microsoft365` naming codification** — Resolved by inline subsection added to REQ-004 — Spec ref: REQ-004 (naming codification subsection). Container DNS name = `mcp-m365`; YAML key = `Microsoft365`; UI label = `Microsoft365`; tool-name suffix = `_mcp_Microsoft365` (MCPManager-applied per UX-001).
