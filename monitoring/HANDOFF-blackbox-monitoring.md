# Handoff — Blackbox Exporter Monitoring (Redakt + TLS + MinIO)

**Status:** IMPLEMENTED 2026-06-10 — all 5 change-set items done, validated with promtool +
blackbox_exporter `--config.check` + `docker compose config`. Awaiting deploy (git push →
prod pull → `./prod-mon.sh up -d`) and post-deploy verification (section "Deploy" below).
**Resolved on resume:** baseline reconciled (local/prod monitoring/ hash-identical, 13/13 files);
MinIO `/minio/health/live` confirmed 200 anonymous from a caddy_net container; TLS set = 6 domains
(ta-agent excluded, Pablo confirmed); image pinned to `prom/blackbox-exporter:v0.28.0`.
**Decided:** 2026-06-10. Process = implement directly (not full SDD). Approach = blackbox_exporter.

---

## Why this exists (the incident)

Prod was rebooted; the Redakt PII stack (sibling compose project at `/opt/docker/redakt`)
did not come back up, and **nothing alerted**. The only Redakt signal in the stack today is
*indirect and traffic-dependent*: `alerts.yml` → `PIICircuitBreakerOpen`
(`librechat_pii_circuit_breaker_state == 1`), which only trips after live chat traffic hits a
dead Redakt 5× and opens the circuit breaker. On a quiet/just-rebooted system with no chat,
the breaker stays closed → silence. We need an **active, traffic-independent uptime probe**.

## Scope (agreed)

- **Redakt** uptime + degraded detection — the core ask.
- **TLS** certificate-expiry monitoring across public HTTPS routes (activates the currently
  inert `TLSCertExpirySoon` alert in `alerts.yml`).
- **MinIO** uptime.
- **EXCLUDE ta-agent-api** for uptime. (Its domain *may* still be included in the TLS-expiry
  set — Pablo to confirm on resume; default: leave it out to honor "ignore ta-agent".)

## Validated facts (live prod investigation, 2026-06-10) — trust these

**Redakt endpoints (confirmed live, match source `redakt/src/redakt/routers/health.py`):**
- `GET http://redakt:8000/api/health/live` → `{"status":"ok"}` (liveness; 200 whenever the
  process is up — use for the uptime probe).
- `GET http://redakt:8000/api/health` → `{"status":"healthy","presidio_analyzer":"up",
  "presidio_anonymizer":"up"}` (readiness; `status` becomes `"degraded"` if either Presidio
  sub-service is down — use for the degraded probe via body regex).

**Network topology (confirmed via `docker network inspect`):**
- Redakt service container `redakt-redakt-1`, alias **`redakt`**, port **8000**,
  on `redakt_default` **and** `caddy_net`.
- MinIO container **`minio`**, port **9000**, on `caddy_net` **and** `librechat_default`.
  Standard health endpoint `GET /minio/health/live` (anonymous, 200) — CONFIRM on resume from
  a curl-capable container on `caddy_net`/`librechat_default` (analyzer test gave 000 only
  because it's not on MinIO's network).
- Prometheus is already attached to `redakt_default`, `caddy_net`, `librechat_default`,
  `monitoring_monitoring`. **No network fix needed.**
- **Both `redakt` and `minio` are reachable over `caddy_net`** → attaching blackbox_exporter to
  `[monitoring, caddy_net]` covers both internal targets in one network. Public TLS probes go
  out over normal container internet egress.

**⚠️ Debugging gotcha (cost an hour — do NOT repeat):** the BusyBox `wget`/`nslookup` baked into
the `prom/prometheus` image return false `bad address` / `No answer` for *every* container name
(incl. `node-exporter`, `mongodb-exporter`) because of the host's systemd-resolved `resolv.conf`
(`search .` + `options edns0 trust-ad ndots:0`). **The DNS is fine** — all 7 existing Prometheus
jobs are `up` via Go's resolver. To test container DNS on this host, use a glibc container
(e.g. `redakt-presidio-analyzer-1` has `curl`) or `curl http://localhost:9090/api/v1/targets`.
blackbox_exporter is a Go binary, so it resolves names the same way Prometheus does.

**Pre-existing half-built wiring to clean up:** `monitoring/docker-compose.monitoring.yml`
already declares the `redakt_default` external network and joins Prometheus to it (with a comment
saying "scrape redakt-api:8000/health") — but `prometheus.yml` has **no redakt job**, and the
service name is **`redakt`**, not `redakt-api`. Fix the stale comment.

**TLS domains (from infra Caddyfile, `/Users/pablooliva/Dev/infra`):**
`chat.memodo-eng.de`, `grafana.memodo-eng.de`, `minio.memodo-eng.de`,
`minio-console.memodo-eng.de`, `proc.memodo-eng.de`, `redakt.memodo-eng.de`,
`ta-agent.memodo-eng.de`. Default TLS-probe set = all except `ta-agent` (confirm). Public routes
are basic-auth gated → the TLS module must accept `401` as a valid status
(`valid_status_codes: [200, 401]`); the cert-expiry metric is emitted regardless of HTTP status.

## Change set (implement after prod/local aligned)

**FIRST STEP ON RESUME:** diff local `monitoring/` against prod
`/opt/docker/librechat/monitoring/` (via `ssh Hetzner-personal`) to confirm the baseline matches
before editing — this is the exact drift class that produced the half-built wiring above.

1. **`monitoring/docker-compose.monitoring.yml`** — add a `blackbox-exporter` service
   (`prom/blackbox-exporter`, pin a version), `networks: [monitoring, caddy_net]`, bind config via
   **directory** mount `./blackbox:/etc/blackbox_exporter:ro` (NOT a single-file mount — see the
   inode lesson in the Prometheus service comment). Match existing resource-limit + logging +
   healthcheck conventions. Fix the stale `redakt-api` comment on the Prometheus `redakt_default`
   network block.

2. **`monitoring/blackbox/blackbox.yml`** (NEW) — modules:
   - `http_2xx` — plain GET, expect 2xx (Redakt liveness, MinIO).
   - `http_redakt_healthy` — GET, expect 2xx **and** `fail_if_body_not_matches_regexp:
     ['"status":"healthy"']` (Redakt readiness/degraded).
   - `http_tls` — GET, `valid_status_codes: [200, 401]`, `tls_config: {insecure_skip_verify:false}`
     (public HTTPS cert-expiry probes).

3. **`monitoring/prometheus/prometheus.yml`** — add jobs using the standard blackbox relabel
   pattern (`__param_target` ← target, `instance` ← target, `__address__` ← `blackbox-exporter:9115`):
   - `redakt-blackbox` (module `http_2xx`, target `http://redakt:8000/api/health/live`).
   - `redakt-readiness` (module `http_redakt_healthy`, target `http://redakt:8000/api/health`).
   - `minio-blackbox` (module `http_2xx`, target `http://minio:9000/minio/health/live`).
   - `blackbox-tls` (module `http_tls`, targets = the public HTTPS domain list above).

4. **`monitoring/prometheus/alerts.yml`** — add:
   - `RedaktDown`: `probe_success{job="redakt-blackbox"} == 0` for 2m, **critical**. (This is the
     alert that would have caught the incident.)
   - `RedaktDegraded`: `probe_success{job="redakt-readiness"} == 0` for 5m, warning.
   - `MinIODown`: `probe_success{job="minio-blackbox"} == 0` for 2m, warning/critical.
   - `TLSCertExpirySoon` **already exists** (currently inert) — verify its expr matches the new
     metric/labels: `probe_ssl_earliest_cert_expiry{job="blackbox-tls"} - time() < 14*24*3600`.
   - Note: the generic `ServiceDown` (`up == 0`) covers the *exporter* being unreachable, not the
     *probe target* — the real signal is `probe_success`. Keep both.

5. **`monitoring/grafana/provisioning/dashboards/service-overview.json`** — add panels:
   Redakt uptime stat (`probe_success{job="redakt-blackbox"}`), Redakt readiness stat,
   MinIO uptime stat, and a TLS days-to-expiry table
   (`(probe_ssl_earliest_cert_expiry{job="blackbox-tls"} - time())/86400` by `instance`).

## Deploy (monitoring-stack only — NO `npm run build` / `prod-sync.sh`)

Bind-mounted config comes from the git checkout on prod, so:
1. Local: edit + commit on `pablo` branch.
2. `git push`; on prod `git pull`.
3. Prod: `./prod-mon.sh up -d` (creates the `blackbox-exporter` container; recreates Prometheus
   only if needed) + reload rules: `./prod-mon.sh exec prometheus wget -qO- --post-data=
   http://localhost:9090/-/reload`. Grafana picks up provisioned dashboard JSON automatically.
4. Verify: `probe_success{job=~"redakt-blackbox|minio-blackbox"}` present and `1`;
   `probe_ssl_earliest_cert_expiry` populated. Optionally test `RedaktDown` by stopping the redakt
   stack briefly and confirming the alert fires after 2m.

## Open items to confirm on resume

- [ ] Prod/local reconciliation complete; `monitoring/` baseline matches prod.
- [ ] MinIO `/minio/health/live` returns 200 anonymously (verify from a `caddy_net` container).
- [ ] Final TLS-domain list (include `ta-agent`/`proc` or not?).
- [ ] blackbox_exporter image version to pin.
