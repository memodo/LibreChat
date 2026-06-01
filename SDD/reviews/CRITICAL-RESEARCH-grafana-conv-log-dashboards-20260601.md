# Critical Research Review: Grafana conv-log Dashboards (RESEARCH-017)

> Reviewer: adversarial research-phase critical review (SDD Step 2c).
> Artifact under review: `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md`.
> Design concept (brief): `SDD/GRAFANA_FOR_CONV_LOG.md`. Glossary: `SDD/UBIQUITOUS_LANGUAGE.md`.
> Date: 2026-06-01.

---

## Executive Summary

**Severity: HIGH.** The research is unusually thorough, correctly contradicts the brief on two factual points (the network membership and the sync-lag threshold), and resolves its open questions with cited evidence. The 11-metric→panel→PromQL mapping, the histogram forms, the derived-column finding (OQ-2), and the credential-strategy analysis (Option A) all check out against deployed source. However, the review surfaces **one HIGH-severity blind spot that can make the entire Dashboard B feature non-functional in prod**: the research treats `convlog_reader`'s SELECT access on the analytical tables as a settled fact, but the provisioning script as committed does **not** actually grant it for the tables the sidecar creates — a classic Postgres `ALTER DEFAULT PRIVILEGES`-without-`FOR ROLE` footgun. Several MEDIUM gaps (DPO sign-off never sequenced as a real gate, validation criteria that cannot be checked before prod, an unverified `secureJsonData` interpolation claim, a missed PII surface in the dead-letter `raw` column) compound the risk.

**Design Concept Fidelity gate — recorded:** There is **no `CLARIFICATION-017` artifact**. The user explicitly **skipped** the `/research-clarify` gate (equivalent to `--skip-clarify`) and designated `SDD/GRAFANA_FOR_CONV_LOG.md` as the externalized design concept. **This gate-skip and its accepted design-concept risk are recorded here per the command's Research Phase instructions.** Fidelity was therefore assessed against the brief's Scope-IN items, Constraints, and Success Criteria rather than a CLARIFICATION doc (see "Design Concept Fidelity" below). No Scope-IN item was silently dropped; the research's two factual corrections to the brief (network, threshold) are improvements, not drift — but they mean the brief's own "pre-existing context" statements are wrong, which downstream readers must not trust blindly.

**Verdict: REVISE BEFORE PROCEEDING.** The network blocker is correctly identified and is genuinely the *only* compose edit — but it is not the only prerequisite. The reader-grant gap (HIGH) must be settled, and the DPO title-classification (currently a soft DEFER) should be sequenced as an explicit pre-spec or pre-deploy gate, before the spec is written as if Dashboard B will "just work."

---

## Critical Gaps Found

### 1. HIGH — `convlog_reader` may have NO SELECT on the tables Dashboard B queries (provisioning footgun)

The research asserts as fact (line 162): *"Read-only, SELECT on all current+future tables,"* citing `provision-postgres.sh:84,89,94,101-102`. The cited script does **not** establish this.

- **Evidence (verified against source):**
  - `provision-postgres.sh:8-9`: *"This script does NOT apply DDL — the sidecar's migration runner handles that at startup via migrations/001_init.sql."* So tables are created at sidecar startup.
  - `provision-postgres.sh:97`: `ALTER SCHEMA public OWNER TO convlog_writer;` — the schema (and thus the tables created under it by the migration runner) is owned by **`convlog_writer`**.
  - `provision-postgres.sh:101-102`: `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;` — executed over `PG_ADMIN_URI` (the superuser), with **no `FOR ROLE convlog_writer` clause**.
  - Postgres semantics: `ALTER DEFAULT PRIVILEGES` *without* `FOR ROLE` applies only to objects subsequently created **by the role that ran the statement** (here, the admin/superuser). It does **not** cover objects created by `convlog_writer`. The script's own comment (`:99-100`) — *"future tables created by convlog_writer are readable by convlog_reader"* — is therefore **incorrect** as written.
  - Repo-wide grep for `GRANT SELECT ON ALL TABLES`, `FOR ROLE convlog_writer`, or `ALTER DEFAULT PRIVILEGES FOR` returns **nothing** (no retroactive grant, no scoped default-privileges clause anywhere).
- **Risk:** If the prod tables were created by `convlog_writer` (the documented runtime role, owner of the schema), `convlog_reader` has **no SELECT** on them. Dashboard B's datasource — which connects *as* `convlog_reader` — would then fail **every** panel with `permission denied for table messages_log`, even though the network fix (DISCREPANCY-3) is applied and "Save & test" passes (Save & test only checks `CONNECT`, not table SELECT). The feature's primary deliverable silently dies in prod.
- **Why the research missed it:** the success-criterion cross-check (`docker exec ... psql -U librechat_rag`) uses the **rag superuser**, not `convlog_reader` (research itself flags this at line 181). So even the validation step would *not* catch the reader-permission gap — it would show correct counts while Grafana sees nothing. The research's own validation design has a hole that masks this exact failure.
- **Recommendation (carry into spec as a REQ + a pre-deploy gate):**
  1. Determine empirically which role created the prod tables (`\dt+` / `SELECT tableowner FROM pg_tables WHERE schemaname='public'` on prod `convlog`). If owner is `convlog_writer`, the reader almost certainly lacks SELECT.
  2. Add a one-time remediation to the spec/ops: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` **and** fix the default-privileges line to `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;` so future migrations stay covered.
  3. **Add a `convlog_reader`-scoped validation step**: run at least one Dashboard B query (`SELECT count(*) FROM messages_log`) *as `convlog_reader`* (via `CONVLOG_PG_READ_URI`), not as the rag superuser, before declaring success. This is the validation the research currently lacks.

### 2. MEDIUM — DPO title-classification is a real gate disguised as a soft DEFER (OQ-1)

OQ-1 (line 209) resolves the brief's internal title/PII tension by dropping `title` from the default panel and deferring to the DPO *"only if"* they later widen the classification. The research correctly notes the on-file DPO acceptance covers **retention, not UI exposure** (line 43). But the brief **explicitly lists `title` as a default "recent conversations" column** (`GRAFANA_FOR_CONV_LOG.md:30`). The research is overriding an explicit Scope-IN column on its own privacy judgment.

- **Risk:** This is the correct call, but framing it as a passive "DEFER unless DPO says otherwise" means the spec may be written, implemented, and deployed *without anyone ever asking the DPO* — and the brief's literal request goes unmet with no recorded decision. Either outcome (title shown / title hidden) needs an owner's sign-off, because the brief and the security constraint genuinely conflict.
- **Recommendation:** Promote OQ-1 from a soft defer to an **explicit decision gate the spec must resolve before SLICE/implementation**: record a DPO (or product-owner) decision on whether conversation *titles* may appear in a default Grafana-admin-only panel. Default to drill-down-only until that decision exists, but make the ask active, not conditional.

### 3. MEDIUM — Validation strategy is prod-gated and partly unverifiable; the research under-states which success criteria cannot be checked pre-deploy

The research honestly states validation is prod-gated (line 172) and that local validation can only confirm provisioning load against an empty/throwaway Postgres. Good. But it then lists six validation steps (lines 174-180) without clearly partitioning **which are checkable pre-deploy vs only-in-prod**, and the brief's success criteria inherit this ambiguity.

- **Evidence:** Criteria like "all Dashboard A panels render with real prod data on first load" and "stat-row matches SQL counts" are *only* verifiable in prod against the populated store. "Auto-provision on `up -d grafana`" and "datasource Save & test" are checkable locally **only if** a reachable Postgres with the reader role and granted tables exists locally — which the research says does not exist.
- **Risk:** The spec could inherit success criteria that read as "done" gates but are unfalsifiable until prod, encouraging a deploy-and-pray flow. Combined with finding #1, the "datasource Save & test passes" criterion is actively *misleading* (it passes on CONNECT alone).
- **Recommendation:** The spec should split success criteria into (a) pre-deploy-verifiable (JSON/YAML lints, provisioning load, dashboard appears) and (b) prod-only (real-data render, count cross-check **run as `convlog_reader`**), and state the prod-only ones are operator-gated acceptance, not implementer-closeable.

### 4. MEDIUM — `secureJsonData` `${ENV_VAR}` interpolation claim is asserted, not evidenced

The credential decision (Option A) hinges on the claim (line 159): *"Grafana **does** interpolate `${ENV_VAR}` in provisioning YAML at load."* This is stated without a citation to Grafana docs/version behavior, and the only in-repo precedent (`prometheus.yml`) uses **`jsonData` with no secret at all** — there is no in-repo example of `secureJsonData.password: ${VAR}` actually working.

- **Risk:** Grafana's env-var interpolation in provisioning files has version- and syntax-specific behavior (`$VAR` vs `${VAR}`, and historically it interpolates only certain fields). If the exact form fails on 11.5.2, the datasource silently provisions with a literal/empty password and Dashboard B fails auth — another way the feature dies post-deploy. The recommendation is probably correct, but it is the load-bearing pivot of the entire credential decision and rests on an unverified assertion.
- **Recommendation:** Spec should pin the exact interpolation syntax for Grafana 11.5.2 (cite the docs/version), and add a validation step confirming the datasource authenticates with the interpolated password (not just CONNECT). Note: this overlaps finding #1 — both are caught only by a real `convlog_reader` auth+SELECT check.

### 5. MEDIUM — Dead-letter `raw` (JSONB) column is a PII surface the research does not flag

The Dead-letter inspector panel (line 149) selects `source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at` and notes `error_detail` is sanitized (README:319). But `dead_letter_log` also has a **`raw JSONB` column** (`001_init.sql:122`) that stores the **original failed source document** — which for a `messages_log` dead-letter would contain raw message text/content (PII).

- **Risk:** The research's privacy boundary is built on "default panels = counts/IDs/dimensions/metadata, no raw text." The dead-letter inspector is a **default-visible panel** (not in the drill-down row). As long as the panel's `SELECT` list excludes `raw`, it is safe — but the research never explicitly calls out `raw` as a PII column to exclude, so an implementer reading the schema table (which omits `raw` at line 130) could add it for "debuggability" and leak PII into a default panel. The research's own schema table is the source of this blind spot: it lists `dead_letter_log` columns but drops `raw`.
- **Recommendation:** Add `dead_letter_log.raw` to the PII-gated column inventory alongside `messages_log.text/content` and `conversations_dim.title`; the spec must state the dead-letter inspector excludes `raw` (or routes it to the drill-down row).

### 6. LOW — Research schema table omits columns that exist (`archived`, `tags`, `user_id`, `raw`)

The "Postgres analytical schema (authoritative)" table (lines 124-131) is presented as authoritative but is **incomplete** vs `001_init.sql`: `conversations_dim` also has `archived BOOLEAN` and `tags JSONB` (`:27-28`); `guardrail_events_log` also has `user_id` (`:106`); `dead_letter_log` also has `raw JSONB` and `first_failed_at` (`:122,125`).

- **Risk:** Calling an incomplete column list "authoritative" invites the spec to treat it as the canonical schema and miss columns (e.g., `archived` could feed a "recent conversations" filter; `tags` could be a useful dimension; `raw` is the PII risk in #5). Low because the load-bearing columns are present, but the "authoritative" label over-promises.
- **Recommendation:** Either complete the table or relabel it "Dashboard-B-relevant columns (not exhaustive)" and point to `001_init.sql` as the true source of truth.

---

## Questionable Assumptions

1. **"`vectordb` lives on `librechat_default`" (line 164).** *Verified-by-precedent, not verified-directly.* The research infers this from `postgres-exporter` reaching `vectordb:5432` while joined to `monitoring` + `librechat_default` (`:203,216-218`). This is strong circumstantial evidence and almost certainly correct — but `postgres-exporter` is also on `monitoring`, and the inference assumes `vectordb` is reachable only via `librechat_default`. The conclusion is sound, but the spec should note it is inferred from the exporter precedent, and the operator should confirm `vectordb`'s actual network membership on prod (`docker inspect vectordb`) before relying on it. *(The network-fix shape itself — add `- librechat_default` to the grafana service `networks:` list at `:134-136`; network already declared `external` at `:259-261` — is **verified correct**: the grafana service block genuinely lists only `monitoring` + `caddy_net`, and DISCREPANCY-3's contradiction of the brief is accurate.)*

2. **"single collapsed drill-down row" satisfies the privacy constraint.** The research is admirably honest that OSS Grafana 11.5 has **no per-panel/per-dashboard RBAC** (line 156) and that the boundary is "design-level." But it then leans on the collapsed row as the privacy mechanism — *any Grafana admin can expand it*, and admin is the only gate. So the boundary is "raw PII is one click away from any admin," not "raw PII is access-controlled." This is closer to **defense-in-depth-by-default** than a true privacy control. The decision (collapsed row) is reasonable for the stated threat model (all viewers are authorized admins), but the research/spec should state plainly that this is *not* an access control — it prevents accidental rendering, not deliberate access, and it is NOT logged. If the DPO's concern is "who looked at raw content," a collapsed row provides **zero** audit trail. The OQ-3 "defer to governance if audit policy requires physical separation" defers exactly the property (auditability) that a privacy constraint usually cares most about.

3. **Counter-reset / `rate()` guidance (edge case, line 55)** is correct and well-reasoned — flagged here only as a confirmed *good* call, not a gap.

4. **DISCREPANCY-1 (3000s alert threshold)** is **verified correct**: `alerts.yml` expr is `convlog_sync_lag_seconds > scalar(vector(3000)) and on() (convlog_pending_messages > 0)`, `for: 15m`, `severity: warning` — exactly as the research states. The `3000 = max(10×300, 900)` derivation matches the inline operator comment and `.env.example:1012`. The dual-line recommendation (600s SLO + 3000s alert) is coherent. No gap.

5. **11-metric typing + histogram_quantile forms** are **verified correct** against `index.ts:90-153`: two `Histogram` instances (`batchDurationSeconds`, `erasureChunkDeletedRatio`), the rest `Counter`/`Gauge` as mapped; `histogram_quantile(q, sum(rate(..._bucket[5m])) by (le))` is the right form. No metric was invented; no brief panel was dropped (the 11+`up` / 12-bullet reconciliation is sound). No gap.

---

## Missing Perspectives

- **DBA / Postgres operator:** would have caught finding #1 immediately — the `ALTER DEFAULT PRIVILEGES`-without-`FOR ROLE` footgun is a textbook DBA gotcha. No Postgres-permissions perspective was applied to the `convlog_reader` access claim.
- **DPO (active, not on-file):** the on-file DPO acceptance is for retention; OQ-1 needs a *fresh* DPO decision on title exposure (finding #2). The research consults the DPO's *mental model* but never sequences an actual ask.
- **Security/audit reviewer:** would press on assumption #2 — a collapsed row that any admin can expand, with no access logging, may not satisfy a real privacy/audit posture.

---

## Vocabulary Alignment (vs `SDD/UBIQUITOUS_LANGUAGE.md`)

**Strong alignment.** The glossary's SPEC-017 section (lines 80-101) was clearly written in lockstep with this research: "operational dashboard (Dashboard A)", "analytics dashboard (Dashboard B)", "`convlog_reader` datasource", "`GRAFANA_CONVLOG_DB_PASSWORD`", "sync-lag SLO line", "drill-down row", "default-privacy panel" all appear consistently in both. Minor nits:
- The research uses **"analytical store / analytical dashboard"** phrasing in places (e.g., title, line 86 stakeholder model) where the glossary mandates **"analytics dashboard"** and flags **"analytical dashboard"** as a synonym-to-avoid (glossary line 86). Tighten in the spec.
- The research says "Dashboard B (Postgres-backed analytical)" in the header (line 6) — glossary prefers "analytics dashboard (Dashboard B)". Cosmetic, but the glossary explicitly calls this out.

---

## Recommended Actions Before Proceeding

1. **(HIGH, blocking)** Resolve the `convlog_reader` SELECT-grant gap (finding #1): empirically check prod table ownership, add the remediation grant + `FOR ROLE convlog_writer` default-privileges fix to the spec, and **add a `convlog_reader`-scoped validation step** (run a Dashboard B query as the reader, not the rag superuser).
2. **(MEDIUM)** Promote OQ-1 to an explicit DPO/product decision gate on title exposure (finding #2) — make the ask active.
3. **(MEDIUM)** Pin and cite the exact Grafana 11.5.2 `secureJsonData` `${ENV_VAR}` interpolation syntax, and validate datasource *auth* (not just CONNECT) (finding #4).
4. **(MEDIUM)** Partition success criteria into pre-deploy-verifiable vs prod-only-operator-gated (finding #3); correct the "Save & test passes" criterion to require a SELECT, not just CONNECT.
5. **(MEDIUM)** Add `dead_letter_log.raw` to the PII-gated column inventory; state the dead-letter inspector excludes it (finding #5).
6. **(LOW)** Relabel the "authoritative" schema table as non-exhaustive or complete it (finding #6); tighten "analytical" → "analytics dashboard" per glossary.
7. Confirm `vectordb`'s actual network membership on prod (`docker inspect`) rather than relying solely on the postgres-exporter inference (assumption #1).

---

## Proceed/Hold Decision

**REVISE BEFORE PROCEEDING.** The research is high quality on the surface it covers — the network blocker, threshold reconciliation, metric mapping, and derived-column findings are all verified-correct and genuinely de-risk the spec. But it carries one HIGH-severity blind spot (`convlog_reader` may have no SELECT on the very tables Dashboard B reads, with a validation design that would *mask* the failure) plus several MEDIUM gaps. None of these block research *as research*, but the spec must not be written as if Dashboard B will work end-to-end until finding #1 is settled. Address #1 and sequence the DPO ask (#2) before planning.

---

## Findings Addressed (Research Fix — Step 2d, 2026-06-01)

All six findings resolved in `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md`.

**Finding 1 — HIGH: `convlog_reader` SELECT grant gap**
Verified by reading `conv-log/ops/provision-postgres.sh`, `conv-log/src/index.ts`, and `.env.example`. Confirmed: `CONVLOG_PG_URI` = `convlog_writer` credentials (`index.ts:65`); migration runner connects as `convlog_writer` (`index.ts:394,407`); therefore tables are owned by `convlog_writer`. The `ALTER DEFAULT PRIVILEGES` at `provision-postgres.sh:101-102` is executed by the admin superuser with NO `FOR ROLE convlog_writer` clause — does NOT cover writer-owned tables. The smoke test claim (`progress.md:290`) appears to be a false positive (smoke `CREATE TABLE` likely run as admin, not as `convlog_writer`). TRUTH: **`convlog_reader` has no SELECT on the analytical tables as currently provisioned.** Research updated to state this as a FINDING with file:line evidence. Corrective DDL specified: (1) `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` (one-time operator step or addition to `provision-postgres.sh`) and (2) fix `provision-postgres.sh:101-102` to `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;`. Spec acceptance test must validate SELECT as `convlog_reader` (via `CONVLOG_PG_READ_URI`), not as rag superuser. "Save & test" passing is explicitly flagged as CONNECT-only, not SELECT proof.

**Finding 2 — MEDIUM: OQ-1 DPO title-classification passive defer**
Converted from passive DEFER to an explicit SPEC OPEN-DECISION in the research document. The default position (title in drill-down only) is maintained. The spec is required to record this as an open decision with an assigned owner (DPO or product owner) who must actively sign off — not silently inherit. The brief's explicit `title` request and the PII constraint are both documented in the resolution text.

**Finding 3 — MEDIUM: Validation strategy prod-gated, criteria not partitioned**
Testing/Validation Strategy section rewritten to explicitly partition: (a) pre-deploy-verifiable steps (implementer-closeable: YAML lint, auto-provision, datasource CONNECT check, privacy check, convlog_reader SELECT gate against throwaway Postgres) and (b) prod-only operator-gated acceptance (real-data render, stat-row count cross-check). The "Save & test passes" criterion is annotated as CONNECT-only and explicitly not sufficient. The count cross-check step now requires the `convlog_reader` URI, not the rag superuser.

**Finding 4 — MEDIUM: `secureJsonData` `${ENV_VAR}` interpolation unverified**
Research updated to note: the in-repo `prometheus.yml` uses no `secureJsonData` at all (no precedent). Grafana 11.x provisioning architecture is stated to support `${VAR_NAME}` interpolation across all YAML fields including `secureJsonData`, per Grafana docs. The spec must add `GRAFANA_CONVLOG_DB_PASSWORD` to the grafana service `environment:` block in `docker-compose.monitoring.yml` (so the var is in container env at load time). Validation requirement added: the datasource acceptance test must prove auth (SELECT), not just CONNECT.

**Finding 5 — MEDIUM: `dead_letter_log.raw` PII surface not flagged**
`dead_letter_log.raw` (JSONB) added to the PII-gated column inventory alongside `messages_log.text/content` and `conversations_dim.title`. The dead-letter inspector panel SELECT list is confirmed to exclude `raw`. The default-visible panel annotation explicitly states `raw` must be excluded and notes raw inspection must go to the collapsed drill-down row.

**Finding 6 — LOW: "authoritative" schema table incomplete + "analytical" vocabulary drift**
Schema table section renamed from "THE Postgres analytical schema (authoritative)" to "THE Postgres analytics schema (Dashboard-B-relevant columns — NOT exhaustive; `001_init.sql` is the authoritative source)". Table expanded to include the previously omitted columns: `conversations_dim.archived` (BOOLEAN) and `conversations_dim.tags` (JSONB); `guardrail_events_log.user_id`; `dead_letter_log.raw` (JSONB, PII-gated) and `dead_letter_log.first_failed_at`. Two "analytical dashboard" references in the header/data-flow section corrected to "analytics dashboard" per glossary mandate.
