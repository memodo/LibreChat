# Architecture Decision Records

Cross-cutting architectural decisions for this system. Each ADR captures a choice that binds future work.

## Conventions

- ADRs are numbered sequentially (0001, 0002, ...).
- Status lifecycle: **Accepted** → **Deprecated** (no longer followed but not replaced) or **Superseded** (replaced by a newer ADR).
- Superseded ADRs remain in this directory with updated status and a reference to the superseding ADR. They are never deleted.

## Index

| # | Title | Status | Date | Topic |
|---|-------|--------|------|-------|
| [0001](0001-mcp-byot-over-librechat-resolved-obo.md) | Authenticate Entra-delegated MCP servers via LibreChat-resolved BYOT over OBO | Superseded by 0004 | 2026-05-18 | auth |
| [0002](0002-readonly-default-delegated-graph-scopes.md) | Default to read-only delegated Graph scopes for new MCP integrations | Accepted | 2026-05-18 | security |
| [0003](0003-watchdog-outside-alertmanager-pipeline.md) | Run the monitoring watchdog outside the Prometheus/Alertmanager pipeline | Accepted | 2026-05-20 | observability |
| [0004](0004-mcp-native-obo-over-handrolled-byot.md) | Authenticate Entra-delegated MCP servers via LibreChat-native OBO config | Accepted | 2026-06-24 | auth |
