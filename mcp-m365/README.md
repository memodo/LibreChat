# mcp-m365 — Microsoft 365 MCP Sidecar

Containerized Model Context Protocol server that bridges LibreChat to
Microsoft 365 (Outlook mail, Calendar, OneDrive, Excel, OneNote, To Do,
Planner, Contacts, Graph search) using the open-source
[`@softeria/ms-365-mcp-server`](https://www.npmjs.com/package/@softeria/ms-365-mcp-server)
package.

The sidecar follows a **Bring-Your-Own-Token (BYOT)** trust boundary: the
LibreChat API holds the user's Graph access token and injects it on every
`tools/call` via an `Authorization: Bearer <token>` header. The sidecar
itself never stores Entra credentials, refresh tokens, or any per-user
state. See SPEC-014 §SEC-001..008.

## Where this lives

| Path | Purpose |
|---|---|
| `Dockerfile` | Pinned Node base + Softeria install with tarball SHA-256 verification |
| `VERSION` | Resolved Softeria semver (matches Dockerfile `ARG SOFTERIA_VERSION`) |
| `serverinstructions.sha256` | SHA-256 of the `serverInstructions` body in `librechat.yaml` (drift guard) |
| `test-fixtures.md` | PII canary fixtures (test mailbox + seeded synthetic IBAN payloads) |
| `tool-projection.md` | Per-tool `$select` projection record (data minimization) |

Spec: `SDD/requirements/SPEC-014-m365-mcp-integration.md`.
Research: `SDD/research/RESEARCH-005-microsoft-365-mcp-integration.md`.

## Pinned values

| Field | Value | Notes |
|---|---|---|
| Node base | `node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920` | Resolved 2026-05-18; PR re-resolves at merge time |
| Softeria semver | `1.0.0` (placeholder) | Resolved via `npm view @softeria/ms-365-mcp-server@latest version` |
| Softeria tarball SHA-256 | `0000…0000` (placeholder) | Verified against `npm pack` output at merge time |
| MCP protocol version | `2024-11-05` (placeholder) | Last known stable per RESEARCH-005 |
| Listener | `:3000` (container-internal) | No host port published |

All placeholders are TBD-by-final-PR. See SPEC-014 §OD-1 (Release Gate).

## Build

The sidecar is built as part of the standard prod deploy:

```bash
./prod.sh build mcp-m365
```

For local dev iteration:

```bash
docker compose build mcp-m365
docker compose up -d mcp-m365
```

The image is **not** published to a registry — it is built per-host. Source
of truth for image content is this directory + the pinned package digest.

## Verify (smoke)

Per SPEC-014 Verification §1-3:

```bash
# 1) Container is up and healthy.
docker inspect --format '{{.State.Health.Status}}' mcp-m365   # expect: healthy

# 2) /mcp endpoint responds with a sensible HTTP status to GET (no body
#    semantics — we only check it doesn't 500 or refuse).
docker exec mcp-m365 wget --server-response --spider \
  --tries=1 --timeout=5 http://localhost:3000/mcp 2>&1 | head -5

# 3) From the api container, the sidecar resolves and accepts the MCP handshake.
docker exec api curl -sS -X POST http://mcp-m365:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer placeholder-token-for-handshake' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'
```

A live `tools/list` and `tools/call` walk-through against the test account
fixture (`librechat-test@memodo.de`) lives in `test-fixtures.md`.

## Operational notes

- The healthcheck tolerates HTTP 400/405/406 in addition to 200 — Softeria's
  `/mcp` endpoint is a POST-only JSON-RPC surface, so a GET probe is
  expected to yield 4xx. See SPEC-014 REQ-018.
- `start_period: 90s` absorbs cold-start; `restart_policy.max_attempts: 5`
  bounds restart loops. See SPEC-014 REL-003.
- The container runs read-only with `cap_drop: ALL` and
  `no-new-privileges`. A `tmpfs` mount on `/tmp` provides scratch space the
  healthcheck needs for `wget --spider`.
- Resource limits: 256m memory / 0.5 CPU. See SPEC-014 REQ-026.
- No env-resident secrets. See SPEC-014 REQ-003 / SEC-001.

## Updating the Softeria pin

1. Resolve the new version + tarball integrity:
   ```bash
   npm view @softeria/ms-365-mcp-server@latest version dist.integrity
   ```
2. Run `npm pack @softeria/ms-365-mcp-server@<v>` locally and capture the
   sha256 of the resulting `.tgz`.
3. Update:
   - `mcp-m365/VERSION`
   - `mcp-m365/Dockerfile` (`ARG SOFTERIA_VERSION`, `ARG SOFTERIA_SHA256`)
   - `docker-compose.override.yml` and `docker-compose.prod.yml`
     (`build.args` for the same two values)
4. Re-run the verification chain in Verification §1-3.
5. Inspect the new tool surface — if Softeria added/removed/renamed any
   tool, update `tool-projection.md` and the `serverInstructions` body in
   `librechat.yaml`, then regenerate `serverinstructions.sha256`.

## Phase-2 expansion

Phase 1 is **read-only**. Phase-2 work (write tools, Teams/SharePoint admin)
requires:

- Entra app-registration scope expansion (separate change).
- `OPENID_GRAPH_SCOPES` expansion in `.env`.
- A new `serverInstructions` body that lifts the "read-only" assertion.
- Updated `tool-projection.md` rows.
- OD-6 closure refresh (new privacy notice, sub-processor confirmation).
