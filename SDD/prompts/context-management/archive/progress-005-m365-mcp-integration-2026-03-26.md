# Research Progress

## Current: RESEARCH-005-m365-mcp-integration

### Research Phase Summary
**Date**: 2026-03-26
**Status**: COMPLETE
**Branch**: `feature/m365-mcp-integration`

### Research Question
How can LibreChat be connected to the Microsoft 365 environment (OneDrive, Outlook, Teams, SharePoint, Calendar) via MCP servers?

### Key Findings

#### 1. LibreChat Already Has M365 Infrastructure
- **SharePoint file picker** — built-in but needs env var config (`ENABLE_SHAREPOINT_FILEPICKER`)
- **Graph token exchange** — `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder system with OBO flow (`packages/api/src/utils/graph.ts`)
- **MCP OAuth support** — full OAuth handling with auto-discovery, PKCE, token refresh

#### 2. Best MCP Server Options

| Option | Tools | Transport | Maturity | Recommendation |
|--------|-------|-----------|----------|----------------|
| **Softeria ms-365-mcp-server** | 70+ | stdio + HTTP | High (566★) | **Primary pick** |
| **Microsoft Official** | ~20-30 | Remote HTTP | High (GA) | Secondary/complement |
| **Lokka** | 3 (meta) | stdio only | Medium | Generic Graph caller |
| **hvkshetry** | 24 | stdio + SSE | Low | Not production-ready |

#### 3. Authentication Architecture
- **Best fit:** LibreChat's OBO token exchange → `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` → MCP server
- Requires Azure AD app registration with delegated Graph permissions
- Per-user auth via OpenID Connect login

#### 4. Recommended Phased Approach
1. **Phase 1:** Enable existing SharePoint file picker (config-only)
2. **Phase 2:** Deploy Softeria MCP server, configure in `librechat.yaml`, use Graph token placeholder
3. **Phase 3:** Evaluate Microsoft official MCP servers as complement

### Decision Points Before Implementation
1. Which MCP server(s) to deploy?
2. Transport type — stdio (same-host) vs HTTP (containerized)?
3. Auth model — OBO placeholder vs MCP-managed OAuth vs app-only?
4. Read-only vs read-write Graph permissions?
5. Deployment model — sidecar container vs separate service vs stdio?

### Research Document
`SDD/research/RESEARCH-005-m365-mcp-integration.md`

### Sources Referenced
- [Softeria ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server)
- [Microsoft Official MCP Catalog](https://github.com/microsoft/mcp)
- [Microsoft MCP Server for Enterprise](https://learn.microsoft.com/en-us/graph/mcp-server/overview)
- [LibreChat MCP Docs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- LibreChat codebase: `packages/api/src/mcp/`, `packages/api/src/utils/graph.ts`

---

## Previous Research

### RESEARCH-004 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-004-cassandra-2026-03-26.md`
**Topic**: Self-hosted Cassandra for Astra Assistants API

### RESEARCH-002 & RESEARCH-003 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-002-003-file-upload-research-2025-12-19.md`
**Topics**: File upload alternatives, Astra Assistants API overview

### RESEARCH-001 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-001-agent-workflow-api-2025-11-19.md`
