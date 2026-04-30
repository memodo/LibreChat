# PRE-RESEARCH-013: Observability Extension (Logs, Traces, AI/LLM, Errors)

**Date:** 2026-04-30
**Status:** Draft brief — input to SDD research phase (not a completed RESEARCH doc)
**Author:** Pablo Oliva (with Claude)
**Successor to:** Sections 3 & 5 of RESEARCH-010 (Monitoring & Uptime, Usage & Cost Tracking)
**Trigger:** Sentry's AI Observability offering (https://sentry.io/solutions/ai-observability/) prompted a review of where the current Prom/Grafana stack stops and what additional signals MemodoAI needs to operate LibreChat + agents responsibly in production.

> This is a **pre-research brief**, not a finished RESEARCH document. Its purpose is to seed the SDD research phase with verified context, confirmed gaps, candidate solutions, constraints, and the open questions that the research phase must answer before a SPEC can be written. The research subagent should treat the "Candidate solutions" section as a starting point to investigate, not a conclusion.

---

## 1. Motivation

The current monitoring stack (delivered under SPEC-010 / REQ-027 through REQ-032 / REQ-051) gives MemodoAI **metrics and alerting** — fleet-level health, resource saturation, basic Mongo/Postgres/container signals, and Alertmanager-driven notifications. It does **not** answer:

- Why did *this specific user's* agent run fail / hang / produce a wrong answer?
- Which prompt was sent to Azure OpenAI, with how many tokens, and what did it cost?
- How long did each tool call inside an agent step take, and which one stalled?
- What JS errors are users hitting in the browser, and on which release?
- Where are the application logs that explain a 500, given they currently live only in Docker's `json-file` driver per host?
- Did Redakt PII detection fire for this conversation, and what's the end-to-end latency it added?

These gaps will become more painful as: (a) agent usage grows, (b) PII detection moves from warn → block, (c) more MCP integrations land (M365, etc.), and (d) cost-per-conversation needs to be attributable for chargeback or capacity planning.

Sentry's AI Observability product is one candidate answer. This brief frames the broader problem so the research phase can evaluate it against alternatives rather than adopting it by default.

---

## 2. Confirmed current state (verified 2026-04-30)

Source: `monitoring/docker-compose.monitoring.yml`, `monitoring/prometheus/prometheus.yml`, `monitoring/grafana/provisioning/`.

**In place:**

| Component | Image / version | Purpose |
|---|---|---|
| Prometheus | `prom/prometheus:v2.53.3` | Metrics, 30d retention, localhost-bound |
| Grafana | `grafana/grafana:11.5.2` | Dashboards (service-overview, containers, mongodb, host), behind Caddy at `grafana.memodo-eng.de` |
| Alertmanager | `prom/alertmanager:v0.28.1` | Alert routing |
| node-exporter | (from prod compose) | Host metrics — REQ-051 |
| librechat-exporter | `ghcr.io/virtuos/librechat_exporter:latest` | Mongo-derived application metrics — REQ-029 |
| mongodb-exporter | `percona/mongodb_exporter:0.40.0` | DB metrics — REQ-030 |
| postgres-exporter | `prometheuscommunity/postgres-exporter:v0.16.0` | pgvector metrics — REQ-030 |
| cAdvisor | `gcr.io/cadvisor/cadvisor:v0.49.1` | Container-level metrics |
| External uptime | (out-of-band) | Independent watchdog — REQ-031, mitigates monitoring-stack SPOF (RISK-005) |

**Networks:** monitoring (internal), `caddy_net` (external Grafana access), `librechat_default` (scraping app DBs), `redakt_default` (scraping Redakt API).

**Not in place anywhere in the repo:** Sentry, Langfuse, Loki, Promtail, Tempo, OpenTelemetry instrumentation, Helicone, Phoenix/Arize, ELK. (`grep` confirms no instrumentation packages are installed beyond Winston for logs.)

**Adjacent infra (relevant to design):**
- Caddy reverse proxy with TLS on `caddy_net` — any new web UI (Sentry/Langfuse/Grafana panels) routes through here.
- Redakt PII service on its own compose stack, scraped via `redakt_default`.
- Production server: single Hetzner Cloud host (acknowledged SPOF for monitoring under RISK-005).

---

## 3. Identified gaps (the three observability pillars + AI-specific signals)

| # | Gap | Why it matters here | Severity |
|---|---|---|---|
| G1 | **No centralized logs.** Logs live in Docker's `json-file` driver per container; no aggregation, search, retention policy, or correlation with metrics. | Already painful for incident response. Log lines for a single failed request span api → packages/api → Mongo → Azure OpenAI → Redakt with no join key. | High |
| G2 | **No distributed tracing.** No request-correlation ID propagated across frontend → `/api` → `packages/api` → Mongo/pgvector → Azure OpenAI → Redakt → MCP servers. | Cannot diagnose latency tails or partial failures in agent flows; cannot attribute slowness to a specific dependency. | High |
| G3 | **No application error tracking.** Errors surface only via 5xx counts in Prom + Winston log lines on disk. No grouping, deduping, release-tagging, source-map-resolved frontend stack traces, or per-user incident view. | Regressions land silently; frontend errors invisible. | High |
| G4 | **No LLM/agent-specific observability.** No per-call traces of prompt/completion, token counts, model latency, tool-call traces, agent step timelines, or cost attribution per conversation/user/agent. librechat-exporter only surfaces Mongo-derived aggregates. | Cannot debug agent regressions, evaluate prompt changes, attribute cost, or detect prompt-injection patterns. Becomes a hard blocker as M365/MCP integrations grow. | High |
| G5 | **No Real User Monitoring (RUM).** No browser-side performance, JS errors, Web Vitals, or session replay. | Frontend regressions visible only when users complain. | Medium |
| G6 | **No log-based alerting.** Alerting is metric-only (Alertmanager rules in `alerts.yml`). Cannot alert on log patterns ("PII redaction circuit breaker tripped 5× in 10min"). | GuardrailEvent and similar audit signals cannot drive alerts directly today. | Medium |
| G7 | **No synthetic monitoring beyond uptime.** External uptime (REQ-031) confirms the home page loads but does not exercise login → chat → agent flow. | Silent breakage of deeper code paths between deploys. | Medium |

---

## 4. Candidate solutions (starting list — research phase to evaluate, not adopt)

### 4.A — Logs

| Option | Posture | Fit notes |
|---|---|---|
| **Loki + Promtail** (Grafana stack) | Self-hosted | Plugs into existing Grafana for cross-pillar queries; lightweight; free. Likely default-favorite. |
| **ELK / OpenSearch** | Self-hosted | Heavier; richer search; usually overkill for single-host deploy. |
| **Vector + ClickHouse** | Self-hosted | Modern, performant; more bespoke to operate. |
| **Sentry log streaming** | SaaS | Ties logs to errors/traces in one product but PII egress concern. |

### 4.B — Traces / APM

| Option | Posture | Fit notes |
|---|---|---|
| **OpenTelemetry SDK → Tempo** (Grafana stack) | Self-hosted | Vendor-neutral instrumentation; same Grafana UI. Heaviest SDK-side lift. |
| **Sentry tracing** | SaaS or self-hosted | Same SDK as error tracking; lower instrumentation effort; ties traces to errors. |
| **Jaeger** | Self-hosted | Mature; less integrated with Grafana stack than Tempo. |

### 4.C — Error tracking

| Option | Posture | Fit notes |
|---|---|---|
| **Sentry SaaS (EU region)** | SaaS | Polished; release tracking; source maps; RUM included; mature Anthropic/OpenAI integrations for AI traces. PII egress is the dominant concern. |
| **Sentry self-hosted** | Self-hosted | Heavy stack (Postgres + ClickHouse + Kafka + Redis + Snuba). Solves egress; raises ops burden. |
| **GlitchTip** | Self-hosted | Sentry-API-compatible, much lighter; smaller feature surface (no AI tracing, weaker RUM). |
| **Bugsnag / Rollbar / Honeybadger** | SaaS | Comparable to Sentry SaaS; same egress concerns; weaker LLM tracing story. |

### 4.D — LLM / agent observability

| Option | Posture | Fit notes |
|---|---|---|
| **Langfuse** (self-hosted) | Self-hosted | Purpose-built for LLM tracing; trace spans for agent steps + tool calls; prompt management; cost attribution; runs on a Hetzner box next to existing monitoring. Strong fit for PII concerns. |
| **Phoenix / Arize** | Self-hosted (Phoenix) or SaaS (Arize) | Eval-focused; strong drift/regression tooling. |
| **Helicone** | SaaS or self-hosted | Proxy-based; lower instrumentation effort; coarser granularity than SDK-based. |
| **Sentry AI Observability** | SaaS or self-hosted | Same product as error tracking; bundles RUM. Egress concern repeats. |
| **OpenLLMetry (OTel) → Tempo** | Self-hosted | LLM semantic conventions over OTel; cleanest if also adopting Tempo. |

### 4.E — RUM / synthetic

| Option | Posture | Fit notes |
|---|---|---|
| **Sentry RUM** | SaaS | Bundled with above. |
| **Grafana Faro + k6** | Self-hosted | Aligns with Grafana stack; more setup. |
| **Plausible / Umami + custom synthetics** | Self-hosted | Privacy-first; thinner observability. |

### 4.F — Bundle hypotheses (for the research phase to evaluate against criteria)

- **H1 — Grafana-stack maximalist:** Loki + Tempo + OpenTelemetry + Langfuse + GlitchTip. All self-hosted on Hetzner, single Grafana pane of glass, no PII egress. Highest ops burden.
- **H2 — Sentry-centric:** Sentry SaaS (EU) for errors + traces + RUM + AI observability; keep Prom/Grafana for infra metrics; add Loki for logs. Lowest ops burden, requires PII scrubbing discipline.
- **H3 — Hybrid (likely sweet spot):** Loki for logs + Langfuse self-hosted for AI tracing + Sentry SaaS (EU) for frontend errors/RUM only (no LLM payloads sent to Sentry). Splits PII-heavy data from PII-free data.
- **H4 — Minimum viable:** Loki only, defer traces/AI/RUM to a later spec.

---

## 5. Constraints (carry into research)

1. **PII / data residency.** SPEC-009 introduced PII detection because prompts may contain personal data. Any SaaS that ingests prompts/completions must be EU-hosted and configured to scrub or refuse PII; preferably it should not see prompts at all. Redakt is on-prem for the same reason — observability needs to honor that posture.
2. **Single-host Hetzner deployment.** Self-hosted observability adds load to the same VM that runs the app. RISK-005 (monitoring SPOF) already accepted; adding more services compounds it. Memory/CPU budget vs. current resource limits in `docker-compose.monitoring.yml` must be respected.
3. **Existing Caddy gateway.** New web UIs should land on `*.memodo-eng.de` via `caddy_net`, never direct-exposed.
4. **TypeScript-first, monorepo discipline.** SDK instrumentation must respect workspace boundaries (CLAUDE.md): new backend code lives in `/packages/api`, not `/api`. Frontend SDK in `/client` only.
5. **`@librechat/agents` is a separately-developed dependency** (source at `/home/danny/agentus`). Instrumenting agent internals may require upstream coordination or wrapping at integration boundaries.
6. **Cost ceiling.** SaaS pricing should be evaluated against current MAU and projected agent-call volume; Sentry/Langfuse/etc. all have per-event or per-trace pricing tiers that scale fast with agent traffic.
7. **Compliance posture.** GuardrailEvent audit data may eventually be compliance-relevant (referenced in RESEARCH-010 §2.1). Anything that handles it must support retention, access control, and export.
8. **No detection-evasion features.** Any prompt/completion redaction must integrate with — not bypass — Redakt.

---

## 6. Research questions the SDD research phase must answer

**Architecture & scope**
1. Which gaps from §3 are in-scope for the next spec, and which are deferred? Is this one spec or split across several?
2. For the chosen scope, which bundle hypothesis (H1–H4) survives the constraints in §5? What concrete decision criteria (PII posture, ops burden, cost, integration depth) drive the choice?
3. Where does instrumentation live in the monorepo? Likely `/packages/api` for backend SDK init; `/client` for frontend SDK; thin wiring in `/api`. Confirm.
4. How is correlation achieved across services? (W3C `traceparent`? Custom header? Via OpenTelemetry context propagation?)
5. How does instrumentation interact with `@librechat/agents`? Wrap at the call site, or upstream PR?

**LLM/agent specifics**
6. What semantic schema is used for LLM spans? (OpenLLMetry / OpenInference / Langfuse SDK / Sentry AI?)
7. How are prompts/completions captured without leaking PII? Pre-Redakt, post-Redakt, hashed, sampled, or never?
8. How is per-user / per-conversation / per-agent cost attribution computed and where is it stored vs. the existing Mongo `transactions` collection (already used by SPEC-008 admin dashboard)?
9. How do we trace MCP tool calls (current and future M365 servers)?

**Logs**
10. Loki vs. alternatives: storage footprint, retention, query performance against current Winston log volume?
11. Promtail vs. shipping JSON via Docker logging driver vs. OTel logs?
12. Log → trace correlation: how do trace IDs land in Winston output?

**Errors / RUM**
13. Sentry EU SaaS vs. self-hosted Sentry vs. GlitchTip — concrete tradeoffs against MemodoAI's compliance posture.
14. Frontend source-map upload pipeline — fits where in the existing Vite/Turborepo build?
15. Release tagging: tied to git SHA? Docker image tag? Caddy header injection?

**Operations**
16. Resource budget: memory/CPU/disk for each added service on the Hetzner host; impact on existing limits.
17. Backups: which new data stores need backup coverage (extends RESEARCH-010 §2)?
18. Alert routing: do new signals (LLM error rates, frontend error spikes, log patterns) flow through existing Alertmanager or a separate channel?
19. Auth: how do new web UIs hook into the planned SSO gateway (RESEARCH-011) vs. local admin auth?

**Risk & compliance**
20. PII handling: explicit list of what each candidate sees, with a decision matrix vs. SPEC-009.
21. Data retention policies per data type (logs, traces, LLM payloads, errors, RUM).
22. Vendor lock-in: SDK portability if a vendor is later swapped.
23. GDPR / data processing agreements required for any chosen SaaS.

**Validation**
24. What does success look like? Define measurable acceptance: e.g., MTTR for a synthetic incident, % of failed agent runs with a complete trace, time-to-find-log-line for a given trace ID.
25. What synthetic test or staging exercise validates the stack end-to-end before production rollout?

---

## 7. Decision points to surface during research

These are the questions where the research phase should make a recommendation **and** name what the user must choose before SPEC drafting begins:

- **D1.** PII posture for prompts/completions: never-leave-host / scrubbed-then-egress / hashed / sampled. Pick one.
- **D2.** SaaS vs. self-hosted for each pillar. Default to self-hosted unless cost/ops makes it untenable.
- **D3.** Single integrated vendor (e.g., Sentry for errors + traces + AI + RUM) vs. best-of-breed split (e.g., Langfuse + Loki + GlitchTip).
- **D4.** Scope split: one big SPEC-013 vs. SPEC-013 (logs+traces) + SPEC-014 (LLM observability) + SPEC-015 (RUM/errors).
- **D5.** Whether to adopt OpenTelemetry as the instrumentation contract regardless of backend, to preserve portability.

---

## 8. Proposed scope boundaries (draft — research may revise)

**In scope (likely):** logs aggregation, distributed tracing across backend boundaries, LLM/agent tracing with cost attribution, application error tracking, log-based alerting integration with existing Alertmanager.

**Possibly in scope:** frontend RUM, source-map pipeline, release tagging, browser JS error capture.

**Out of scope:** replacing Prometheus/Grafana metrics; replacing Winston as the in-process logger; replacing Alertmanager; rebuilding the admin reporting dashboard (SPEC-008) — observability is for ops, the admin dashboard is for product/business signals; modifications to Redakt itself; modifying `@librechat/agents` upstream.

**Non-goals:** vendor consolidation for its own sake; full APM coverage of every dependency; on-call rotation tooling.

---

## 9. Inputs / prior art to load during research

- `SDD/research/RESEARCH-010-production-readiness.md` §3 (Monitoring & Uptime) and §5 (Usage & Cost Tracking) — extends both.
- `SDD/requirements/SPEC-008-admin-reporting-dashboard.md` — overlaps on cost/usage attribution.
- `SDD/requirements/SPEC-009-pii-detection-integration.md` — defines PII handling contract that observability must honor.
- `SDD/research/RESEARCH-011-sso-gateway-deployment.md` — informs auth for new admin UIs.
- `monitoring/docker-compose.monitoring.yml`, `monitoring/prometheus/prometheus.yml`, `monitoring/prometheus/alerts.yml`, `monitoring/grafana/provisioning/`.
- Vendor docs: Sentry AI Observability, Langfuse, Loki, OpenTelemetry, OpenLLMetry, Helicone, Phoenix/Arize, GlitchTip, Grafana Tempo/Faro.
- LibreChat upstream: any community discussion or existing observability hooks worth reusing.

---

## 10. Suggested next step

Run `/sdd-flow` (or the research phase manually) with this brief as the seed:

```
Conduct RESEARCH-013: Observability Extension for MemodoAI.

Use SDD/research/PRE-RESEARCH-013-observability-extension.md as the
seed brief. Honor the constraints in §5, answer the research questions
in §6, surface clear recommendations on the decision points in §7, and
produce a finished RESEARCH-013 document under SDD/research/ in the
same format as RESEARCH-010. Treat the candidate solutions in §4 as a
starting point, not a conclusion — actively look for options the brief
missed. Output a prioritized recommendation with at least two viable
bundle options scored against the constraints, and call out any
findings that should trigger an ADR.
```

Cross-cutting ADR candidates the research is likely to surface (flag for `agent-engineering:cross-cutting-adr`):

- **ADR:** OpenTelemetry as the instrumentation contract (or not).
- **ADR:** PII handling rule for telemetry payloads.
- **ADR:** SaaS vs. self-hosted defaults for observability backends.
