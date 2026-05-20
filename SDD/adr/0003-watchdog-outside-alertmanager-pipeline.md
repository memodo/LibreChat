---
adr: 0003
title: Run the monitoring watchdog outside the Prometheus/Alertmanager pipeline
status: Accepted
date: 2026-05-20
supersedes: null
superseded_by: null
tags: [cross-cutting, observability, alerting, reliability]
---

# ADR 0003: Run the monitoring watchdog outside the Prometheus/Alertmanager pipeline

## Status

Accepted (2026-05-20)

## Context

The MemodoAI production deployment routes operational alerts to a Microsoft Teams channel through a Prometheus + Alertmanager pipeline (SPEC-010 REQ-032). Twelve-plus alert rules — `ServiceDown`, `MongoDBRestartLoop`, `DiskSpaceCritical`, `HighErrorRate`, `PIICircuitBreakerOpen`, `BackupStale`, etc. — fire from `monitoring/prometheus/alerts.yml`, get grouped and deduplicated by Alertmanager, and are POSTed via `msteamsv2_configs` to a webhook URL mounted from `monitoring/alertmanager/secrets/teams-webhook-url`.

SPEC-010 RISK-005 acknowledges that the entire monitoring stack — Prometheus, Alertmanager, Grafana — runs on the same Hetzner host as the application it observes. This is an explicit single-point-of-failure, accepted under REQ-028 because a separate monitoring host doubles infrastructure cost and operational burden for a small team. The stated mitigation is external uptime monitoring (REQ-031), but external monitoring only answers a single question — "is `chat.memodo-eng.de` responding" — and cannot distinguish "everything healthy" from "site healthy, but Prometheus is dead, so the next several hours of disk-full / mongo-restart-loop / PII-breaker-open events will never produce a Teams notification."

SPEC-010 REQ-027-A closes that gap by introducing `scripts/monitoring-watchdog.sh`: a 5-minute cron job that probes `127.0.0.1:9090/-/healthy` (Prometheus), `127.0.0.1:9093/-/healthy` (Alertmanager), `127.0.0.1:3000/api/health` (Grafana), `127.0.0.1:3080/health` (LibreChat API), and Docker healthcheck state for MongoDB and pgvector. When any check fails for two consecutive runs (>5 min), the script POSTs an Adaptive Card directly to the same Teams webhook Alertmanager uses.

The question this ADR resolves: should that watchdog go through the Alertmanager pipeline (as a custom metric scraped by Prometheus, or as an Alertmanager receiver), or run as an independent cron job that bypasses it entirely? Without an explicit decision, a future maintainer may reasonably try to "consolidate" the two paths and inadvertently re-introduce the silent-failure mode the watchdog exists to prevent.

## Decision

**The monitoring watchdog runs as a host-level cron job that bypasses Prometheus and Alertmanager entirely.**

Specifically:

1. The watchdog is invoked by `crontab.prod` every 5 minutes — not by Prometheus, not by Alertmanager, not by any container in the monitoring stack.
2. All probes target services via their `127.0.0.1` host port bindings or via `docker inspect`. None of them traverse a Docker network whose health depends on the monitoring stack being up.
3. The watchdog reads the Teams webhook URL directly from the same secret file Alertmanager uses (`monitoring/alertmanager/secrets/teams-webhook-url`). The secret is a shared source of truth; the *delivery path* is independent — the watchdog never calls Alertmanager's API, never posts to a receiver, and shares no runtime state with it.
4. The watchdog has no awareness of Alertmanager's groupings, silences, or routing — it fires a raw Adaptive Card on its own schedule.

This produces two parallel alert paths to the same Teams channel:

| Path | Source of truth | Failure mode it covers |
|---|---|---|
| Prometheus → Alertmanager → Teams | `alerts.yml` rules over scraped metrics | Application/infra conditions (5xx rate, disk, container memory, PII breaker, backup staleness, …) |
| Cron → `monitoring-watchdog.sh` → Teams | Local HTTP probes + Docker healthcheck state | The Prometheus/Alertmanager pipeline itself being down or wedged |

## Alternatives Considered

### Watchdog runs outside the pipeline (chosen)

Survives any failure mode of Prometheus, Alertmanager, Grafana, or the monitoring Docker network. The only shared dependency with Alertmanager is the Teams webhook secret file and the Teams webhook endpoint itself (which is outside our infrastructure). Operational cost: two alert sources to recognize in the Teams channel and the maintenance burden of a small bash script. Accepted as cheap relative to the failure it prevents.

### Watchdog as a Prometheus alert rule (rejected — circular)

Could be expressed as something like `up{job="prometheus"} == 0` or an `ALERTS_FOR_STATE` self-check. This cannot work for the failure mode at hand: Prometheus cannot scrape itself when it is down, and Alertmanager cannot route an alert it never receives. The same circularity applies to any rule that watches Alertmanager or Grafana through Prometheus. This alternative is not just a worse engineering choice — it is logically incapable of catching the failure the watchdog exists to catch.

### Watchdog as an Alertmanager receiver / webhook (rejected — couples to the thing it watches)

The watchdog could POST findings to Alertmanager's API and let Alertmanager dedupe, group, and route them. This re-introduces a runtime dependency on Alertmanager being healthy — precisely the failure mode the watchdog is designed to survive. It also creates a class of "monitoring is broken" alerts that may sit in a wedged Alertmanager and never reach Teams.

### No watchdog, rely on external uptime monitoring (rejected — wrong granularity)

The external uptime check (REQ-031) hits `chat.memodo-eng.de` and answers only "is the public site responding." It cannot distinguish a fully healthy stack from one where Prometheus is dead and no internal alerts will fire for hours. Internal alerts cover disk exhaustion, mongo restart loops, PII circuit breaker state, container memory pressure, backup staleness — conditions external monitoring is blind to. Removing the watchdog would mean accepting silent monitoring failure as a class.

### Separate monitoring host (rejected per SPEC-010 REQ-028 / RISK-005)

Moving the monitoring stack onto a second host removes the SPOF entirely. SPEC-010 explicitly rejects this on cost/burden grounds for a small team on a single server, and instead accepts the SPOF. This ADR works within that constraint.

## Consequences

### Positive

- Silent monitoring failure becomes detectable: if Prometheus, Alertmanager, or Grafana dies, the next watchdog run raises an alert within 10 minutes worst-case (two-consecutive-failure rule × 5-minute interval).
- The watchdog has zero runtime dependency on the monitoring stack, Docker networking between stacks, or the application stack — it only needs the host's `cron`, `bash`, `curl`, and `docker` CLI.
- Sharing the webhook secret file (rather than duplicating the URL into an env var or a second secret) keeps key rotation simple — one file, both paths pick it up on the next invocation.
- Establishes a cross-cutting precedent: a watcher should not live on the thing it watches. Future meta-monitoring additions (backup-collector heartbeat, blackbox probes for TLS expiry, etc.) inherit this principle.

### Negative / Trade-offs accepted

- Two alert paths land in the same Teams channel with different message formats — readers must learn that an alert may originate from either Alertmanager (rich templating, grouped) or the watchdog (minimal Adaptive Card, ungrouped).
- The watchdog has no dedupe or grouping. If multiple services go unhealthy simultaneously, expect multiple Teams messages within a few minutes.
- No escalation path, on-call rotation, or PagerDuty integration — the watchdog is a Teams ping, consistent with SPEC-010's overall single-channel alerting model.
- The watchdog is a ~120-line bash script with no test harness. Acceptable at this scope (REQ-027-A) but worth flagging if it grows.

### Neutral observations

- The watchdog also probes the application's own `localhost:3080/health` and Docker healthcheck state for `chat-mongodb` and `vectordb` as a secondary safety net. This deliberately overlaps with Prometheus's `ServiceDown` alert: redundant coverage when Prometheus is healthy, primary coverage when it is not.
- The shared webhook secret file is the one component that, if corrupted or rotated incorrectly, can take down BOTH alert paths simultaneously. Accepted as a same-severity-tier risk to the watchdog misbehaving — and the cron job runs frequently enough that a broken secret would be noticed quickly through the absence of expected liveness logs.
- This ADR does not preclude adding Prometheus/Alertmanager-based meta-monitoring later (e.g., `up{job="alertmanager"} == 0` routed elsewhere) — those would be additive coverage, not a replacement for the cron watchdog.

## References

- SDD/requirements/SPEC-010-production-readiness.md (REQ-027, REQ-027-A, REQ-028, REQ-031, REQ-032, RISK-005)
- scripts/monitoring-watchdog.sh
- monitoring/alertmanager/alertmanager.yml
- monitoring/prometheus/alerts.yml
- crontab.prod
- ARCHITECTURE.md §"Meta-monitoring (Watchdog)"
