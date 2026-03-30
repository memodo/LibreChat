# Research Progress

## Current: RESEARCH-007-usage-and-chat-logging

### Research Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`

### Research Question
Does LibreChat offer any ability to log usage? To log chats?

### Key Findings

#### 1. Token/Usage Tracking — FULL
- Transaction-based system records every token spend per user/conversation/model
- Balance management with auto-refill, CLI tools for admin balance management
- Per-model pricing hardcoded in `packages/data-schemas/src/methods/tx.ts`
- Optimistic concurrency for balance updates (10 retries, exponential backoff)

#### 2. Chat/Conversation Storage — FULL
- All messages and conversations stored in MongoDB with full CRUD
- Strictly user-scoped — admins **cannot** view user chats
- MeiliSearch integration for full-text search (user-filtered)

#### 3. Chat Export — CLIENT-SIDE, 5 FORMATS
- PNG, TXT, Markdown, JSON, CSV
- Export happens in browser, no server-side bulk export
- Supports message branches and recursive tree structures

#### 4. Application Logging — Winston
- Daily rotation, error + debug file logs, JSON console option
- Env vars: `DEBUG_LOGGING`, `DEBUG_CONSOLE`, `CONSOLE_JSON`, `AGENT_DEBUG_LOGGING`

#### 5. External Observability — NOT IMPLEMENTED
- Langfuse env vars exist as placeholders, no integration code

#### 6. No Analytics Dashboard
- All data exists in MongoDB but no reporting UI or usage history API

### Gaps Identified
1. No usage analytics dashboard (trends, costs, top users)
2. No admin access to user conversations
3. No server-side bulk export
4. Langfuse integration not implemented
5. No auto-cleanup of expired temporary chats
6. Token pricing hardcoded (not configurable)
7. No usage history/breakdown for users (only current balance)

### Research Document
`SDD/research/RESEARCH-007-usage-and-chat-logging.md`

---

## Previous Research

### RESEARCH-006 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-006-microsoft-entra-sso-2026-03-30.md`
**Topic**: Microsoft Entra SSO via OpenID Connect

### RESEARCH-005 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-005-m365-mcp-integration-2026-03-26.md`
**Topic**: Microsoft 365 MCP integration

### RESEARCH-004 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-004-cassandra-2026-03-26.md`
**Topic**: Self-hosted Cassandra for Astra Assistants API

### RESEARCH-002 & RESEARCH-003 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-002-003-file-upload-research-2025-12-19.md`
**Topics**: File upload alternatives, Astra Assistants API overview

### RESEARCH-001 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-001-agent-workflow-api-2025-11-19.md`
