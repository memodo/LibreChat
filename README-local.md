# MemodoAI — Fork Notes

This is the MemodoAI fork of [LibreChat](https://github.com/danny-avila/LibreChat). We periodically merge upstream changes from `main`. This README covers everything specific to our fork — branches, documentation, helper scripts, and operational commands. The upstream `README.md` is left untouched.

## Branch Strategy

- **`pablo`** — Development branch. All feature branches merge here.
- **`memodo`** — Production branch. Promoted from `pablo` when ready to deploy.
- **`main`** — Upstream tracking. Used to pull in new LibreChat releases.

### After merging from upstream `main`

Verification is mostly automated via the Husky [`post-merge`](.husky/post-merge) hook, which fires on every `git merge` / `git pull` and runs four phases:

1. **Static structural checks** ([`scripts/pii-merge-verify.sh`](scripts/pii-merge-verify.sh)) — grep assertions covering PII middleware ordering, registry exports, SSE warning handling, admin endpoints, and owned files.
2. **Unit + integration tests** — `detectPII` and `pii-middleware-chain` Jest suites.
3. **PII e2e** — Playwright `pii-detection.spec.ts` (skipped if `redakt` isn't running).
4. **Post-merge e2e** — admin dashboard, auth, routes, package integrity (skipped if LibreChat isn't running).

The e2e phases skip gracefully when their prerequisites are missing, so a quick `git pull` without the stack up will still run phases 1–2.

If you merged without the hook firing (e.g. it was bypassed, or the stack was down), re-run on demand:

```sh
sh scripts/pii-merge-verify.sh   # fast static checks only, no build/test
sh .husky/post-merge             # full hook, all four phases
```

See [`docs/pii-merge-checklist.md`](docs/pii-merge-checklist.md) for the full reference, including conflict-resolution guidance for sections the hook can't automate (rebuild + restart, manual smoke test).

---

## Documentation Map

### Architecture & Deployment

| Doc | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full production architecture: stacks, network topology, services, reverse proxy, observability, security, backups |
| [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md) | Step-by-step greenfield deployment checklist for the Hetzner production host |
| [`docs/system-behavior.md`](docs/system-behavior.md) | High-level system behaviors and conventions |
| [`docs/features.md`](docs/features.md) | Feature catalog (chat-with-documents options, RAG vs. native upload, etc.) |
| [`docs/rag-api-setup.md`](docs/rag-api-setup.md) | RAG API setup and Azure embedding configuration |
| [`docs/pii-merge-checklist.md`](docs/pii-merge-checklist.md) | Run after every merge from upstream `main` |

### Runbooks (`docs/runbooks/`)

Operational procedures for the production stack.

| Runbook | When to use |
|---|---|
| [`backup-restore.md`](docs/runbooks/backup-restore.md) | Restore MongoDB / Postgres / MinIO from backups |
| [`disaster-recovery.md`](docs/runbooks/disaster-recovery.md) | Full host recovery |
| [`gdpr-erasure.md`](docs/runbooks/gdpr-erasure.md) | Run the user-erasure procedure (data subject requests) |
| [`log-escalation.md`](docs/runbooks/log-escalation.md) | Triaging alerts and escalating from logs |
| [`pii-override.md`](docs/runbooks/pii-override.md) | When/how to override PII detection blocks |
| [`secret-rotation.md`](docs/runbooks/secret-rotation.md) | Rotate keys and credentials |
| [`service-restart.md`](docs/runbooks/service-restart.md) | Restart individual services safely |

### SDD — Spec-Driven Development (`SDD/`)

Each significant initiative goes through Research → Spec → Review → Implementation prompts. See:

- [`SDD/research/`](SDD/research/) — Research docs (`RESEARCH-001`…`RESEARCH-012`)
- [`SDD/requirements/`](SDD/requirements/) — Specs (`SPEC-001`, `SPEC-008`, `SPEC-009`, `SPEC-010`, `SPEC-012`)
- [`SDD/reviews/`](SDD/reviews/) — Critical reviews of research/spec/impl
- [`SDD/prompts/`](SDD/prompts/) — Implementation prompts kicked off from specs
- [`SDD/LIBRECHAT_INTEGRATION_SUMMARY.md`](SDD/LIBRECHAT_INTEGRATION_SUMMARY.md), [`SDD/ACS.md`](SDD/ACS.md)

### Project-level guides

- [`CLAUDE.md`](CLAUDE.md) — Workspace boundaries, code style, testing philosophy (read this before opening a PR)
- [`AGENTS.md`](AGENTS.md) — Pointer for Claude Code / agentic tooling

---

## Repository Layout

Beyond the standard upstream LibreChat workspaces (`api/`, `client/`, `packages/*`), our fork-specific directories are:

| Path | Purpose |
|---|---|
| `docs/` | Fork-specific docs, runbooks, deployment checklist |
| `SDD/` | Spec-driven development artifacts |
| `monitoring/` | Prometheus, Grafana, Alertmanager, exporters, cAdvisor compose stack |
| `scripts/` | Backup, GDPR erasure, monitoring watchdog, mongodb auth migration |
| `e2e/` | Playwright end-to-end tests (post-merge config in `e2e/post-merge.playwright.config.ts`, PII config in `e2e/pii.playwright.config.ts`) |
| `mongo-init/` | MongoDB initialization scripts (creates app users on first boot) |
| `redis-config/` | Redis config files |
| `searxng/` | SearxNG config |
| `helm/` | Helm charts (upstream — untouched) |

Top-level fork files worth knowing:

| File | Purpose |
|---|---|
| `docker-compose.yml` | Base service definitions |
| `docker-compose.override.yml` | Dev overrides — networks, MinIO, librechat.yaml mount, package bind mounts |
| `docker-compose.prod.yml` | Production overrides — pre-built images, health checks, resource limits |
| `librechat.yaml` | Active LibreChat config (commit-safe) |
| `.env.prod.template` | Template for `.env.prod`; the real `.env.prod` is git-ignored |
| `crontab.prod` | Cron schedule installed on the prod host (backups, watchdog) |

---

## Key Commands

### Helper scripts

| Script | What it does |
|---|---|
| `./prod.sh <args>` | Wraps `docker compose` with the correct file merge order (`docker-compose.yml` + `override.yml` + `prod.yml`) and `--env-file .env.prod`. Examples: `./prod.sh up -d`, `./prod.sh logs -f api`, `./prod.sh restart api` |
| `./prod-mon.sh <args>` | Same wrapper but for the monitoring stack (`monitoring/docker-compose.monitoring.yml`). Run `./prod-mon.sh up -d` after the app stack is up |
| `./prod-sync.sh` | rsync locally-built `packages/*/dist`, `client/dist`, and `api/server` to the production host, then restart the api container. Supports `--dry-run` and `--no-restart` |
| `./rebuild-frontend.sh` | Stop containers → `npm install` → build frontend → restart containers. Use after editing `client/src/` |
| `scp "/Users/pablooliva/Dev/AI dev/LibreChat/.env.prod" Hetzner-personal:/opt/docker/librechat/.env.prod` | Push .env.prod |

### User management (Docker)

```bash
docker exec -it LibreChat npm run reset-password <email>
docker exec -it LibreChat npm run list-users
```

To enable signup, set `ALLOW_REGISTRATION=true` in `.env` and restart. Users can then sign up via the UI, or you can register via the API:

```bash
curl -X POST http://localhost:3080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "User Name",
    "username": "username",
    "email": "user@example.com",
    "password": "securepassword",
    "confirm_password": "securepassword"
  }'
```

This uses LibreChat's own registration logic so passwords are hashed correctly.

### Backups & operational scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `backup-mongodb.sh`, `backup-postgres.sh`, `backup-minio.sh` | Per-service local backups |
| `backup-offhost.sh` | Push local backups off-host |
| `backup-config.sh` | Snapshot config files |
| `gdpr-erase-user.sh` | GDPR erasure for a user (see [`docs/runbooks/gdpr-erasure.md`](docs/runbooks/gdpr-erasure.md)) |
| `monitoring-watchdog.sh` | Cron-driven watchdog that nudges Alertmanager / restarts exporters |
| `mongodb-auth-migration.sh` | One-off helper for migrating MongoDB to authenticated mode |

These are installed on the prod host via `crontab.prod`.

---

## Docker Networking

When LibreChat runs in Docker and needs to connect to a service on the host (e.g., a local API server), use `host.docker.internal` instead of `localhost`:

```yaml
# In librechat.yaml
baseURL: "http://host.docker.internal:8000"  # NOT localhost:8000
```

`localhost` inside a container refers to the container itself, not the host machine.

For cross-stack traffic in production, services share the external `caddy_net` network (created by the infra repo at `/Users/pablooliva/Dev/infra/simple-auth/`). See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full topology.

---

## Building and Deploying Local Fixes

When using the pre-built upstream Docker image (`ghcr.io/danny-avila/librechat-dev:latest`), local code fixes are applied by building packages locally and bind-mounting them into the container.

### Build packages

```bash
npm install                    # if lockfile changed
npm run build:packages         # all packages, correct dependency order
```

To build a single package (must build dependencies first):

```bash
npm run build:data-provider    # no dependencies
npm run build:data-schemas     # no dependencies
npm run build:api              # depends on data-provider, data-schemas
npm run build:client-package   # depends on data-provider
```

### Mount your build into the container

`docker-compose.override.yml` already wires the bind mounts. Available targets:

| Package | Source | Target |
|---|---|---|
| `@librechat/api` | `./packages/api/dist` | `/app/node_modules/@librechat/api/dist` |
| `@librechat/data-schemas` | `./packages/data-schemas/dist` | `/app/node_modules/@librechat/data-schemas/dist` |
| `librechat-data-provider` | `./packages/data-provider/dist` | `/app/node_modules/librechat-data-provider/dist` |

### Deploy to the production server

```bash
npm run build           # full Turborepo build
./prod-sync.sh          # rsync dist dirs, restart api on the prod host
```

`prod-sync.sh` checks that all expected `dist/` dirs exist locally before transferring, and restarts the api container on the remote unless `--no-restart` is passed.

### S3 / MinIO path-style addressing

LibreChat's S3 client supports path-style addressing via the `AWS_FORCE_PATH_STYLE` env var (read in `packages/api/src/storage/s3/crud.ts`). Set it when using MinIO or any S3-compatible endpoint that does not host buckets as DNS subdomains:

```
AWS_ENDPOINT_URL=https://minio.example.com
AWS_FORCE_PATH_STYLE=true
```

Without it, the AWS SDK defaults to virtual-hosted-style URLs (`https://<bucket>.minio.example.com/...`), which fail in two distinct ways:

- **Local / internal endpoint** (e.g. `http://minio:9000`) — DNS lookup for `<bucket>.minio` fails: `ENOTFOUND bucket.endpoint`.
- **Public endpoint behind a reverse proxy** (e.g. `https://minio.example.com` via Caddy) — TLS handshake aborts with `SSL alert number 80` because the proxy has no site block / cert for `*.minio.example.com`.

After changing `.env` / `.env.prod`, restart the api container only — no rebuild needed.

---

## File Upload Support

### Direct upload (Upload to Provider)

Files are sent directly to Azure OpenAI. The model reads the full document content within the conversation context window. Supported types:

- Images (PNG, JPG, etc.)
- PDFs

### File Search upload (RAG API)

When uploading via **"Upload File Search"** in the attachment menu, files are chunked, embedded into the vector database via the RAG API, and retrieved via semantic search. Required for any document type beyond images and PDFs.

Supported types:

| Format | Extensions |
|---|---|
| PDF | `.pdf` |
| Word | `.doc`, `.docx` |
| Excel | `.xls`, `.xlsx` |
| PowerPoint | `.ppt`, `.pptx` |
| Plain text | `.txt` |
| Markdown | `.md` |
| CSV | `.csv` |
| HTML | `.html` |
| XML | `.xml` |
| JSON | `.json` |
| WebVTT | `.vtt` |
| ePub | `.epub` |
| reStructuredText | `.rst` |

Click the attachment icon in the chat input and select **"Upload File Search"** (the option with the search icon) instead of the regular upload option.

### PDFs: direct vs. File Search

PDFs work with both methods. The difference is how content reaches the model:

- **Direct (Upload to Provider):** the full PDF is sent to Azure OpenAI and consumed within the conversation context window. Simpler, but large PDFs use a lot of token budget. Content lives only in that conversation.
- **File Search (RAG API):** the PDF is chunked and embedded. When you ask a question, only the most relevant snippets are retrieved — not the whole document. More token-efficient for large documents. Citations show which parts were used. For Agents, the document persists as a searchable knowledge base across conversations.

**Rule of thumb:** direct upload for small PDFs and quick questions; File Search for large PDFs, specific lookups, or when building an Agent knowledge base.

See [`docs/features.md`](docs/features.md) and [`docs/rag-api-setup.md`](docs/rag-api-setup.md) for the full picture.
