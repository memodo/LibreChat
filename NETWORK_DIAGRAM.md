# Network and Service Diagram

## Overview

This document describes the network topology and service interactions between LibreChat, the TA Research Agent, and the Caddy reverse proxy infrastructure.

## Network Topology

```
                                    INTERNET
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │              CADDY                     │
                    │         (Reverse Proxy)                │
                    │                                        │
                    │  chat.memodo-eng.de ──────► :3080      │
                    │  ta-agent.memodo-eng.de ──► :8000      │
                    │  proc.memodo-eng.de ──────► :80        │
                    │  memodo-eng.de ───────────► file_server│
                    └───────────────────────────────────────┘
                                        │
                                        │ caddy_net (external network)
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
    ┌───────────────────────────┐       ┌───────────────────────────┐
    │        LibreChat          │       │    TA Research Agent      │
    │    (container: LibreChat) │       │  (service: ta-agent-api)  │
    │         :3080             │──────►│         :8000             │
    │                           │       │                           │
    │  Networks:                │       │  Networks:                │
    │   - default (librechat)   │       │   - default (news-agent)  │
    │   - caddy_net             │       │   - caddy_net             │
    └───────────────────────────┘       └───────────────────────────┘
                    │
                    │ default (librechat network)
    ┌───────────────┼───────────────┬───────────────┐
    │               │               │               │
    ▼               ▼               ▼               ▼
┌────────┐   ┌────────────┐   ┌──────────┐   ┌──────────┐
│MongoDB │   │MeiliSearch │   │ RAG API  │   │ VectorDB │
│ :27017 │   │   :7700    │   │  :8000   │   │  :5432   │
└────────┘   └────────────┘   └──────────┘   └──────────┘
```

## Service Details

### Caddy (Reverse Proxy)
- **Location:** `/Users/pablooliva/Dev/infra/simple-auth/`
- **Network:** `caddy_net` (external)
- **Purpose:** TLS termination, routing, basic auth for some routes

| Domain | Target | Auth |
|--------|--------|------|
| `chat.memodo-eng.de` | `LibreChat:3080` | None |
| `ta-agent.memodo-eng.de` | `ta-agent-api:8000` | None |
| `proc.memodo-eng.de` | `jira-process:80` | Basic Auth |
| `memodo-eng.de` | File server | Basic Auth |

### LibreChat
- **Location:** `/Users/pablooliva/Dev/AI dev/LibreChat/`
- **Container Name:** `LibreChat`
- **Port:** 3080
- **Networks:** `default`, `caddy_net`

**Internal Connections:**
- MongoDB (`mongodb:27017`)
- MeiliSearch (`meilisearch:7700`)
- RAG API (`rag_api:8000`)

**External Connections (via caddy_net):**
- TA Research Agent (`ta-agent-api:8000/v1`)

**Configuration:** `librechat.yaml`
```yaml
- name: "TA Research Agent"
  baseURL: "http://ta-agent-api:8000/v1"
```

### TA Research Agent
- **Location:** `/Users/pablooliva/Dev/AI dev/news agent/`
- **Service Name:** `ta-agent-api`
- **Port:** 8000
- **Networks:** `default`, `caddy_net`
- **Purpose:** Multi-stage news analysis pipeline

## Data Flow

### External User Request to TA Research Agent (Direct)
```
User ──► ta-agent.memodo-eng.de ──► Caddy ──► ta-agent-api:8000
```

### External User Request via LibreChat
```
User ──► chat.memodo-eng.de ──► Caddy ──► LibreChat:3080
                                              │
                                              ▼ (via caddy_net)
                                         ta-agent-api:8000
```

### Internal LibreChat to TA Research Agent
```
LibreChat ──────────────────────────► ta-agent-api:8000
            (direct via caddy_net)
```

## Docker Networks

| Network | Type | Services |
|---------|------|----------|
| `caddy_net` | External | Caddy, LibreChat, TA Research Agent |
| `librechat_default` | Bridge | LibreChat, MongoDB, MeiliSearch, RAG API, VectorDB |
| `news-agent_default` | Bridge | TA Research Agent |

## Key Configuration Files

| Service | File | Purpose |
|---------|------|---------|
| Caddy | `Caddyfile` | Reverse proxy routing rules |
| LibreChat | `docker-compose.yml` | Base service definitions |
| LibreChat | `docker-compose.override.yml` | Network and volume overrides |
| LibreChat | `librechat.yaml` | Endpoint configurations |
| TA Research Agent | `docker-compose.yml` | Service definition |
