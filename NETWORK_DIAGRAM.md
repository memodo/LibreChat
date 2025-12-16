# Network and Service Diagram

## Overview

This document describes the network topology and service interactions between LibreChat, the TA Research Agent, MinIO, and the Caddy reverse proxy infrastructure.

## Network Topology

```
                                      INTERNET
                                          │
                                          ▼
                      ┌─────────────────────────────────────────┐
                      │                CADDY                    │
                      │           (Reverse Proxy)               │
                      │                                         │
                      │  chat.memodo-eng.de ───────► :3080      │
                      │  ta-agent.memodo-eng.de ───► :8000      │
                      │  minio.memodo-eng.de ──────► :9001      │
                      │  proc.memodo-eng.de ───────► :80        │
                      │  memodo-eng.de ────────────► file_server│
                      └─────────────────────────────────────────┘
                                          │
                                          │ caddy_net (external network)
                      ┌───────────────────┼───────────────────┐
                      │                   │                   │
                      ▼                   ▼                   ▼
  ┌───────────────────────────┐  ┌──────────────┐  ┌───────────────────────────┐
  │        LibreChat          │  │    MinIO     │  │    TA Research Agent      │
  │    (container: LibreChat) │  │  (S3 Store)  │  │  (service: ta-agent-api)  │
  │         :3080             │  │ :9000 :9001  │  │         :8000             │
  │                           │  │              │  │                           │
  │  Networks:                │  │  Networks:   │  │  Networks:                │
  │   - default (librechat)   │  │   - default  │  │   - default (news-agent)  │
  │   - caddy_net             │  │   - caddy_net│  │   - caddy_net             │
  └───────────────────────────┘  └──────────────┘  └───────────────────────────┘
              │                         ▲
              │    File Storage (S3)    │
              └─────────────────────────┘
              │
              │ default (librechat network)
  ┌───────────┼───────────┬───────────────┬───────────────┐
  │           │           │               │               │
  ▼           ▼           ▼               ▼               ▼
┌────────┐ ┌──────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐
│MongoDB │ │MinIO │ │MeiliSearch │ │ RAG API  │ │ VectorDB │
│ :27017 │ │:9000 │ │   :7700    │ │  :8000   │ │  :5432   │
└────────┘ └──────┘ └────────────┘ └──────────┘ └──────────┘
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
| `minio.memodo-eng.de` | `minio:9001` (Console) | None |
| `proc.memodo-eng.de` | `jira-process:80` | Basic Auth |
| `memodo-eng.de` | File server | Basic Auth |

### LibreChat
- **Location:** `/Users/pablooliva/Dev/AI dev/LibreChat/`
- **Container Name:** `LibreChat`
- **Port:** 3080
- **Networks:** `default`, `caddy_net`
- **File Storage:** MinIO (S3-compatible)

**Internal Connections:**
- MongoDB (`mongodb:27017`)
- MeiliSearch (`meilisearch:7700`)
- RAG API (`rag_api:8000`)
- MinIO (`minio:9000`) - S3 file storage

**External Connections (via caddy_net):**
- TA Research Agent (`ta-agent-api:8000/v1`)

**Configuration:** `librechat.yaml`
```yaml
fileStrategy: "s3"

- name: "TA Research Agent"
  baseURL: "http://ta-agent-api:8000/v1"
```

### MinIO (S3-Compatible Storage)
- **Container Name:** `minio`
- **Ports:**
  - `9000` - S3 API
  - `9001` - Web Console
- **Networks:** `default`, `caddy_net`
- **Purpose:** File storage for LibreChat (uploads, images, etc.)
- **Bucket:** `librechat` (created by minio-init container)
- **Console URL:** `https://minio.memodo-eng.de`

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

### File Upload Flow
```
User ──► chat.memodo-eng.de ──► Caddy ──► LibreChat:3080
                                              │
                                              ▼ (S3 API via default network)
                                          minio:9000
```

### MinIO Console Access
```
Admin ──► minio.memodo-eng.de ──► Caddy ──► minio:9001
```

## Docker Networks

| Network | Type | Services |
|---------|------|----------|
| `caddy_net` | External | Caddy, LibreChat, MinIO, TA Research Agent |
| `librechat_default` | Bridge | LibreChat, MongoDB, MeiliSearch, RAG API, VectorDB, MinIO |
| `news-agent_default` | Bridge | TA Research Agent |

## Key Configuration Files

| Service | File | Purpose |
|---------|------|---------|
| Caddy | `Caddyfile` | Reverse proxy routing rules |
| LibreChat | `docker-compose.yml` | Base service definitions |
| LibreChat | `docker-compose.override.yml` | Network, MinIO, and volume overrides |
| LibreChat | `librechat.yaml` | Endpoint and file storage configurations |
| LibreChat | `.env` | MinIO credentials (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`) |
| TA Research Agent | `docker-compose.yml` | Service definition |
