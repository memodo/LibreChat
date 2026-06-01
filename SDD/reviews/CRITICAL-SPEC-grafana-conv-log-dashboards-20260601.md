# Specification Critical Review: Grafana conv-log Dashboards (SPEC-017)

- **Artifact under review:** `SDD/requirements/SPEC-017-grafana-conv-log-dashboards.md`
- **Source of truth:** `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md`
- **Reviewer:** SDD Critical-Review subagent (Step 3d), adversarial mode
- **Date:** 2026-06-01

---

## Executive Summary

**The specialist review panel (Step 3c) was NOT run** — the spec frontmatter sets `review_panel: false`. As instructed, this review therefore additionally covers the domains the panel would have owned (security/PII, data-modeling/SQL, reliability), not just generalist ambiguity/testability checks. Those domain findings are interleaved below and tagged `[panel-domain: …]`.

Overall, this is an **unusually strong, evidence-dense spec** — the two HIGH research findings (broken `convlog_reader` GRANT; missing `librechat_default` network membership) are faithfully carried, the PromQL/SQL forms are correct against the verified source code, and the testability discipline (reader-not-superuser acceptance) is genuinely sharp. I verified the headline claims against the repo and they hold: the `ALTER DEFAULT PRIVILEGES` at `provision-postgres.sh:101-102` indeed has no `FOR ROLE` clause; the `grafana` service `networks:` block at `docker-compose.monitoring.yml:134-136` indeed lists only `monitoring`, `caddy_net`; the Prometheus job label is `conv-log` (matching A-1); the 11 metrics match `index.ts:90-153`; both reference dashboards are `schemaVersion: 38`.

**However, the security/privacy boundary that is the spec's own stated highest risk (RISK-002, MODULE-004) is materially weaker than the spec represents, because of a configuration fact the spec never reckons with: `dashboards.yml:19` sets `allowUiUpdates: true`.** Combined with OSS Grafana's Explore tab and ad-hoc querying against a fully-SELECT-capable datasource, the "collapsed row" is a soft visual default, not an enforcement boundary. The spec acknowledges "no per-panel RBAC" but then treats the collapsed row as if it were the boundary. This is the single most important gap. There is also a real credential-sync ambiguity (`GRAFANA_CONVLOG_DB_PASSWORD` vs the existing `convlog_reader` password) and a missing PII column (`messages_log.content`) in the SEC-001 exclusion list.

**Verdict: REVISE BEFORE PROCEEDING.** No finding is a hard STOP — the safe-default posture means the feature can largely proceed — but the privacy-boundary framing, the credential-sync gap, and the `content` omission should be corrected in the spec before implementation, because they are exactly the kind of ambiguity that produces a PII leak or a silently-broken datasource in production.

---

## Severity: HIGH (driven by the privacy-boundary framing gap on a real-prod-PII surface)

- **HIGH:** 2
- **MEDIUM:** 5
- **LOW:** 3

---

## Findings

### HIGH-1 — The privacy boundary is framed as enforcement; `allowUiUpdates: true` + Explore + ad-hoc query make it only a soft default `[panel-domain: security/PII]`

**Evidence:** SEC-001 (spec:117) states "the single Grafana-admin gate ... plus the collapsed-row design **IS the boundary**." MODULE-004 (spec:237-242) calls the collapsed row "the enforcement mechanism." But:

1. `monitoring/grafana/provisioning/dashboards/dashboards.yml:19` sets **`allowUiUpdates: true`** (with the in-file comment: "lets operators tweak dashboards in the UI"). Any Grafana admin can edit any default panel's SQL in the UI and add `text` / `title` / `content` / `raw` columns. The on-disk JSON is restored on restart, but the live session shows PII immediately. The spec never mentions `allowUiUpdates`.
2. The `convlog-postgres` datasource grants `convlog_reader` SELECT on **all** analytical tables. Grafana's **Explore** tab lets any admin run arbitrary `SELECT text FROM messages_log` / `SELECT title FROM conversations_dim` / `SELECT raw FROM dead_letter_log` against that datasource, with zero relationship to any dashboard panel. The collapsed row is irrelevant to Explore.
3. The collapsed row itself is a one-click expand for **any** admin — the spec calls it "admin-gated," but every Grafana user IS an admin (single role), so the "gate" gates nothing relative to the threat model. The drill-down distinction protects against *accidental* shoulder-surfing of the default view, not against an admin who wants the data.

**Why it matters:** The spec's own RISK-002 is "PII leak ... no per-panel RBAC to catch it" and rates it HIGH. The mitigation listed (SEC-001 column rules + manual privacy check) only governs *what the on-disk default panels SELECT* — it does not address Explore, ad-hoc query, or live UI edits, which are the actual unguarded egress paths. The spec materially over-claims the strength of its control.

**Second-order effect:** If the DPO signs off on OPEN-DECISION-001 believing "the collapsed row is the boundary," that sign-off is predicated on a false premise. The real boundary is: *any Grafana admin can see all conv-log PII, full stop.* That may still be acceptable (the same admins can `psql` the store today), but the spec must say so plainly so governance signs off on the *actual* exposure, not the represented one.

**Recommendation:**
- Reframe SEC-001/MODULE-004: state explicitly that the boundary is **"every Grafana admin can access all conv-log PII via Explore / ad-hoc query / live panel edit; the collapsed-row + column rules reduce *incidental* exposure in the default view but are NOT an access-control boundary."**
- Add a requirement to evaluate disabling ad-hoc/Explore for the `convlog-postgres` datasource if technically feasible at 11.5.2 (note: OSS Grafana cannot disable Explore per-datasource; this likely requires accepting the exposure or moving raw-content access out of Grafana entirely).
- Consider setting `allowUiUpdates: false` for the analytics dashboard's provider (or a dedicated provider) so live edits to PII panels can't persist within a session, and document the residual Explore gap.
- Feed the corrected framing into the OPEN-DECISION-001 DPO ask.

---

### HIGH-2 — `GRAFANA_CONVLOG_DB_PASSWORD` has no stated invariant binding it to the actual `convlog_reader` password; divergence silently breaks the datasource `[panel-domain: security + reliability]`

**Evidence:** The repo provisions the reader password via `CONVLOG_PG_READER_PASSWORD` (`provision-postgres.sh:42,84`) and documents the resolved DSN as `CONVLOG_PG_READ_URI` (`.env.example:955`). SPEC-017 introduces a **third** name, `GRAFANA_CONVLOG_DB_PASSWORD` (REQ-002/003/004), interpolated into `secureJsonData.password`. REQ-004 only says it "duplicates the password inside `CONVLOG_PG_READ_URI` and that rotations must update both." Nowhere does the spec state the **hard invariant**: `GRAFANA_CONVLOG_DB_PASSWORD` MUST equal the password the `convlog_reader` role was actually created with (i.e., `CONVLOG_PG_READER_PASSWORD`). There is now a 3-way value (`CONVLOG_PG_READER_PASSWORD` at provision time, the password inside `CONVLOG_PG_READ_URI`, and `GRAFANA_CONVLOG_DB_PASSWORD`) that must all agree.

**Why it matters:** If they diverge (a rotation updates one, or the operator picks a fresh value for the Grafana var), the datasource's "Save & test" fails with `password authentication failed for user "convlog_reader"` — and crucially, this failure mode is **distinct from** FAIL-002 (reader lacks SELECT) and FAIL-003 (empty password), yet the spec has no FAIL-XXX for it. The `:?` guard (REQ-003) only catches *empty*, not *wrong*. The reader-SELECT acceptance test (REQ-014) runs as `CONVLOG_PG_READ_URI`, so it would pass even when Grafana's separate var is wrong — REQ-014 does NOT prove Grafana authenticates.

**Recommendation:**
- Add an explicit invariant to REQ-002/REQ-004: `GRAFANA_CONVLOG_DB_PASSWORD == CONVLOG_PG_READER_PASSWORD` (the value `convlog_reader` was created with), and the rotation note must enumerate all three locations.
- Add **FAIL-005: wrong `GRAFANA_CONVLOG_DB_PASSWORD`** (auth fails at the datasource even though SELECT works for the reader via psql) with the recovery path "resync the Grafana var to the reader password."
- Strengthen the acceptance: the datasource "Save & test" green check (which DOES exercise the interpolated Grafana credential) should be explicitly named as the check that catches password mismatch — currently REQ-014 is sold as the end-to-end gate, but it bypasses Grafana's credential entirely.

---

### MEDIUM-1 — `messages_log.content` (JSONB) is real PII and is missing from the SEC-001 exclusion list `[panel-domain: data-modeling/security]`

**Evidence:** `001_init.sql:61-62` defines BOTH `text TEXT` and `content JSONB` on `messages_log`. The research lists "`text`/`content` = RAW PII (gate)" (research:126). But the **spec's** SEC-001 (spec:117) and MODULE-004 (spec:238) enumerate only `text`, `title`, and `dead_letter_log.raw` — `content` is dropped from the exclusion list. The manual privacy check (spec:260) likewise greps only `text`/`title`/`raw`.

**Why it matters:** `content` holds the structured message payload (the modern LibreChat message format stores rich content there, not always in `text`). An implementer following the spec's literal exclusion list could include `content` in a default panel believing it compliant, leaking message bodies. This is a verbatim case of RISK-002 ("a single wrong column ... leaks user data") that the spec's own checklist would not catch.

**Recommendation:** Add `messages_log.content` to every SEC-001 / MODULE-004 / manual-privacy-check enumeration of forbidden default-panel columns. The exclusion list should read: `text`, `content`, `title`, `dead_letter_log.raw`.

---

### MEDIUM-2 — B-Q1 (Top 10 users) hardcodes `INTERVAL '30 days'` but is specified as "verbatim SQL, instant"; the dashboard time picker won't drive it, contradicting EDGE-007 `[panel-domain: data-modeling/SQL]`

**Evidence:** REQ-010 B-Q1 says "table, `format: table`, instant; **verbatim SQL**." The verbatim README query (README:219-225) contains `WHERE source_created_at >= NOW() - INTERVAL '30 days'`. EDGE-007 (spec:159-163) asserts "instant panels (counts, top-10, model mix) are time-range-independent and documented as such." But "top-10" is NOT time-range-independent — it is hardwired to a *fixed* 30-day window that ignores the Grafana time picker entirely.

**Why it matters:** An operator who sets the dashboard to "last 7 days" expecting the top-users panel to follow will get 30-day data with no indication of the mismatch — a silent correctness/trust problem. EDGE-007's claim that instant panels are "time-range-independent" conflates "ignores the picker" with "shows all-time"; here it shows a *baked-in* 30 days. Same latent issue for any other V-6 query carrying a literal interval.

**Recommendation:** Decide and state per-panel: either (a) replace the literal interval with `$__timeFilter(source_created_at)` so the picker drives it (preferred, matches B-Q2's treatment), or (b) keep the literal 30 days and document it *in the panel description* as "fixed 30-day window, not driven by the time picker." EDGE-007 should be corrected to distinguish "all-time instant" from "fixed-window instant."

---

### MEDIUM-3 — B-RC and B-Q2 derived/aggregated queries: no performance bound stated, and the index that makes them cheap is asserted nowhere `[panel-domain: data-modeling/performance]`

**Evidence:** REQ-011 B-RC derives `started_at = MIN(...)`, `last_activity = MAX(...)`, `message_count = COUNT(...)` via "LEFT JOIN/subquery over `messages_log` grouped by `conversation_id`." B-Q2 groups `messages_log` by day×agent over 30 days. PERF-001 (spec:119) only says "read-only SELECT ... no new ETL" — it makes **no statement about query cost or scale**, and Validation→Performance (spec:265) marks performance "N/A."

**Why it matters:** The "recent conversations" aggregation is a full GROUP BY over `messages_log` (the fact table). At 268 rows today it's free; the spec is explicitly a long-lived monitoring surface and `messages_log` grows unbounded. I verified that `001_init.sql:86-87` DOES create `messages_log_conversation_created_idx ON (conversation_id, source_created_at)` — which makes the B-RC MIN/MAX/per-conversation aggregation efficient — but **the spec never cites this index**, so an implementer can't confirm the query is index-supported, and a future reviewer can't tell whether a `LIMIT`-with-`ORDER BY last_activity DESC` (which sorts the *aggregated* result, not an indexed column) will scan the whole table. B-Q2's `DATE_TRUNC('day', source_created_at)` is not sargable against `messages_log_source_created_at_idx`.

**Recommendation:**
- PERF-001 should cite `messages_log_conversation_created_idx` (`001_init.sql:86-87`) as the supporting index for B-RC and state the expected access path; flag that the outer `ORDER BY last_activity DESC LIMIT N` sorts a derived column (no index) and bound it (e.g., constrain the conversation set with `$__timeFilter` before aggregating).
- Add a note that B-Q2/B-MPD `DATE_TRUNC`/`$__timeGroup` over a growing fact table should be bounded by `$__timeFilter` (already specified for B-Q2/B-MPD) — confirm B-Q5's conversation-length subquery (full `messages_log` scan, no time bound) is acceptable or bound it.
- Replace the blanket "Performance: N/A" with "read-only, but two panels aggregate the unbounded fact table — bounded by index X and time filter Y."

---

### MEDIUM-4 — "No LibreChat service restart" guarantee is unverified against compose's recreate behavior on a shared external network `[panel-domain: reliability]`

**Evidence:** NFR-002 (spec:115) and the Executive Summary assert "**LibreChat api does NOT restart**" on `docker compose ... up -d grafana`. REQ-005 adds `grafana` to the *external* `librechat_default` network. The claim is plausible (`up -d <service>` targets only the named service), but the spec offers no evidence that joining an external network shared with the LibreChat stack won't trigger a dependency re-evaluation, and the monitoring compose is a *separate* compose project from the LibreChat app stack — meaning `docker compose -f docker-compose.monitoring.yml up -d grafana` can't even see the LibreChat api service, which actually *supports* the claim but for a reason the spec never states.

**Why it matters:** The "no api restart" property is a stakeholder-validated hard constraint (research:46, Operator mental model). If it's wrong, a Grafana deploy bounces production chat. The spec asserts it as fact without tracing *why* it holds. FAIL scenarios cover datasource/credential/network but not "deploy unexpectedly recreated a neighbor container."

**Recommendation:** State the *mechanism*: the monitoring stack is a distinct compose project; `up -d grafana` scopes to the monitoring project's `grafana` service; `librechat_default` is consumed as `external` (not owned/recreated by this project), so no LibreChat-stack container is in scope. Add a one-line post-deploy check to the operator acceptance: "confirm `librechat-api` container `StartedAt` is unchanged after the grafana recreate."

---

### MEDIUM-5 — REQ-013 idempotency claim for the existing-tables GRANT is overstated for tables added by *future* migrations before a re-provision `[panel-domain: data-modeling/reliability]`

**Evidence:** REQ-012 fixes `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` (covers *future* writer-created tables). REQ-013 adds the one-time `GRANT SELECT ON ALL TABLES IN SCHEMA public` for *existing* tables. The spec frames these two as jointly complete. But there is a gap window: if a **new migration** (`002_*.sql`) adds a table on prod *after* REQ-012's default-privilege fix has been applied, the reader is covered — **only if** REQ-012's corrected `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` has actually been run on prod. On a *config-only* deploy, `provision-postgres.sh` is **not re-run** (RISK-005, spec:287) — so the corrected default-privilege statement (REQ-012) is *also* not applied to prod by this deploy; only the one-time REQ-013 GRANT (run manually) is. That means: after this feature ships, a future migration's new table will be **unreadable by `convlog_reader`** until someone re-runs the (manual) GRANT again, because the default-privilege fix lives only in the script that prod never re-executes.

**Why it matters:** The spec presents REQ-012 as "ensures future migrations are automatically readable" (spec:104) — true for *fresh* provisions, but **false for the existing prod database on this deploy**, where REQ-012's statement never executes. New conv-log tables silently break Dashboard B panels months later, reproducing the exact HIGH finding this spec exists to fix. The spec's REQ-013b one-time command covers *today's* tables but establishes no durable mechanism on the live prod DB.

**Recommendation:** REQ-013 should require the operator to **also run REQ-012's corrected `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer ...` against prod once** (not just the script edit), so the live DB carries the default-privilege fix and future migrations are auto-covered. State explicitly that editing `provision-postgres.sh` does NOT apply to the running prod DB on a config-only deploy. Add this to operator docs (REQ-015) alongside the REQ-013b GRANT.

---

### LOW-1 — DISCREPANCY-2 phase list is carried correctly, but A-6/A-7 lack a guard for unbounded label cardinality

**Evidence:** A-6/A-7 use `sum by (phase) (rate(...))` with `legendFormat: {{phase}}` (correct, label-driven — research DISCREPANCY-2). The code emits at least 8 error phases (`index.ts` inc-sites per research:91). No issue with correctness; LOW note only: with stacked timeseries and 8+ phases, the legend/colors can become unreadable. Not a blocker.

**Recommendation:** Optional — note a sane legend/stacking config in the panel description; no requirement change needed.

---

### LOW-2 — REQ-001 says "matches `postgres-exporter`" for `sslmode: disable` but doesn't cite where that DSN lives

**Evidence:** REQ-001 sets `jsonData.sslmode: disable` "(matches `postgres-exporter`)." The research grounds this at compose `:203`. The spec drops the line reference. Minor traceability loss; the value itself is correct for an internal `vectordb:5432` connection.

**Recommendation:** Add the `docker-compose.monitoring.yml:203` reference to REQ-001 for traceability.

---

### LOW-3 — The "12 panels = 11 metrics + synthetic `up`" mapping is sound, but A-8/A-12 each render 3 quantiles — panel-vs-query count could confuse the acceptance check

**Evidence:** REQ-008 says "Dashboard A renders 12 panels." A-8 and A-12 each carry **three** `histogram_quantile` queries (p50/p95/p99) within a single panel. The "one acceptance criterion per panel" framing is fine, but a literal "count 12 panels" acceptance could be tripped by an implementer who splits quantiles into separate panels (yielding >12) or merges. Cosmetic.

**Recommendation:** Clarify acceptance is "12 panels, where A-8/A-12 are single multi-series panels," not a raw object count.

---

## Research Alignment Check (dropped/added findings)

- **Faithfully carried:** the two HIGH research findings (GRANT, network) → REQ-012/013/014 and REQ-005; DISCREPANCY-1 dual sync-lag lines → A-2/SEC-002; DISCREPANCY-2 label-driven phases → A-6/A-7; DISCREPANCY-4 no bind-mount change → REQ-006; OQ-2 derived columns → B-RC; OQ-3 single collapsed row → SEC-001; OQ-1 → OPEN-DECISION-001 (correctly recorded as open, not silently deferred — satisfies the rubric's "silent drops are HIGH" gate).
- **Dropped from research → spec:** `messages_log.content` as a gated column (research:126 → absent from spec SEC-001) — see MEDIUM-1. The `conversations_dim.tags` (JSONB) and `archived` columns noted as "potential dimension/filter" in research:127 are silently absent from the spec; acceptable (out of scope) but unremarked.
- **No confirmation-bias or fabricated-evidence issues found** — every spec claim I spot-checked (provision script, compose networks, prometheus job, metric names, schemaVersion) matched the repo.

## Risk Reassessment

- **RISK-002 (PII leak): correctly HIGH, but the stated mitigation is insufficient** — see HIGH-1. The mitigation governs only on-disk default panels, not Explore/ad-hoc/live-edit. Effective residual risk is higher than the spec implies.
- **RISK-005 (GRANT not applied on config-only deploy): under-scoped** — see MEDIUM-5. It correctly flags the one-time GRANT but misses that REQ-012's *default-privilege* fix also never reaches prod on this deploy, leaving future migrations exposed. Arguably MEDIUM, not LOW.
- **New unlisted risk — credential triplet divergence** — see HIGH-2. Belongs in the risk register as a MEDIUM-to-HIGH operational risk with its own FAIL scenario.

---

## Recommended Actions Before Proceeding (priority order)

1. **(HIGH-1)** Reframe SEC-001/MODULE-004 to state the *actual* boundary (every Grafana admin can reach all conv-log PII via Explore/ad-hoc/live-edit); evaluate `allowUiUpdates: false` for the analytics provider; feed the corrected exposure into the OPEN-DECISION-001 DPO ask so sign-off is on the real surface.
2. **(HIGH-2)** Add the `GRAFANA_CONVLOG_DB_PASSWORD == CONVLOG_PG_READER_PASSWORD` invariant + rotation enumeration; add FAIL-005 (wrong Grafana password); clarify "Save & test" — not REQ-014 — is the check that proves Grafana's credential.
3. **(MEDIUM-1)** Add `messages_log.content` to every forbidden-default-column list and to the manual privacy grep.
4. **(MEDIUM-5)** Require running REQ-012's corrected `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` against prod once (script edit alone doesn't reach prod on a config-only deploy); document in REQ-015.
5. **(MEDIUM-2)** Resolve B-Q1 (and any literal-interval V-6 query): `$__timeFilter` or explicit "fixed-window, not picker-driven" panel doc; correct EDGE-007's "time-range-independent" wording.
6. **(MEDIUM-3)** Give PERF-001 teeth: cite `messages_log_conversation_created_idx`, state B-RC's access path, bound the unbounded-fact-table aggregations.
7. **(MEDIUM-4)** State the mechanism behind "no api restart" (separate compose project + external network) and add a post-deploy `StartedAt`-unchanged check.
8. **(LOW-1/2/3)** Optional polish.

## Proceed / Hold Decision

**REVISE BEFORE PROCEEDING.** The spec is implementation-ready in its mechanics, but the two HIGH findings touch real production PII exposure framing and a silent datasource-auth failure mode — both cheap to fix in the spec now and expensive to discover in production. None are hard blockers to *starting* MODULE-003 (infra), but the privacy-boundary reframing (HIGH-1) and the `content` omission (MEDIUM-1) MUST land before any Dashboard B default panel is authored, and HIGH-2's invariant before the datasource is provisioned.

## Panel-Domain Coverage Confirmation (panel was skipped — these were covered here)

- **Security / PII boundary:** HIGH-1 (Explore/ad-hoc/`allowUiUpdates`/single-admin reality), MEDIUM-1 (`content`), OPEN-DECISION-001 reviewed (legitimately open, not a blocker to spec).
- **Datasource credential:** HIGH-2 (triplet divergence, FAIL gap); confirmed `${VAR}` interpolation form matches research and the `GF_SECURITY_ADMIN_PASSWORD` precedent; password not in committed files (REQ-001 verified against `prometheus.yml` pattern).
- **convlog_reader GRANT (Postgres correctness):** verified `provision-postgres.sh:101-102` lacks `FOR ROLE`; REQ-012/013 are correct Postgres; schema IS `public` (confirmed `provision-postgres.sh:97`, `001_init.sql`); REQ-014 reader-not-superuser is unambiguous; future-migration gap surfaced (MEDIUM-5).
- **SQL correctness/performance:** B-RC derivation correct (no such columns on `conversations_dim`, confirmed `001_init.sql:21-34`); join `model_or_agent_id = agent_id` correct; index gap + literal-interval issues raised (MEDIUM-2/3); `$__timeFilter`/`$__timeGroup` placement reviewed.
- **PromQL correctness:** all 11 metric names verified against `index.ts:90-153`; `up{job="conv-log"}` matches `prometheus.yml:54`; histogram_quantile `_bucket`+`by (le)` forms correct; counters use `rate()`; no nonexistent metric referenced.
- **Reliability:** EDGE-001 (0-row guardrail), EDGE-005 (empty histogram), FAIL-001 (datasource unreachable) reviewed and adequate; "no api restart" mechanism gap raised (MEDIUM-4).

---

## Findings Addressed

Resolved in `SDD/requirements/SPEC-017-grafana-conv-log-dashboards.md` by the SDD Spec-Fix subagent (Step 3e), 2026-06-01. Each finding maps to the concrete spec change(s) made.

| Finding | Resolution (spec change) |
|---|---|
| **HIGH-1** (PII boundary over-claimed) | Rewrote **SEC-001** into an honest "trust boundary + default-view privacy" model: trust boundary = authorized-Grafana-admin-only; reclassified the collapsed drill-down + column rules as an *incidental-exposure-minimization* control (NOT a boundary); ENUMERATED residual-exposure paths (Explore / ad-hoc query / query inspector / CSV export / `/api/datasources` / template-variable enumeration) as accepted risk. Added **REQ-016** (`allowUiUpdates: false` for conv-log dashboards) and **REQ-017** (no template variable may enumerate raw `title`/`text`/`content`/`feedback_text`/`raw`). Reframed **MODULE-004** (title, Interface, Hides, Risk) and **RISK-002**; tied **OPEN-DECISION-001** to the honest framing. Recorded `allowUiUpdates: true` fact in System Integration Points. Updated Solution Approach / Expected Outcomes / Critical Implementation Considerations to stop calling the drill-down a "boundary." |
| **HIGH-2** (credential invariant + acceptance gap) | Added explicit **REQ-004 INVARIANT**: `GRAFANA_CONVLOG_DB_PASSWORD == CONVLOG_PG_READER_PASSWORD` (= secret in `CONVLOG_PG_READ_URI`); documented the three locations, single-source-of-truth, atomic rotation. Added **FAIL-005** (wrong Grafana password — distinct from FAIL-002/003, with recovery). Scoped **REQ-014** as GRANT-only (bypasses Grafana credential) and added **REQ-014b** end-to-end Grafana-path check ("Save & test" green AND a Dashboard-B stat panel renders matching the psql count). Added **RISK-006** (credential triplet divergence). Added Grafana-path check to operator acceptance. |
| **MEDIUM-1** (`messages_log.content` missing) | Added `content` (JSONB) AND `feedback_text` (re-scanned schema — also user-authored free text) to the forbidden-default-column set across SEC-001, MODULE-004, REQ-015, manual privacy check, B-MPD note, and Critical Implementation Considerations. Forbidden set now: `text`, `content`, `feedback_text`, `title`, `dead_letter_log.raw`. |
| **MEDIUM-2** (B-Q1 literal `INTERVAL '30 days'`) | **REQ-010 B-Q1** now flags the fixed 30-day window and requires either `$__timeFilter` (preferred) or an explicit "fixed-window, not picker-driven" panel description. Corrected **EDGE-007** to distinguish all-time-instant from fixed-window-instant. |
| **MEDIUM-3** (no performance bound / index) | Rewrote **PERF-001** to cite `messages_log_conversation_created_idx` (`001_init.sql:86-87`) for B-RC, flag the derived-column `ORDER BY` (bound with `$__timeFilter` before aggregating), note B-Q2/B-MPD `DATE_TRUNC` is non-sargable (require `$__timeFilter`), and bound B-Q5's full scan. Replaced "Performance: N/A" in Validation Strategy. |
| **MEDIUM-4** (no-api-restart unverified) | **NFR-002** now states the mechanism: distinct compose project + `librechat_default` consumed as `external` ⇒ only `grafana` recreates, no neighbor in scope. Added post-deploy `librechat-api` `StartedAt`-unchanged check to NFR-002 and operator acceptance. |
| **MEDIUM-5** (default-privilege fix never reaches prod) | **REQ-013** split: REQ-013b (one-time GRANT, today's tables) + **REQ-013c** (one-time `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` against prod, durable future-migration coverage). Stated script edit alone doesn't reach the running prod DB; documented both in REQ-015. **RISK-005** raised LOW→MEDIUM. |
| **LOW-1** (A-6/A-7 legend cardinality) | Added 8+-phase legend/stacking guidance to A-6/A-7 panel notes (cosmetic). |
| **LOW-2** (sslmode traceability) | **REQ-001** now cites `docker-compose.monitoring.yml:203` for the `sslmode: disable` precedent. |
| **LOW-3** (12-panel count ambiguity) | **REQ-008** clarifies "12 panels" = 12 panel objects with A-8/A-12 as single multi-series panels (p50/p95/p99), not a raw object count. |

All ten findings have a corresponding spec edit; no resolution is claimed without a change. **Verdict status:** the REVISE-BEFORE-PROCEEDING conditions (HIGH-1 reframing + `content` omission before any Dashboard-B default panel; HIGH-2 invariant before datasource provisioning) are satisfied in the spec.
