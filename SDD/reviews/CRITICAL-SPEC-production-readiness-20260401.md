## Specification Critical Review: Production Readiness

### Overall Assessment

SPEC-010 is a thorough and well-structured production hardening specification that correctly identifies the most dangerous issues (unauthenticated MongoDB, default credentials, dev images) and organizes work into logical phases. However, the spec has significant weaknesses in three areas: (1) several requirements present false choices or ambiguous alternatives that will force implementation-time decisions without clear guidance, (2) the backup and disaster recovery requirements underspecify the automation mechanism and testing cadence, making "done" subjective, and (3) critical interactions between features -- particularly PII detection, rate limiting, the ban system, and the token balance system -- are not addressed, creating a risk of cascading user-facing failures that no single requirement anticipates. The spec also drops several research findings (disk encryption, Docker socket security, node_exporter, Loki/log aggregation, MinIO bucket versioning) without documenting why they were excluded.

### Severity: HIGH

---

### Ambiguities That Will Cause Problems

1. **REQ-011**: Registration restriction offers two incompatible approaches without a decision.
   - Possible interpretations: (A) Set `ALLOW_REGISTRATION=false` and manage users manually, (B) Keep registration open but restrict to `memodo.de` / `memodo-eng.de` domains via `librechat.yaml`.
   - Why it matters: Option A means someone must manually create every new user account. Option B is self-service but requires email verification to be meaningful (tied to REQ-012). These have completely different operational implications. The spec says "alternatively" but a spec should prescribe, not suggest.
   - Recommendation: Pick one. If the team is small and stable, option A is simpler. If onboarding is frequent, option B plus REQ-012 is required. Document the decision and the rationale.

2. **REQ-010**: CORS restriction has a conditional fallback that is effectively a different requirement.
   - Possible interpretations: (A) Set `DOMAIN_CLIENT`/`DOMAIN_SERVER` and LibreChat's middleware restricts origins, (B) LibreChat's `cors()` call is unconditional and Caddy must enforce CORS headers instead.
   - Why it matters: The implementer must investigate the LibreChat source code to determine which path to take. If option B is needed, this becomes a change to the infra repo's Caddy configuration, which is out of scope of this spec. The spec does not define what "verify that LibreChat's CORS middleware uses these values" means concretely -- what file, what test, what constitutes verification.
   - Recommendation: Investigate before implementation begins. Add a pre-implementation task: "Read `api/server/index.js:116` and trace the `cors()` call to determine if `DOMAIN_CLIENT` restricts origins. Record the finding. If not, create a Caddy CORS header rule in the infra repo and add it as a dependency."

3. **REQ-004**: RAG API image pinning says "verify available tags in the registry before implementation" but does not specify what to do if no stable/release tag exists.
   - Possible interpretations: (A) Use the dev image but pin to a specific SHA, (B) Build a release image locally, (C) Accept the dev image as-is with a version pin.
   - Why it matters: The research skeleton in Section 6.10 already shows `librechat-rag-api-dev-lite:v0.8.4` as the prod image -- a dev-lite image in production. If no non-dev image exists, this requirement is either unachievable or silently degraded.
   - Recommendation: Define the fallback explicitly: "If no release image exists, pin the dev-lite image to a specific version tag (not `:latest`). Document this as accepted technical debt."

4. **REQ-039**: Resource limits say "if `deploy.resources.limits` is silently ignored, fall back to legacy `mem_limit`/`cpus` syntax."
   - Possible interpretations: The implementer must deploy, check `docker stats`, and then potentially rewrite the compose file. This is not a requirement -- it is a troubleshooting procedure disguised as a requirement.
   - Recommendation: Split into two requirements: (A) "Add resource limits using `deploy.resources.limits` syntax," and (B) "Verify resource limits are enforced via `docker stats` MEM LIMIT column. If not enforced, convert to `mem_limit`/`cpus` syntax and re-verify." Make (B) a validation step, not an implementation alternative.

5. **REQ-018**: RPO/RTO targets are "recommended starting point" values, not firm requirements.
   - Possible interpretations: Are RPO=24h and RTO=1h requirements or suggestions? AVAIL-001 and AVAIL-002 treat them as requirements ("RPO <= 24 hours", "RTO <= 1 hour"), but REQ-018 says "recommended starting point" and "revisit if PII detection is in block mode."
   - Why it matters: If PII is in block mode, GuardrailEvent becomes compliance-relevant, but the spec does not define what the tighter RPO should be. This defers a critical decision.
   - Recommendation: State firmly: "RPO = 24 hours, RTO = 1 hour for initial deployment. Before enabling PII detection in block mode, re-evaluate RPO for the GuardrailEvent collection and document the revised target."

6. **REQ-028**: Prometheus/Grafana deployment topology is left as a "document the decision" requirement.
   - Possible interpretations: Same server, separate host, or cloud SaaS. Each has wildly different implementation effort, cost, and reliability characteristics.
   - Why it matters: "Document the decision" is not an implementable requirement. The implementer will pick the easiest option (same server) unless told otherwise, which the spec itself flags as a SPOF.
   - Recommendation: Make the decision in the spec. For a small team on a single server, recommend same-server deployment with the explicit constraint that REQ-031 (external uptime) is the primary alerting mechanism and Prometheus/Grafana is for diagnostics only.

---

### Missing Specifications

1. **Rollback procedures for each phase**: The spec defines rollback for MongoDB auth (EDGE-003) but not for any other change. What happens if switching to release images (REQ-003) breaks the application? What if `NODE_ENV=production` causes unexpected behavior beyond session invalidation? What if resource limits cause OOM kills on the API?
   - Why it matters: Without defined rollback, the team will improvise under pressure during an incident, increasing the risk of making things worse.
   - Suggested addition: For each phase, define a rollback checkpoint: "Before starting Phase N, take a snapshot/backup. If any requirement in Phase N causes service degradation, revert to the pre-phase state by [specific steps]."

2. **Order of operations within Phase 1**: REQ-001 through REQ-017 are listed but the spec only says "MongoDB auth migration is the highest-risk step -- do it first" and "Apply `NODE_ENV=production` last." The other 15 requirements have no ordering guidance.
   - Why it matters: Some requirements have implicit dependencies. For example, REQ-013 (remove MongoDB port) should happen after REQ-006 (enable auth) is verified, not before -- otherwise you lose external access for troubleshooting during migration. REQ-015 (log rotation) should happen before REQ-014 (change log level) to avoid filling disk with warn-level JSON logs.
   - Suggested addition: Define an explicit ordering or at minimum identify dependency chains within each phase.

3. **Cron job management**: REQ-019, REQ-020, REQ-021, REQ-022 all create automated backup scripts but do not specify: where cron entries are managed, how they are version-controlled, how cron failures are detected (separate from backup script failures), or what user the cron jobs run as.
   - Why it matters: Cron jobs are invisible infrastructure. If the server is rebuilt from backups, cron entries on the old host are lost unless they are part of the documented configuration.
   - Suggested addition: "All cron entries must be defined in a `crontab.prod` file committed to version control. Installation is documented in the operational runbook."

4. **MeiliSearch backup and recovery**: The research (Section 2.2) classifies MeiliSearch as "Low" criticality because it rebuilds from MongoDB. But the spec has no requirement covering MeiliSearch recovery after a restore. If MongoDB is restored from backup, does MeiliSearch automatically re-index? How long does that take? Is search unavailable during re-indexing?
   - Why it matters: Users will notice broken search after a disaster recovery. The RTO calculation does not account for MeiliSearch rebuild time.
   - Suggested addition: Add a note to REQ-024 (restore procedures): "Document MeiliSearch re-indexing procedure after MongoDB restore. Estimate re-index time for current data volume. Include in RTO calculation."

5. **Secret rotation procedure**: REQ-005 covers initial secret generation, and REQ-046 mentions "secret rotation procedures" as a runbook item, but there is no requirement defining rotation cadence or what triggers rotation.
   - Why it matters: FAIL-004 (secret compromise) says "regenerate all affected secrets" but does not address proactive rotation. Compliance frameworks often require periodic rotation.
   - Suggested addition: "Define secret rotation cadence (recommended: annually for JWT secrets, immediately upon team member departure). Document which secrets require service restart vs. which take effect immediately."

6. **Staging/test environment**: The spec repeatedly says "test on staging first" (RISK-001, RISK-002, REQ-024, EDGE-003) but no requirement defines what the staging environment is or how to create one.
   - Why it matters: If there is no staging environment, "test on staging" is unachievable and will be skipped.
   - Suggested addition: Either define a staging environment requirement or remove all references to staging and replace with concrete alternative procedures (e.g., "test on a local Docker environment with a copy of production data").

7. **Redakt API deployment details**: REQ-040 says "deploy Redakt API service as a Docker container on the same network" but does not specify: which image, which version, what health check, what resource limits, what log rotation, or how it is added to `docker-compose.prod.yml`.
   - Why it matters: Every other service gets detailed deployment specifications. Redakt is treated as a black box despite being a hard dependency when PII detection is enabled.
   - Suggested addition: Add Redakt to the `docker-compose.prod.yml` skeleton with image, health check, resource limits, and log rotation -- the same treatment as every other service.

8. **Monitoring for the monitoring stack**: If Prometheus or Grafana crash, who notices? The spec has no health checks or alerting for the monitoring infrastructure itself.
   - Why it matters: Silent monitoring failure means you think you are being monitored when you are not.
   - Suggested addition: Add Prometheus and Grafana to the health check requirements (REQ-027) or define a separate watchdog mechanism.

---

### Research Disconnects

- Research finding "disk encryption (LUKS)" in Section 6.12 not addressed in spec. The research explicitly mentions this for PII-adjacent audit data (GuardrailEvent). If GDPR compliance is a concern (REQ-048), at-rest encryption is typically expected.
- Research finding "Docker socket security" in Section 6.12 ("ensure the Docker socket is not exposed over TCP, consider rootless Docker") not addressed in spec. This is a host-level attack vector.
- Research finding "node_exporter for host-level metrics" in Section 3.2 not addressed in spec. REQ-029 and REQ-030 cover application and database exporters but host CPU, memory, disk, and network metrics have no requirement. REQ-035 partially covers disk but not CPU/memory/network.
- Research finding "Loki + Grafana for log aggregation" in Section 3.4 not addressed in spec. The spec sets log format (REQ-014) and rotation (REQ-015) but has no requirement for centralized log search. During incident response, grepping individual container logs is slow.
- Research finding "MinIO bucket versioning" in Section 2.5 not addressed in spec. The research offers this as protection against accidental deletion, which is a different failure mode than backup/restore covers.
- Research finding "MongoDB slow query alert (>1s)" in Section 3.3 alert table not addressed in REQ-032 alert list. The spec's alert list is a subset of the research's alert table.
- Stakeholder need "PII guardrails must be active before wider rollout" (Stakeholder Validation section) has no corresponding gate or milestone. The spec has PII in Phase 4 but does not define what "wider rollout" means or what blocks it.
- Research finding "community tool jgera/librechat-backup" in Section 2.3 not evaluated in spec. The spec creates custom backup scripts without acknowledging this existing solution.
- Research Section 4.6 on SSRF protection has no corresponding spec requirement. The research documents SSRF defaults and allowlisting but the spec does not verify or configure this.

---

### Risk Reassessment

- **RISK-003** (resource limits silently ignored): Actually **MEDIUM** severity, not LOW. The spec assigns resource limits to prevent runaway processes (REQ-039) and uses memory as an alerting threshold (REQ-032: "container memory >85% of limit"). If limits are silently ignored, the alerting threshold is meaningless -- alerts will never fire because there is no limit to measure against. This creates a false sense of protection across two separate requirements.

- **RISK-005** (monitoring SPOF): Actually **MEDIUM** severity, not LOW. The spec routes 12+ alert conditions through Prometheus/Grafana (REQ-032). If the monitoring stack is on the same server and the server has a non-fatal degradation (high load, disk pressure, network issues), Prometheus may fail to scrape or Grafana may fail to evaluate alerts, while the application limps along. External uptime monitoring (REQ-031) only catches "is the site up" -- it does not cover disk >80%, high error rates, PII circuit breaker state, or backup failures. Most of the critical alerts in REQ-032 are blind during same-server monitoring degradation.

- **RISK-006** (backup restore takes longer than RTO): Actually **HIGH** severity, not MEDIUM. The spec sets RTO=1 hour (AVAIL-002) but FAIL-008 (complete server failure) requires: provision a new server, restore from off-host backups (REQ-023), redeploy Docker stack, restore MongoDB/MinIO/PostgreSQL, update DNS. This sequence realistically takes 2-4 hours minimum for a small team, especially if it happens outside business hours. The RTO=1 hour claim is aspirational, not tested, and the spec's own validation strategy (manual verification) says "perform full disaster recovery drill" but does not require it to complete within 1 hour.

- **RISK-007** (PII circuit breaker blocks all messages): Severity is correctly HIGH, but the mitigation is insufficient. "Start in warn mode" only defers the problem. When the team eventually switches to block mode, the same risk exists. The spec does not define: (a) criteria for switching from warn to block mode, (b) Redakt API availability SLA or redundancy, (c) what "manual override procedure" means concretely -- is it editing `.env.prod` and restarting, or is there a runtime toggle?

- **NEW RISK (unidentified)**: **Feature interaction cascade -- HIGH severity.** When PII detection (REQ-040), rate limiting (REQ-036), ban system (REQ-038), and token balance (REQ-037) are all active, a user could experience: message blocked by PII (counts as a violation) -> violation count increments -> ban threshold reached -> user banned for 2 hours. If PII detection has a high false positive rate, legitimate users get banned. The spec does not clarify whether PII blocks count as ban violations, or how these systems interact.

- **NEW RISK (unidentified)**: **Configuration drift between `.env` and `.env.prod` -- MEDIUM severity.** REQ-006 says update `MONGO_URI` in `.env.prod` with credentials. But MongoDB now requires auth. If someone runs the dev stack with the old `.env` (no credentials), they are locked out of the database. The spec's dual-env strategy assumes dev and prod can diverge on critical connection parameters, but MongoDB auth is a server-side change that affects all clients.

---

### Untestable or Weakly Testable Criteria

1. **REQ-044** (patching cadence): "Establish update/patching cadence" -- how do you verify this is "done"? A written policy is not enforcement. There is no mechanism to detect missed patches.
2. **REQ-046** (runbooks): "Document operational runbooks" -- what constitutes a complete runbook? The spec lists topics but not acceptance criteria for documentation quality or completeness.
3. **REQ-048** (GDPR procedures): "Establish GDPR data subject request procedures" -- how do you verify cascading deletion actually works across all collections, MinIO, and pgvector? The spec says "verify" but does not define a test.
4. **AVAIL-002** (RTO <= 1 hour): The manual verification says "perform full disaster recovery drill" but does not require it to complete within 1 hour. The criterion and the test are disconnected.
5. **SEC-004** (CORS restriction): "No wildcard origins" -- the test says "attempt API request from a different origin" but CORS is enforced by browsers, not servers. A `curl` from a different origin will succeed regardless of CORS headers. The test must use a browser or verify the `Access-Control-Allow-Origin` response header.

---

### Missing Edge Cases

1. **EDGE-MISSING-001: Backup script runs during MongoDB auth migration.** If the cron-based backup fires while MongoDB is mid-migration (auth being enabled, users being created), the backup script may fail or produce an inconsistent backup. No coordination mechanism is defined.

2. **EDGE-MISSING-002: Simultaneous resource exhaustion.** MongoDB hits its 4G memory limit (REQ-039) at the same time as a `mongodump` backup is running (REQ-019). The backup may fail or be killed by Docker's OOM handler. The memory limit does not account for backup overhead.

3. **EDGE-MISSING-003: Clock drift on backup server.** Backup scripts use `date` for timestamp naming (REQ-019). If the server clock drifts, retention pruning (30 days) may delete recent backups or keep too many old ones. No NTP requirement is specified.

4. **EDGE-MISSING-004: Partial Phase 1 deployment.** If the implementer completes some Phase 1 requirements but not others (e.g., enables MongoDB auth but forgets to update the backup script credentials), the backup script silently fails. The spec does not define Phase 1 as atomic or identify cross-requirement dependencies.

5. **EDGE-MISSING-005: LibreChat upgrade changes health endpoint.** Health checks are hardcoded to `/health` on port 3080. If a future LibreChat version changes this endpoint, all health checks silently fail. The spec pins the image version (REQ-003) but does not address health check compatibility verification during upgrades.

---

### Contradictions and Tensions

1. **REQ-041 vs. FAIL-002**: REQ-041 sets `PII_DETECTION_FAIL_OPEN=false` (fail-closed), meaning all messages are blocked when Redakt is down. FAIL-002's recovery says "consider switching to `PII_DETECTION_FAIL_OPEN=true` temporarily." This requires editing `.env.prod` and restarting the API container -- during an incident when the team is already stressed. The spec prescribes fail-closed as the default but the failure recovery immediately suggests abandoning it.

2. **REQ-014 vs. incident debugging**: REQ-014 sets `LOG_LEVEL=warn` for production. But during an incident (FAIL-001, FAIL-006), the team will need debug-level logs. The spec does not define how to temporarily increase log verbosity without redeploying, nor does it warn that restarting with `LOG_LEVEL=debug` may fill the disk (even with rotation, high-volume debug logs may rotate too quickly to be useful).

3. **REQ-023 (off-host backup) vs. AVAIL-002 (RTO <= 1 hour)**: Restoring from off-host storage (S3, NAS) adds significant time to the recovery procedure. Downloading a large MongoDB backup over the network could alone exceed 1 hour depending on data size and bandwidth. The spec does not address keeping a local cache of the most recent backup for fast recovery.

---

### Recommended Actions Before Proceeding

1. **[HIGH] Resolve REQ-011 registration ambiguity.** Pick one approach (disable registration vs. domain restriction) and remove the alternative. This affects user onboarding workflow and must be decided before implementation.

2. **[HIGH] Investigate CORS behavior (REQ-010) before implementation begins.** Determine whether `DOMAIN_CLIENT`/`DOMAIN_SERVER` actually restricts CORS origins in the current LibreChat version. If not, add a Caddy CORS rule to the infra repo scope. This is a blocking investigation.

3. **[HIGH] Define feature interaction behavior.** Clarify whether PII detection blocks count toward ban violations (REQ-038 + REQ-040). Clarify whether rate limit rejections count toward ban violations. Document the interaction matrix.

4. **[HIGH] Reassess RTO target.** Perform a tabletop disaster recovery exercise: walk through FAIL-008 recovery steps with estimated times. If the total exceeds 1 hour, either revise the RTO to be realistic or add requirements to make 1-hour recovery achievable (e.g., keep local backup copies, pre-provision recovery scripts, document exact commands).

5. **[MEDIUM] Add Redakt API deployment details.** Specify image, version, health check, resource limits, and log rotation for Redakt in the `docker-compose.prod.yml` skeleton. It is a production service and should be treated as one.

6. **[MEDIUM] Define staging environment or remove references.** Either add a requirement for a staging environment or replace "test on staging" with achievable alternatives.

7. **[MEDIUM] Add explicit phase ordering and rollback checkpoints.** For Phase 1 especially, define the order of operations and a rollback procedure for each step.

8. **[MEDIUM] Address configuration drift between .env and .env.prod.** Document what happens to the dev environment after MongoDB auth is enabled. Either maintain a separate dev MongoDB instance or document that dev must also use credentials.

9. **[LOW] Add node_exporter requirement.** Host-level metrics (CPU, memory, disk I/O, network) are essential for diagnosing performance issues and are referenced implicitly by several alert conditions.

10. **[LOW] Add cron job version control requirement.** Backup automation cron entries should be in a committed file for disaster recovery reproducibility.

---

## Findings Addressed

**Date:** 2026-04-01
**Revision:** All findings from this critical review have been addressed in SPEC-010-production-readiness.md (status updated to "Draft (Revised 2026-04-01)").

### Ambiguities That Will Cause Problems

| # | Finding | Resolution |
|---|---------|------------|
| 1 | REQ-011 registration ambiguity | **Fixed.** Picked domain restriction approach (`allowedDomains: ["memodo.de", "memodo-eng.de"]`) with `ALLOW_REGISTRATION=true`. Rationale documented: self-service onboarding scales better than manual account creation. Requires REQ-012 for email verification. SEC-005 updated to match. |
| 2 | REQ-010 CORS conditional fallback | **Fixed.** Added pre-implementation investigation task with specific file to read (`api/server/index.js:116`), concrete actions for both outcomes, and explicit note that Caddy fallback is an infra repo dependency. |
| 3 | REQ-004 RAG API image fallback | **Fixed.** Added explicit fallback: "If no non-dev/release image exists, pin the dev-lite image to a specific version tag (not `:latest`) and document as accepted technical debt." |
| 4 | REQ-039 troubleshooting disguised as requirement | **Fixed.** Split into REQ-039 (add resource limits) and REQ-039-A (validation step: verify with `docker stats`, fall back if needed). |
| 5 | REQ-018 RPO/RTO ambiguity | **Fixed.** Firm targets: RPO=24h, RTO=4h (complete server failure), RTO=1h (single-service recovery). Rationale documented for why 1h full-server RTO is unrealistic. PII block mode re-evaluation clause retained. |
| 6 | REQ-028 topology decision deferred | **Fixed.** Decision made: same-server deployment. Rationale documented (cost, team size, external monitoring as primary alerting). Added REQ-027-A for monitoring stack health checks. |

### Missing Specifications

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Rollback procedures for each phase | **Fixed.** Added rollback checkpoints to Implementation Notes for all 5 phases. Phase 1 has specific rollback steps for MongoDB auth, image switch, and NODE_ENV. |
| 2 | Order of operations within Phase 1 | **Fixed.** Added explicit 14-step ordering for Phase 1 with dependency reasoning (e.g., REQ-013 after REQ-006, REQ-015 before REQ-014). |
| 3 | Cron job management | **Fixed.** Added REQ-050: `crontab.prod` file in version control, installation procedure, cron failure detection, user specification. |
| 4 | MeiliSearch backup and recovery | **Fixed.** Added to REQ-024: MeiliSearch re-indexing procedure after MongoDB restore, time estimation, search unavailability note. Added to FAIL-008 recovery steps. |
| 5 | Secret rotation procedure | **Fixed.** Added to REQ-046 acceptance criteria: secret rotation cadence (annually for JWT, immediately on team departure), which secrets require restart vs. immediate effect. |
| 6 | Staging/test environment | **Fixed.** Added "Staging environment note" to Implementation Notes: no dedicated staging; all "test on staging" means local Docker with production data copy. Specific instructions provided. |
| 7 | Redakt API deployment details | **Fixed.** REQ-040 now specifies: network (`caddy_net`), health check (`/health` port 8000), resource limits (1G memory, 1.0 CPU), log rotation, restart policy. Same treatment as other services. |
| 8 | Monitoring for monitoring stack | **Fixed.** Added REQ-027-A: health checks for Prometheus and Grafana, watchdog cron job for independent failure detection. |

### Research Disconnects

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Disk encryption (LUKS) | **Documented as out of scope.** Host-level provisioning concern, not container config. Recommendation noted for server provisioning checklist. |
| 2 | Docker socket security | **Documented as out of scope.** Rootless Docker has compatibility limitations. Socket not exposed over TCP (default). Future hardening item. |
| 3 | node_exporter for host metrics | **Fixed.** Added REQ-051 for node_exporter deployment. |
| 4 | Loki/log aggregation | **Documented as out of scope.** Log rotation + structured JSON sufficient for small team. Revisit after 3 months of production operation. |
| 5 | MinIO bucket versioning | **Documented as out of scope.** Daily backups cover data loss. Versioning is lower-priority protection against accidental single-file deletion. |
| 6 | MongoDB slow query alert | **Documented as deferred.** Requires MongoDB profiler, adds overhead. Add after 1 month of production operation once baseline is established. |
| 7 | PII guardrails gate for wider rollout | **Documented.** Current user base is Memodo engineering only. PII block mode switch criteria (REQ-041) becomes a gate when rollout to additional users is planned. |
| 8 | Community tool jgera/librechat-backup | **Documented as evaluated, not adopted.** Custom scripts provide more control. Revisit if maintenance burden increases. |
| 9 | SSRF protection | **Fixed.** Added REQ-052 to verify SSRF defaults and document the allowlist. |

### Risk Reassessment

| Risk | Original | New | Rationale |
|------|----------|-----|-----------|
| RISK-003 (resource limits ignored) | LOW | MEDIUM | If limits are ignored, alerting threshold "memory >85% of limit" is meaningless. False sense of protection across two requirements. |
| RISK-005 (monitoring SPOF) | LOW | MEDIUM | 12+ alert conditions route through Prometheus. Non-fatal degradation makes most critical alerts blind. External monitoring only catches "is site up." |
| RISK-006 (backup restore > RTO) | MEDIUM | HIGH | FAIL-008 recovery realistically takes 2-4 hours. RTO revised to 4h for complete server failure to match reality. |
| RISK-007 (PII circuit breaker) | HIGH (unchanged) | HIGH | Mitigation strengthened: fail-open as initial default, explicit switch criteria, documented override procedure (REQ-041-A). |

### New Risks Added

| Risk | Severity | Description |
|------|----------|-------------|
| RISK-010 | HIGH | Feature interaction cascade: PII + rate limiting + ban system. Addressed via EDGE-017 (PII blocks do NOT count as ban violations) and interaction matrix documentation. |
| RISK-011 | MEDIUM | Configuration drift between `.env` and `.env.prod` after MongoDB auth. Addressed via REQ-053 with options documented. |

### Missing Edge Cases Added

| Edge Case | Description |
|-----------|-------------|
| EDGE-012 | Backup script runs during MongoDB auth migration. Mitigation: disable cron before migration. |
| EDGE-013 | Simultaneous resource exhaustion during backup (MongoDB OOM + mongodump). Mitigation: off-peak scheduling, memory accounting. |
| EDGE-014 | Clock drift affects backup retention. Mitigation: NTP verification in pre-flight checklist. |
| EDGE-015 | Partial Phase 1 breaks backup credentials. Mitigation: explicit phase ordering, post-Phase-1 validation. |
| EDGE-016 | LibreChat upgrade changes health endpoint. Mitigation: health endpoint verification in upgrade checklist. |
| EDGE-017 | Feature interaction cascade (PII + rate limit + ban + balance). Mitigation: PII blocks excluded from violation count. |

### Untestable Criteria Made Testable

| Criterion | Fix |
|-----------|-----|
| REQ-044 (patching cadence) | Now specifies: `unattended-upgrades` must be enabled (verifiable via `systemctl status`), calendar event for monthly review, GitHub watch on releases. |
| REQ-046 (runbooks) | Now specifies acceptance criteria: exact commands, expected output, "verify success" step per runbook. Peer review required. |
| REQ-048 (GDPR procedures) | Now includes a concrete verification test: create test user, generate data, execute erasure, verify no data remains across all stores. |
| AVAIL-002 (RTO) | Revised to 4h for complete server failure, 1h for single-service. DR drill must be timed and complete within 4h. |
| SEC-004 (CORS) | Test now specifies: send preflight with evil origin, check `Access-Control-Allow-Origin` header (not request success). Notes that `curl` without Origin succeeds regardless. |

### Contradictions Resolved

| Contradiction | Resolution |
|---------------|------------|
| REQ-041 vs FAIL-002 (fail-closed vs fail-open) | **Resolved.** REQ-041 changed to fail-open as initial default. Fail-closed only after Redakt proves >99.5% uptime over 30 days and override procedure is tested. FAIL-002 updated with both fail-open and fail-closed behavior. No contradiction remains. |
| REQ-014 vs incident debugging | **Resolved.** Added REQ-014-A: log level escalation procedure with specific steps, 15-minute capture window, 30-minute maximum, disk space warning. Referenced in REQ-046 runbooks. |
| REQ-023 vs AVAIL-002 (off-host backup vs RTO) | **Resolved.** Added REQ-023-A: keep most recent backup cached locally for fast recovery. RTO revised to 4h for full server failure to account for off-host download time. |
