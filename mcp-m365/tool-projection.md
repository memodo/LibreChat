# Per-Tool `$select` Projection — M365 MCP Sidecar

Backs SPEC-014 §Privacy & Compliance Scope (data-minimization at the tool
boundary). For each Softeria tool surface, this file records whether the
tool supports a Graph `$select` projection and, if so, the minimal field set
the implementation actually requests.

Honoring `$select` at the tool boundary means the sidecar never pulls more
PII into LibreChat than the tool's stated purpose requires.

## Phase 1 status

All entries are TBD. The implementation PR (Subagent 3) inspects each tool
the sidecar exposes, runs it once against the test account, and records
behavior here.

| Tool surface | Honors `$select`? | Minimal projection | Notes |
|---|---|---|---|
| `mail.list` | TBD | TBD | Subject, from, receivedDateTime, bodyPreview only? |
| `mail.read` | TBD | TBD | Full body required for chat surfacing |
| `mail.search` | TBD | TBD | |
| `calendar.list` | TBD | TBD | subject, organizer, start, end, location |
| `calendar.read` | TBD | TBD | |
| `files.list` | TBD | TBD | name, lastModifiedDateTime, size, webUrl |
| `files.read` | TBD | TBD | Content surfacing — projection N/A |
| `files.search` | TBD | TBD | |
| `excel.read` | TBD | TBD | |
| `onenote.list` | TBD | TBD | |
| `onenote.read` | TBD | TBD | |
| `todo.list` | TBD | TBD | |
| `planner.list` | TBD | TBD | |
| `contacts.list` | TBD | TBD | displayName, emailAddresses, businessPhones |
| `contacts.search` | TBD | TBD | |
| `search.query` | TBD | TBD | Graph search — projection negotiable per resource |

## Recording behavior

For each tool, the implementation PR records:

1. **Honors `$select`?** — YES / NO / PARTIAL (some fields ignored).
2. **Minimal projection** — the comma-separated field list passed.
3. **Notes** — any field the tool always returns even when omitted from
   `$select` (Graph behavior); any field LibreChat strips post-fetch.

## Phase-2 review

When phase-2 scope expansion lands (write tools, Teams, SharePoint admin),
this table extends with one row per new tool surface and is re-reviewed by
the DPO-equivalent prior to release.
