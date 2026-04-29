# Production Deployment Checklist — SPEC-010

**Purpose:** Step-by-step guide to deploy all SPEC-010 production readiness changes to the MemodoAI LibreChat server. Work through each phase in order. Check off each item as you complete it.

**Time estimate:** Phase 1 takes the most effort (1-2 hours of focused work). Phases 2-5 are faster.

**Where to run commands:** All commands run on the production server unless otherwise noted. The project is assumed to be at `/opt/docker/librechat` — adjust paths if your deployment location differs.

> **Scope: greenfield deployments.** This checklist assumes a fresh server with
> no existing LibreChat stack, no Mongo data, no `pgdata2` volume, and no
> backup crontab. Procedures for migrating an existing instance — credential
> rotation in-place, MongoDB auth migration on a populated DB, data
> preservation across re-deployment — are out of scope here.
> `scripts/mongodb-auth-migration.sh` is the starting point if that situation
> ever arises; build a separate runbook at that time.

---

## Pre-Flight (Before Starting Any Phase)

- [ ] **SSH into the production server**

- [ ] **Verify you're on the correct branch and up to date:**
  ```bash
  cd /opt/docker/librechat
  git status
  git pull origin feature/production-ready
  ```

- [ ] **Verify Docker Compose version** (must be v2.20+ for `deploy.resources` support):
  ```bash
  docker compose version
  ```

- [ ] **Verify NTP is active** (EDGE-014 — prevents clock drift affecting backup retention):
  ```bash
  timedatectl status
  # Look for: "NTP synchronized: yes" or "System clock synchronized: yes"
  # If not synchronized:
  sudo timedatectl set-ntp true
  ```

- [ ] **Confirm greenfield assumptions** (no leftover state from a prior deploy):
  ```bash
  docker volume ls | grep -E '(pgdata2|mongo)' && echo "WARNING: existing volume — see scope note above" || echo "OK: no LibreChat volumes"
  ls -la data-node/ 2>/dev/null && echo "WARNING: data-node/ exists — Mongo init will be SKIPPED" || echo "OK: no data-node/"
  ```
  If either prints WARNING, stop and decide whether to wipe (greenfield) or switch to a migration runbook.

---

## Phase 1: Security Hardening

### Step 1.1: Create .env.prod from template

- [ ] Copy the template:
  ```bash
  cp .env.prod.template .env.prod
  ```

- [ ] **Generate all secrets.** Run each command below, then paste the output into `.env.prod` at the corresponding line:

  ```bash
  # JWT_SECRET (paste into .env.prod)
  echo "JWT_SECRET=$(openssl rand -hex 32)"

  # JWT_REFRESH_SECRET
  echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"

  # CREDS_KEY (32-byte hex)
  echo "CREDS_KEY=$(openssl rand -hex 32)"

  # CREDS_IV (16-byte hex — note: 16, not 32)
  echo "CREDS_IV=$(openssl rand -hex 16)"

  # MEILI_MASTER_KEY
  echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)"

  # MongoDB admin password
  echo "MONGO_ADMIN_PASSWORD=$(openssl rand -hex 32)"

  # MongoDB application password (for LibreChat user — will be created in Step 1.3)
  echo "LIBRECHAT_MONGO_PASSWORD=$(openssl rand -hex 32)"

  # PostgreSQL password
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"

  # MinIO password
  echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 32)"

  # Grafana admin password
  echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)"
  ```

- [ ] **Edit `.env.prod`** and fill in ALL placeholder values:
  - Replace every `<generate-with-openssl-...>` with the values you generated above
  - Set `LIBRECHAT_MONGO_USER=librechat` (already the template default — leave as-is)
  - Set `LIBRECHAT_MONGO_PASSWORD` to the value generated above
  - Set `MONGO_URI` using the *same* user and password (the migration script verifies this match):
    ```
    MONGO_URI=mongodb://librechat:<LIBRECHAT_MONGO_PASSWORD>@mongodb:27017/LibreChat?authSource=LibreChat
    ```
    (Replace `<LIBRECHAT_MONGO_PASSWORD>` with the actual value you generated)
  - Copy your Azure OpenAI API key from `.env`:
    ```bash
    grep AZURE_OPENAI_API_KEY_SWEDEN .env
    # Paste the value into .env.prod
    ```
  - Copy your Serper and Research Agent API keys:
    ```bash
    grep SERPER_API_KEY .env
    grep RESEARCH_AGENT_API_KEY .env
    ```
  - Set `MONGO_EXPORTER_URI` (uses the admin password):
    ```
    MONGO_EXPORTER_URI=mongodb://admin:<MONGO_ADMIN_PASSWORD>@mongodb:27017
    ```
  - **Set the production domain** (used for OAuth callbacks, email links, and CORS):
    ```
    DOMAIN_CLIENT=https://chat.memodo-eng.de
    DOMAIN_SERVER=https://chat.memodo-eng.de
    ```
    Wrong values here cause broken password-reset emails and OAuth flows.
  - **Disable unverified-email login** (REQ-012). Pairs with `librechat.yaml`'s `registration.allowedDomains` so an attacker can't claim `attacker@memodo.de` without proving they own it:
    ```
    ALLOW_UNVERIFIED_EMAIL_LOGIN=false
    ```
  - **Confirm registration is disabled** (`ALLOW_REGISTRATION=false`). The first admin is created via the CLI in Step 1.8 (registration endpoint stays off). All future users will be added via SSO.

- [ ] **Verify .env.prod has no remaining placeholders:**
  ```bash
  grep '<' .env.prod
  # Should return nothing. If it shows lines, those still need real values.
  ```

- [ ] **Sanity-check critical values:**
  ```bash
  grep -E '^(DOMAIN_CLIENT|DOMAIN_SERVER|ALLOW_REGISTRATION|ALLOW_UNVERIFIED_EMAIL_LOGIN)=' .env.prod
  # Expected:
  #   DOMAIN_CLIENT=https://chat.memodo-eng.de
  #   DOMAIN_SERVER=https://chat.memodo-eng.de
  #   ALLOW_REGISTRATION=false
  #   ALLOW_UNVERIFIED_EMAIL_LOGIN=false
  ```

- [ ] **Verify .env.prod is NOT tracked by git:**
  ```bash
  git status .env.prod
  # Should show nothing (not tracked) or show as untracked. It must NOT be staged.
  ```

> **Do NOT add `UID=` or `GID=` lines to `.env.prod`.** They're bash readonly
> built-ins; the backup scripts (which do `set -a; source .env.prod`) will
> abort with `readonly variable` and never create their backup directories.
> `prod.sh` already exports `UID`/`GID` from the shell so docker compose's
> volume-permission interpolation still works without them being in the env
> file. If you invoke `docker compose` directly (without `prod.sh`) and see
> `The "UID" variable is not set` warnings, prepend them on the command line:
> `UID=$(id -u) GID=$(id -g) docker compose ...`.

### Step 1.2: Verify .gitignore coverage (REQ-017)

- [ ] Confirm `.env.prod` is ignored:
  ```bash
  git check-ignore .env.prod
  # Should print: .env.prod
  ```

### Step 1.3: MongoDB authentication setup (REQ-006)

User creation happens automatically on first startup. `docker-compose.prod.yml` plumbs `MONGO_ADMIN_USER`/`MONGO_ADMIN_PASSWORD` into the official mongo image's `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD`, which trigger root-user creation when `/data/db` is empty. `mongo-init/init-librechat-user.sh` runs in the same init phase to create the LibreChat application user.

- [ ] **Confirm `.env.prod` has the four required Mongo keys:**
  ```bash
  grep -E '^(MONGO_ADMIN_USER|MONGO_ADMIN_PASSWORD|LIBRECHAT_MONGO_USER|LIBRECHAT_MONGO_PASSWORD)=' .env.prod
  ```

- [ ] **Confirm the init script is present and executable:**
  ```bash
  ls -la mongo-init/init-librechat-user.sh
  # Should show -rwxr-xr-x
  ```

- [ ] **No further action.** User creation happens during Step 1.8 (`./prod.sh up -d`). Verify post-up via Step 1.8's MongoDB external-access check and the post-deployment validation block.

> For migrating an existing unauthenticated MongoDB instance, see `scripts/mongodb-auth-migration.sh` and write a dedicated runbook for that scenario.

### Step 1.4: PostgreSQL credentials (REQ-007)

User and database are auto-created on first startup. The official postgres image creates `POSTGRES_USER` and `POSTGRES_DB` with `POSTGRES_PASSWORD` when its data directory is empty. `docker-compose.prod.yml` lines 119-121 plumb these from `.env.prod` (`librechat_rag`/`librechat_rag`/<generated password>).

- [ ] **Confirm `.env.prod` has the three required Postgres keys:**
  ```bash
  grep -E '^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD)=' .env.prod
  ```

- [ ] **No further action.** User/db creation happens during Step 1.8.

### Step 1.5: Change MinIO credentials (REQ-008)

- [ ] MinIO reads credentials from environment variables on startup. The new credentials in `.env.prod` will take effect when you restart MinIO with `prod.sh`. No in-database password change is needed — MinIO uses env vars directly.

  **However**, if you've created additional MinIO users/policies via the console, those are stored separately and won't be affected.

### Step 1.6: Verify production librechat.yaml

`librechat.yaml` is a single, prod-safe file used in both dev and prod (no separate prod example to merge). Just verify the prod-required sections are present:

- [ ] **Confirm the four prod-required sections are configured:**
  ```bash
  # registration.allowedDomains (REQ-011) — restricts who can register
  grep -A3 '^registration:' librechat.yaml

  # balance.enabled (REQ-037) — per-user token limits
  grep -A6 '^balance:' librechat.yaml | grep -E 'enabled|autoRefillEnabled'
  # Both should show: true

  # rateLimits (REQ-036) — file upload and import rate limits
  grep -A8 '^rateLimits:' librechat.yaml

  # SSRF protection (REQ-052) — empty allowlists for actions and mcpSettings
  grep -A1 '^actions:' librechat.yaml
  grep -A1 '^mcpSettings:' librechat.yaml
  # Both should show: allowedDomains: []
  ```

  If anything is missing or set to `false` where prod expects `true`, edit `librechat.yaml` and commit the change. There is no separate prod template to keep in sync.

  **To raise dev token allowance without affecting prod cost control:** use the admin panel to top up specific dev accounts manually rather than changing `startBalance` in this file.

### Step 1.7: Configure host and cloud firewalls (REQ-016)

Two layers, configured before services come up:

1. **Hetzner Cloud Firewall** (network-level, sits in front of the VPS — Docker cannot bypass it). This is the authoritative inbound filter.
2. **UFW on the host** (defense in depth — protects against accidentally-exposed services and any traffic originating from inside the Hetzner network).

The end-to-end nmap test in Post-Deployment Validation is the final check.

#### Hetzner Cloud Firewall (primary)

The server hosts multiple services behind a shared Caddy reverse proxy (`chat.memodo-eng.de` for LibreChat, plus `redakt.memodo-eng.de`, `proc.memodo-eng.de`, `ta-agent.memodo-eng.de`, `minio.memodo-eng.de`, `minio-console.memodo-eng.de`). One Hetzner firewall covers all of them.

- [ ] **Inbound rules:**

  | Source IPs | Protocol | Port | Description |
  |---|---|---|---|
  | `0.0.0.0/0, ::/0` | ICMP | — | Diagnostics (ping/traceroute) |
  | `0.0.0.0/0, ::/0` | TCP | 80 | HTTP (Caddy — ACME HTTP-01 challenges, redirect to HTTPS) |
  | `0.0.0.0/0, ::/0` | TCP | 443 | HTTPS (Caddy) |
  | `0.0.0.0/0, ::/0` | UDP | 443 | HTTP/3 / QUIC (Caddy) |
  | `<your-home-or-vpn-IP>/32` | TCP | 22 | SSH — **restrict to specific IPs**, not `0.0.0.0/0` |

  No other inbound rules. The Caddy reverse proxy handles all subdomain routing internally; database/storage ports (27017, 5432, 9000, 7700) are not exposed.

- [ ] **Outbound rules** (whitelist mode — adding any outbound rules makes them restrictive):

  | Destination | Protocol | Port | Why |
  |---|---|---|---|
  | `0.0.0.0/0, ::/0` | TCP | 25 | SMTP (mail relay if used) |
  | `0.0.0.0/0, ::/0` | TCP | 465 | SMTPS (encrypted SMTP) |
  | `0.0.0.0/0, ::/0` | TCP | 80 | HTTP (apt updates, ACME validation) |
  | `0.0.0.0/0, ::/0` | TCP | 443 | HTTPS (Azure OpenAI, Serper, Let's Encrypt, Docker Hub, alerting webhooks, S3 backups) |
  | `0.0.0.0/0, ::/0` | UDP | 123 | NTP |

  **DNS note:** UDP 53 is NOT in the outbound whitelist, but DNS still works because `/etc/resolv.conf` points to `127.0.0.53` (systemd-resolved), which talks to Hetzner's nameservers over Hetzner's internal network — that path bypasses the cloud firewall. If you ever switch to public resolvers (8.8.8.8 etc.), add UDP 53 outbound.

  **Watch-outs depending on what you turn on later:**
  - **Off-host backup via rsync over SSH** needs **TCP 22 outbound** — not currently allowed. If `OFF_HOST_MODE=rsync` (Step 2.4), add it. S3 mode uses TCP 443 (already allowed).
  - **Modern SMTP submission (port 587)** is not in the rules. If your eventual mail relay needs 587 instead of 465, add it.

- [ ] **Verify the firewall is attached to the production VPS** in the Hetzner Cloud Console (Servers → your server → Firewalls tab — should show "Fully applied").

#### UFW on the host (defense in depth)

**Critical: allow SSH FIRST, before anything else.** Even though UFW commands don't take effect until `ufw enable`, allowing `22/tcp` first is a defensive habit that protects against partial-execution scenarios (interruption, typo, distraction).

- [ ] **Configure and enable UFW:**
  ```bash
  # 1. Allow SSH FIRST
  sudo ufw allow 22/tcp

  # 2. Default policies
  sudo ufw default deny incoming
  sudo ufw default allow outgoing

  # 3. HTTP/HTTPS for Caddy
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp

  # 4. Enable (will warn about disrupting SSH; answer y — 22 is already allowed)
  sudo ufw enable
  ```

- [ ] **Verify UFW is active with the right rules:**
  ```bash
  sudo ufw status verbose
  # Expect: Status: active; default deny (incoming), allow (outgoing); 22/80/443/tcp ALLOW IN
  ```
  No explicit DENY rules needed for 27017/5432/9000/7700 — `default deny incoming` covers them.

#### Caveat: Docker can bypass UFW

Docker manipulates iptables via its `DOCKER-USER` chain, which sits ahead of UFW's rules in the FORWARD chain. So if a Compose service publishes a port to the host (`ports: ["27017:27017"]`), it's reachable from outside even with UFW saying `deny incoming`. This is why:

- `docker-compose.prod.yml` removes Mongo's port mapping (`ports: !override []`)
- The Hetzner Cloud Firewall above is the actual safety net — it sits in front of Docker entirely
- The authoritative end-to-end check is the **external nmap test in Post-Deployment Validation**, not UFW alone

- [ ] **After Step 1.8 (`./prod.sh up -d`), sanity-check no service besides Caddy is publishing a host port:**
  ```bash
  docker ps --format 'table {{.Names}}\t{{.Ports}}'
  # Look for "0.0.0.0:<port>->" — only Caddy (in the infra repo) should appear with that pattern.
  # If Mongo, Postgres, Meilisearch, or MinIO show a published host port, something is wrong.
  ```

### Step 1.8: Start services with production config

- [ ] **Make prod.sh executable** (should already be, but verify):
  ```bash
  chmod +x prod.sh
  ```

- [ ] **Start with production config** (this is the moment Mongo and Postgres auto-create their users from `.env.prod`):
  ```bash
  ./prod.sh up -d
  ```

- [ ] **Confirm the Mongo init script ran:**
  ```bash
  ./prod.sh logs mongodb 2>&1 | grep -E "(running .*init-librechat-user|application user.*created)"
  # Expect both lines:
  #   running /docker-entrypoint-initdb.d/init-librechat-user.sh
  #   [init-librechat-user] application user 'librechat' created in LibreChat database.
  ```
  Note: don't grep for "Successfully added user" — that's a legacy `mongo` shell message. The `mongo:8` image uses `mongosh`, which prints `{ ok: 1 }` instead. The two lines above are the proof: the entrypoint executed the script, and the script's `set -euo pipefail` only lets it reach its trailing success line if `db.createUser` returned ok.

- [ ] **Verify both Mongo users exist and the application user can authenticate:**
  ```bash
  # As admin — should list two users (admin in admin db, librechat in LibreChat db):
  docker exec chat-mongodb mongosh --quiet \
    --username admin \
    --password "$(grep ^MONGO_ADMIN_PASSWORD .env.prod | cut -d= -f2-)" \
    --authenticationDatabase admin \
    --eval 'db.getSiblingDB("admin").system.users.find({}, {user:1, db:1, roles:1}).toArray()'

  # As librechat — should authenticate without error:
  docker exec chat-mongodb mongosh --quiet \
    --username librechat \
    --password "$(grep ^LIBRECHAT_MONGO_PASSWORD .env.prod | cut -d= -f2-)" \
    --authenticationDatabase LibreChat \
    --eval 'db.runCommand({connectionStatus: 1}).authInfo.authenticatedUsers'
  ```
  Expected:
  - First query: array with `{user: "admin", db: "admin", roles: [{role: "root", db: "admin"}]}` and `{user: "librechat", db: "LibreChat", roles: [{role: "readWrite", db: "LibreChat"}]}`
  - Second query: `[ { user: 'librechat', db: 'LibreChat' } ]`

- [ ] **Verify all services are running and healthy:**
  ```bash
  ./prod.sh ps
  # All services should show "healthy" in the STATUS column
  # It may take 30-60 seconds for health checks to pass
  ```

- [ ] **Verify the API responds:**
  ```bash
  curl -sf http://localhost:3080/health && echo "API healthy"
  ```

- [ ] **Verify resource limits are enforced (REQ-039-A):**
  ```bash
  docker stats --no-stream
  # Check the MEM LIMIT column:
  #   api should show 2GiB
  #   mongodb should show 4GiB
  #   meilisearch should show 1GiB
  #   etc.
  # If MEM LIMIT shows 0 or the host total, resource limits are NOT enforced.
  # In that case, see the spec's REQ-039-A for fallback to mem_limit syntax.
  ```

- [ ] **Verify CORS (SEC-004):** LibreChat upstream calls `app.use(cors())` unconditionally — `DOMAIN_CLIENT` does NOT restrict it at the Express level, and the response includes `Access-Control-Allow-Origin: *`. The SPA and API are same-origin (both served from `chat.memodo-eng.de`), so CORS is not actually needed for normal use. The fix is to strip CORS headers at Caddy. The infra repo's `simple-auth/Caddyfile` already has the strip directive applied to the `chat.memodo-eng.de` block:
  ```caddy
  header {
      -Access-Control-Allow-Origin
      -Access-Control-Allow-Methods
      -Access-Control-Allow-Headers
      -Access-Control-Allow-Credentials
      -Access-Control-Expose-Headers
      -Access-Control-Max-Age
  }
  ```
  Verify it's effective:
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    https://chat.memodo-eng.de/api/auth/login
  # Expect: NO access-control-* headers in the response.
  # `vary: Access-Control-Request-Headers` is harmless (cache hint, not an access control header).
  ```
  If headers leak through, reload Caddy: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` (or restart the caddy container).

- [ ] **Verify the registration endpoint is disabled (SEC-005):** Since `ALLOW_REGISTRATION=false`, the `/register` endpoint should reject all attempts regardless of email domain:
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@gmail.com","password":"Testpass1234","name":"x","username":"x","confirm_password":"Testpass1234"}' \
    https://chat.memodo-eng.de/api/auth/register
  # Expect: 403 (or similar non-2xx). A 200 here means registration is open — investigate.
  ```

- [ ] **Create the first admin via CLI** (REQ-053-style first-user bootstrap). The `/register` endpoint is off, so the LibreChat CLI tool inside the API container is the only path. The first user created becomes admin automatically (see api/server/services/AuthService.js:225):
  ```bash
  # Run inside the API container. Replace email/name/username with your values.
  docker exec -it LibreChat npm run create-user -- \
    you@memodo.de "Your Name" yourusername --email-verified=true
  # You'll be prompted for a password (or pass it as the 5th arg, less secure).
  # Use --email-verified=true so login works without a verification email
  # (we have ALLOW_UNVERIFIED_EMAIL_LOGIN=false).
  ```
  Verify the user was created with admin role:
  ```bash
  docker exec chat-mongodb mongosh --quiet \
    --username librechat \
    --password "$(grep ^LIBRECHAT_MONGO_PASSWORD .env.prod | cut -d= -f2-)" \
    --authenticationDatabase LibreChat \
    --eval 'db.getSiblingDB("LibreChat").users.find({}, {email:1, role:1, emailVerified:1})'
  # Expect one document with role: "ADMIN" and emailVerified: true.
  ```

- [ ] **Smoke-test admin login:** open `https://chat.memodo-eng.de` in an incognito window, log in with the credentials above, confirm you reach the chat UI. **Do not register** — there is no register link, and the CLI is now the only way to add users until SSO is configured.

- [ ] **Verify MongoDB is reachable internally (sanity check):** On the production server:
  ```bash
  docker exec chat-mongodb mongosh --eval "db.adminCommand('ping')"
  # Expect: { ok: 1 }
  ```

- [ ] **Verify MongoDB is NOT accessible externally (SEC-001):** From your **local machine** (not the server):
  ```bash
  nc -zv -w 5 chat.memodo-eng.de 27017
  # Expected: "Operation timed out" or "filtered" — Hetzner firewall is dropping packets. ✓
  # "Connection refused" means the firewall isn't filtering — port closed only because nothing is listening externally. Acceptable but weaker.
  # "succeeded" / "open" means Mongo is reachable from the internet — STOP and fix the firewall.
  ```
  Don't rely on `mongosh` here — it isn't always installed locally, and a TCP connect test is sufficient (and faster).

### Step 1.9: Verify NODE_ENV=production (REQ-009)

For greenfield, `NODE_ENV=production` is set in `docker-compose.prod.yml` line 20 and is in effect from first startup — no separate restart is needed.

- [ ] Confirm the API container is running with `NODE_ENV=production`:
  ```bash
  docker exec LibreChat printenv NODE_ENV
  # Should print: production
  ```

- [ ] **Verify secure cookies:** log in via browser, open DevTools > Application > Cookies. The session cookie should have `Secure` and `HttpOnly` flags.

---

## Phase 2: Backups

### Step 2.1: Make all scripts executable

- [ ] ```bash
  chmod +x scripts/backup-mongodb.sh
  chmod +x scripts/backup-minio.sh
  chmod +x scripts/backup-postgres.sh
  chmod +x scripts/backup-config.sh
  chmod +x scripts/backup-offhost.sh
  chmod +x scripts/monitoring-watchdog.sh
  ```

### Step 2.2: Create backups directory

- [ ] ```bash
  mkdir -p backups
  ```

### Step 2.3: Test each backup script manually

Run each script and verify it completes without errors:

- [ ] **MongoDB backup:**
  ```bash
  ./scripts/backup-mongodb.sh
  ls -la backups/mongodb/
  # Should show a .archive.gz file with today's date
  ```
  > **If you see `.env.prod: line N: UID: readonly variable`** and `backups/mongodb/` is missing, you have `UID=`/`GID=` lines in `.env.prod` (see Step 1.1 callout). Remove them — `prod.sh` exports those at the shell level, so docker compose still gets them. The backup scripts also filter readonly built-ins when sourcing, but only on a clean install; an older copy of the script may not have that fix yet.

- [ ] **MinIO backup:**
  ```bash
  ./scripts/backup-minio.sh
  ls -la backups/minio/
  # Should show a timestamped directory with mirrored files
  ```

- [ ] **PostgreSQL backup:**
  ```bash
  ./scripts/backup-postgres.sh
  ls -la backups/postgres/
  # Should show a .dump file with today's date
  ```

- [ ] **Config backup:**
  ```bash
  ./scripts/backup-config.sh
  ls -la backups/config/
  # Should show a .tar.gz file with today's date
  ```

### Step 2.4: Configure off-host backup (REQ-023)

Local backups protect against accidental deletion. Off-host backups protect against server failure.

- [ ] **Choose a mode** and configure in `.env.prod`:

  **Option A — rsync to another server:**
  ```bash
  # Edit .env.prod:
  OFF_HOST_MODE=rsync
  OFF_HOST_RSYNC_TARGET=user@backup-server:/path/to/backups/librechat
  ```
  Set up SSH key-based auth to the backup server:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/backup_key -N ""
  ssh-copy-id -i ~/.ssh/backup_key user@backup-server
  ```

  **Option B — S3 bucket:**
  ```bash
  # Edit .env.prod:
  OFF_HOST_MODE=s3
  OFF_HOST_S3_BUCKET=s3://your-backup-bucket
  ```
  Configure AWS credentials:
  ```bash
  aws configure
  # Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars
  ```

- [ ] **Test off-host backup:**
  ```bash
  ./scripts/backup-offhost.sh
  ```

### Step 2.5: Install crontab (REQ-050)

- [ ] **Review the crontab** and adjust paths if your deployment is not at `/opt/docker/librechat`:
  ```bash
  cat crontab.prod
  # The PROJECT variable at the top sets the base path
  ```

- [ ] **Edit the PROJECT path** if needed:
  ```bash
  # If your deployment is at a different path:
  sed -i "s|PROJECT=/opt/docker/librechat|PROJECT=/your/actual/path|" crontab.prod
  ```

- [ ] **Set the MAILTO address** to receive failure notifications:
  ```bash
  # The default is admin@memodo.de — change if needed
  # Note: MAILTO requires a working MTA (mail transfer agent) on the server.
  # If you don't have one, rely on BACKUP_WEBHOOK_URL in .env.prod instead.
  ```

- [ ] **Install the crontab:**
  ```bash
  crontab crontab.prod
  crontab -l  # Verify it's installed
  ```

### Step 2.6: Test a restore (REQ-024)

**Restore must target a throwaway MongoDB instance, NOT the production one.** The simplest setup is a standalone `docker run` on the same host as your backups (different container name → no collision with `chat-mongodb`). On a fresh deployment the backup will be near-empty — this validates the tooling and procedure, not data fidelity. Re-run the drill once real usage has built up.

- [ ] **Spin up a throwaway mongo container** with disposable credentials (do NOT reuse prod creds):
  ```bash
  docker run -d --name mongo-restore-test \
    -e MONGO_INITDB_ROOT_USERNAME=admin \
    -e MONGO_INITDB_ROOT_PASSWORD=testpw \
    mongo:8
  ```

- [ ] **Sanity-check the backup file before restoring:**
  ```bash
  ls -la /opt/docker/librechat/backups/mongodb/
  gunzip -t /opt/docker/librechat/backups/mongodb/librechat_<TIMESTAMP>.archive.gz && echo "gzip OK"
  ```

- [ ] **Restore from the latest backup** (use the absolute path; `--verbose` makes silent failures obvious):
  ```bash
  docker exec -i mongo-restore-test mongorestore \
    --username admin --password testpw --authenticationDatabase admin \
    --archive --gzip --drop --verbose \
    < /opt/docker/librechat/backups/mongodb/librechat_<TIMESTAMP>.archive.gz
  # Watch for `restoring LibreChat.<coll> from archive` lines and a final
  # `<n> document(s) restored successfully`. If you see `0 document(s)`,
  # stdin is empty — check the file path and shell context.
  ```

- [ ] **Verify the database and collections exist:**
  ```bash
  docker exec mongo-restore-test mongosh --quiet \
    --username admin --password testpw --authenticationDatabase admin \
    --eval 'print(JSON.stringify(db.adminCommand({listDatabases:1}).databases.map(d => d.name)))'
  # Expect: includes "LibreChat"

  docker exec mongo-restore-test mongosh --quiet \
    --username admin --password testpw --authenticationDatabase admin \
    --eval 'print(JSON.stringify(db.getSiblingDB("LibreChat").getCollectionNames()))'
  # Expect: array of collection names from your dump
  ```

- [ ] **Verify document counts match the dump output.** Use `getSiblingDB` (do NOT use `use LibreChat;` inside `--eval` — it prints "switched" but doesn't re-bind `db` for subsequent statements, leading to silent zero counts):
  ```bash
  docker exec mongo-restore-test mongosh --quiet \
    --username admin --password testpw --authenticationDatabase admin \
    --eval '
      const lc = db.getSiblingDB("LibreChat");
      ["users","roles","accessroles","agentcategories","sessions","balances","projects","agents","conversations","messages"].forEach(c => {
        print(c + ":", lc.getCollection(c).countDocuments({}));
      });
    '
  # Compare each count against the `done dumping LibreChat.<coll> (N documents)`
  # lines in the corresponding backup-mongodb.sh run. They must match exactly.
  ```

- [ ] **Tear down the test container:**
  ```bash
  docker rm -f mongo-restore-test
  ```

---

## Phase 3: Monitoring and Alerting

### Step 3.1: Configure Alertmanager webhook

The bundled `monitoring/alertmanager/alertmanager.yml` is wired for Microsoft Teams via Power Automate (`msteamsv2_configs`) reading the URL from a file mounted at `/etc/alertmanager/secrets/teams-webhook-url`. The compose file pins `prom/alertmanager:v0.28.1`, which is the minimum for `msteamsv2_configs` (added in v0.28).

**For Slack** (simpler — generic `webhook_configs` works), edit `alertmanager.yml`:
```yaml
receivers:
  - name: default
    webhook_configs:
      - url: 'https://hooks.slack.com/services/T.../B.../...'
        send_resolved: true
  - name: critical
    webhook_configs:
      - url: 'https://hooks.slack.com/services/T.../B.../...'
        send_resolved: true
```
Then skip ahead to Step 3.2.

**For Microsoft Teams** (Power Automate workflow):

The legacy `outlook.office.com/webhook/...` connectors were retired by Microsoft at end of 2025. Current path is a Power Automate "Workflows" trigger.

- [ ] **Create the workflow in Teams:** channel → ⋯ → Workflows → "Post to a channel when a webhook request is received" → pick team/channel → finish. Power Automate gives you an HTTPS POST URL.

- [ ] **Apply the `api-version` fix.** Power Automate's copy-button URL contains `api-version=1`, which the gateway rejects with `ApiVersionInvalid`. Replace it with `api-version=2024-10-01`. Verify with curl from the host:
  ```bash
  curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"test":"hi"}' -w '\nHTTP %{http_code}\n' \
    '<your-url-with-api-version=2024-10-01>'
  # Expect: HTTP 202. If 400 ApiVersionInvalid, the api-version is still wrong.
  ```

- [ ] **Write the URL to the secrets file** (`monitoring/alertmanager/secrets/` is gitignored). Use `printf '%s'` with **single quotes** — pasting between double quotes or unquoted lets the shell add literal backslashes before `?`, `=`, `&`, which corrupts the URL:
  ```bash
  mkdir -p monitoring/alertmanager/secrets
  printf '%s' '<paste-url-here-between-single-quotes>' \
    > monitoring/alertmanager/secrets/teams-webhook-url
  chmod 644 monitoring/alertmanager/secrets/teams-webhook-url
  # Sanity check — must show no backslashes:
  cat monitoring/alertmanager/secrets/teams-webhook-url; echo
  ```
  > **Why 644 not 600:** Alertmanager runs as `nobody` (UID 65534), not root. Mode 600 with root ownership causes `permission denied: read webhook_url_file`. The actual security boundary here is the host filesystem and `.gitignore`, not in-container perms.

- [ ] **Never commit the URL.** Anyone with the URL can post to your alerts channel. Keep it in `monitoring/alertmanager/secrets/teams-webhook-url` only — the directory is in `.gitignore`. If the URL leaks (e.g., gets pasted into a doc and committed), regenerate it from the Power Automate trigger; old signatures stop working immediately.

- [ ] **Test end-to-end** after Step 3.3 brings Alertmanager up:
  ```bash
  curl -H 'Content-Type: application/json' -d '[{
    "labels": {"alertname":"TeamsWebhookTest","severity":"warning"},
    "annotations": {"summary":"Test","description":"Webhook delivery check"}
  }]' http://localhost:9093/api/v2/alerts
  # Wait ~30s (group_wait), card should appear in Teams.
  # If not, check logs:
  docker compose -f monitoring/docker-compose.monitoring.yml --env-file .env.prod \
    logs --since 1m alertmanager | grep -iE 'notify|err|fail'
  # And check Power Automate run history at make.powerautomate.com.
  ```

**If you don't have a webhook yet**, you can set one up later — alerts will still fire but won't be delivered until a receiver is configured. The watchdog script (Step 3.3) provides a fallback.

### Step 3.2: Set the compose project network name

- [ ] **Find your Docker network name:**
  ```bash
  docker network ls | grep default
  # Look for something like "librechat_default" or "librechat-worktree_default"
  ```

- [ ] **Update `.env.prod`** with the correct network name:
  ```
  COMPOSE_PROJECT_NETWORK=<your-network-name>
  ```

### Step 3.3: Start the monitoring stack

- [ ] ```bash
  docker compose -f monitoring/docker-compose.monitoring.yml --env-file .env.prod up -d
  ```

- [ ] **Verify all monitoring containers are running:**
  ```bash
  docker compose -f monitoring/docker-compose.monitoring.yml --env-file .env.prod ps
  ```

- [ ] **Verify Prometheus is scraping targets:**
  Open `http://localhost:9090/targets` in a browser (via SSH tunnel if remote):
  ```bash
  # From your local machine:
  ssh -L 9090:localhost:9090 user@production-server
  # Then open http://localhost:9090/targets in your browser
  ```
  All targets should show "UP". Some may show "DOWN" initially (e.g., `redakt` if PII detection isn't deployed yet).

- [ ] **Verify Grafana is accessible:**
  ```bash
  curl -sf http://localhost:3000/api/health && echo "Grafana healthy"
  ```
  Log in at `http://localhost:3000` (via SSH tunnel) with:
  - Username: `admin`
  - Password: the `GRAFANA_ADMIN_PASSWORD` from `.env.prod`

### Step 3.4: Set up the monitoring watchdog cron

The watchdog is already in `crontab.prod` (installed in Phase 2). Verify it's there:

- [ ] ```bash
  crontab -l | grep watchdog
  # Should show: */5 * * * * .../scripts/monitoring-watchdog.sh ...
  ```

### Step 3.5: Set up external uptime monitoring (REQ-031)

This is independent of Prometheus — it runs outside your server and alerts you when the site is down.

- [ ] **Sign up for an external monitoring service** (free tiers available):
  - [UptimeRobot](https://uptimerobot.com/) — free for 50 monitors
  - [Better Stack](https://betterstack.com/) — free tier available
  - [Azure Monitor](https://portal.azure.com/) — if you already use Azure

- [ ] **Add these monitors:**
  | URL | Check Interval | Alert After |
  |-----|---------------|-------------|
  | `https://chat.memodo-eng.de` | 5 min | 2 failures |
  | `https://chat.memodo-eng.de/health` | 5 min | 2 failures |
  | `https://minio-console.memodo-eng.de` | 5 min | 2 failures |

### Step 3.6: Configure Azure OpenAI monitoring (REQ-033, REQ-034)

- [ ] **Azure Diagnostic Settings** — In the Azure portal:
  1. Go to your Azure OpenAI resource
  2. Settings > Diagnostic settings > Add diagnostic setting
  3. Enable: `Audit`, `RequestResponse`, `AzureOpenAIRequestUsage`, `Trace`
  4. Send to: Log Analytics workspace (create one if needed)

- [ ] **Azure Budget** — In the Azure portal:
  1. Go to Cost Management + Billing > Budgets
  2. Create a budget for your OpenAI resource group
  3. Set alert thresholds at 50%, 75%, 90% of your monthly budget
  4. Configure email notifications

---

## Phase 4: Guardrails and Cost Control

Most of Phase 4 is already configured via `.env.prod` and `librechat.yaml`. This phase verifies the settings are active.

### Step 4.1: Verify rate limiting is active (REQ-036)

- [ ] The rate limiting values are in `.env.prod`:
  ```bash
  grep -E '^(LIMIT_|LOGIN_|REGISTER_|MESSAGE_IP|CONCURRENT)' .env.prod
  ```
  These take effect on API restart (already done in Phase 1).

### Step 4.2: Verify token balance is active (REQ-037)

- [ ] Check your `librechat.yaml` has the `balance` section from Step 1.6. Create a test user and verify they get a starting balance.

### Step 4.3: Verify ban system is active (REQ-038)

- [ ] Check `.env.prod` has:
  ```
  BAN_VIOLATIONS=true
  BAN_DURATION=7200000
  BAN_INTERVAL=20
  ```

### Step 4.4: Deploy Redakt API for PII detection (REQ-040)

**Redakt runs as an independent project**, not as part of LibreChat's compose stack. Its repo lives at `/Users/pablooliva/Dev/AI dev/redakt` (locally) and is brought up with its own `docker-compose.prod.yml`. LibreChat reaches it over the shared external `caddy_net` Docker network. There is **no Redakt service in LibreChat's `docker-compose.prod.yml`**.

- [ ] **Confirm `caddy_net` exists** (created by the infra repo's Caddy stack — must already be up):
  ```bash
  docker network inspect caddy_net >/dev/null 2>&1 && echo "OK: caddy_net present" || echo "MISSING: bring up the infra repo first"
  ```

- [ ] **Bring Redakt up from its own repo** on the production server (clone path will differ from local):
  ```bash
  cd /opt/docker/redakt   # adjust to wherever the redakt repo is checked out
  docker compose -f docker-compose.prod.yml up -d
  docker compose -f docker-compose.prod.yml ps
  # Expect: redakt, presidio-analyzer, presidio-anonymizer all running and healthy.
  ```

- [ ] **Verify Redakt is reachable from the LibreChat API container:**
  ```bash
  cd /opt/docker/librechat
  docker exec LibreChat sh -c '. /app/.env && wget -qO- "$PII_DETECTION_API_URL/api/health"'
  # Expect JSON like {"status":"healthy","analyzer":"up","anonymizer":"up"}.
  # `degraded` / `down` means a Presidio sidecar isn't ready — check the redakt stack.
  ```
  > **Why source `/app/.env` first.** `PII_DETECTION_API_URL` is loaded from that file by Node's dotenv at app startup; it is NOT in the api container's compose `environment:` block, so a bare `docker exec ... sh -c '... $PII_DETECTION_API_URL ...'` sees it as empty. Sourcing the file keeps this command in lockstep with whatever URL `.env.prod` actually defines. Fallback if sourcing fails (e.g., a value with shell-special chars): `docker exec LibreChat wget -qO- http://redakt:8000/api/health`.
  >
  > **Why `/api/health`, not `/health`.** Redakt mounts all routes under `/api` (the health router has `prefix="/api"`), and LibreChat itself calls `${PII_DETECTION_API_URL}/api/detect` — see `api/server/middleware/detectPII.js`.

  > **Hostname watch-out.** `.env.prod.template` ships `PII_DETECTION_API_URL=http://redakt:8000`, but the redakt compose names the service `redakt` (no `container_name`, no network alias). On `caddy_net` the resolvable DNS name is `redakt`, not `redakt-api`. If the health check above fails with a DNS error, either:
  > - Update `.env.prod` to `PII_DETECTION_API_URL=http://redakt:8000` and `./prod.sh restart api`, **or**
  > - Add a `container_name: redakt-api` (or `networks.caddy_net.aliases: [redakt-api]`) in the redakt compose and recreate that stack.
  > Pick one and keep both repos consistent.

- [ ] **Verify PII detection is wired up end-to-end** (warn mode is the default in `.env.prod.template`):
  ```bash
  # Send a test message containing PII (e.g., a fake email or phone number) via the UI,
  # then check the API logs for PII detection events:
  ./prod.sh logs api | grep -i pii
  ```

### Step 4.5: Test feature interaction (EDGE-017)

With all four systems active (PII detection, rate limiting, ban system, token balance):

- [ ] Send a message containing PII — verify it generates a PII event but does NOT increment the user's violation count.
- [ ] Rapidly send messages exceeding the rate limit — verify you get HTTP 429 responses.

---

## Phase 5: Operational Maturity

### Step 5.1: SSH hardening (REQ-047)

- [ ] **Disable password authentication:**
  ```bash
  sudo nano /etc/ssh/sshd_config
  # Set: PasswordAuthentication no
  # Set: ChallengeResponseAuthentication no
  # Set: UsePAM no (or set to yes but ensure password auth is off)
  sudo systemctl restart sshd
  ```
  **WARNING:** Verify you have SSH key access BEFORE disabling password auth. Test in a second terminal before closing your current session.

- [ ] **Install and configure fail2ban:**
  ```bash
  sudo apt install fail2ban -y
  sudo systemctl enable fail2ban
  sudo systemctl start fail2ban
  sudo fail2ban-client status sshd
  ```

### Step 5.2: Enable unattended upgrades (REQ-044)

- [ ] ```bash
  sudo apt install unattended-upgrades -y
  sudo dpkg-reconfigure -plow unattended-upgrades
  # Select "Yes" to enable automatic security updates

  # Verify it's active:
  systemctl status unattended-upgrades
  ```

### Step 5.3: Subscribe to LibreChat releases (REQ-044)

- [ ] Go to [github.com/danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)
- [ ] Click "Watch" > "Custom" > check "Releases only"
- [ ] Set a monthly calendar reminder (first Monday of each month) to review Docker image updates

### Step 5.4: Review SSRF protection (REQ-052)

- [ ] Verify `librechat.yaml` has empty allowlists:
  ```yaml
  actions:
    allowedDomains: []
  mcpSettings:
    allowedDomains: []
  ```
  If any internal services need to be reached by agents or MCP, add them explicitly.

### Step 5.5: GDPR data subject request readiness (REQ-048)

- [ ] **Verify Azure OpenAI DPA is in place:** Check your Azure agreement includes a Data Processing Agreement for OpenAI services.

- [ ] **Test data erasure procedure:** Since `/register` is disabled, create the test user via CLI:
  ```bash
  docker exec -it LibreChat npm run create-user -- \
    gdpr-test@memodo.de "GDPR Test" gdprtest --email-verified=true
  ```
  Then log in as that user, generate some conversations with file uploads, and delete the user:
  ```bash
  docker exec -it LibreChat npm run delete-user -- gdpr-test@memodo.de
  ```
  Verify data is removed from:
  - MongoDB: `users`, `conversations`, `messages`, `transactions`, `files` collections
  - MinIO: uploaded files
  - pgvector: embeddings (check if cascading deletion is implemented)
  Document any manual cleanup steps required.

### Step 5.6: Verify TRUST_PROXY (REQ-049)

- [ ] ```bash
  grep TRUST_PROXY .env.prod
  # Should show: TRUST_PROXY=1
  # This matches the single Caddy hop. If you add another proxy layer, increase this.
  ```

---

## Post-Deployment Validation

Run these checks after all phases are complete.

### Security Verification

- [ ] **External port scan** (from a different machine). Use whichever you have installed:
  ```bash
  # Option A — nmap (one shot, all ports):
  nmap -p 22,80,443,3000,3080,5432,7700,9000,9090,9093,27017 chat.memodo-eng.de
  # Only 22, 80, 443 should be open. Everything else: filtered (best) or closed (acceptable).

  # Option B — nc per-port (no nmap install needed):
  for p in 22 80 443 2019 3000 3080 5432 7700 9000 9001 9090 9093 27017; do
    nc -zv -w 3 chat.memodo-eng.de "$p"
  done
  # Expect: 22/80/443 succeed; everything else times out or refuses.
  # Pay particular attention to 2019 (Caddy admin API) and 27017 (MongoDB) — both must NOT be reachable.
  ```

- [ ] **CORS verification:**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    https://chat.memodo-eng.de/api/auth/login | grep -i access-control
  # Expect: NO output (no access-control-* headers).
  # The Caddy strip-headers config in the infra repo removes them at the proxy.
  ```

- [ ] **Registration disabled:**
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"email":"x@gmail.com","password":"Test12341234","name":"x","username":"x","confirm_password":"Test12341234"}' \
    https://chat.memodo-eng.de/api/auth/register
  # Expect non-2xx (registration is off; CLI is the only path until SSO).
  ```

### Backup Verification

- [ ] **Run all backup scripts once:**
  ```bash
  ./scripts/backup-mongodb.sh
  ./scripts/backup-minio.sh
  ./scripts/backup-postgres.sh
  ./scripts/backup-config.sh
  ./scripts/backup-offhost.sh
  ```

- [ ] **Verify backups are stored locally and off-host:**
  ```bash
  ls -la backups/mongodb/
  ls -la backups/minio/
  ls -la backups/postgres/
  ls -la backups/config/
  # Also check your off-host target (S3 bucket or remote server)
  ```

### Monitoring Verification

- [ ] **Prometheus scraping:** All targets UP at `http://localhost:9090/targets`
- [ ] **Grafana accessible:** Can log in at `http://localhost:3000`
- [ ] **Alertmanager receiving:** Check `http://localhost:9093/#/status`
- [ ] **External uptime monitor:** Stop the API, wait 5 min, verify you get an alert:
  ```bash
  ./prod.sh stop api
  # Wait for uptime monitor alert
  ./prod.sh start api  # Restart after testing
  ```

### Disaster Recovery Drill (AVAIL-002)

**Do this on a local Docker environment, NOT on production.** The goal is to verify you can restore from backups within 4 hours.

- [ ] **Time the entire procedure** using the `docs/runbooks/disaster-recovery.md` runbook
- [ ] Record actual time: _____ hours _____ minutes
- [ ] If over 4 hours, identify bottlenecks and update the RTO target

---

## Quick Reference

### Daily operations
```bash
./prod.sh ps                          # Check service status
./prod.sh logs -f api                 # Follow API logs
./prod.sh restart api                 # Restart a service
docker stats --no-stream              # Check resource usage
```

### Accessing services via SSH tunnel
```bash
ssh -L 9090:localhost:9090 -L 3000:localhost:3000 -L 9093:localhost:9093 user@server
# Then open in browser:
#   Prometheus: http://localhost:9090
#   Grafana:    http://localhost:3000
#   Alertmanager: http://localhost:9093
```

### Accessing MongoDB via SSH tunnel
```bash
ssh -L 27017:localhost:27017 user@server
mongosh "mongodb://admin:<password>@localhost:27017/admin"
```

### Emergency: disable PII detection
```bash
# Edit .env.prod: set PII_DETECTION=false
./prod.sh restart api
```

### Runbook locations
- `docs/runbooks/service-restart.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/secret-rotation.md`
- `docs/runbooks/pii-override.md`
- `docs/runbooks/disaster-recovery.md`
- `docs/runbooks/log-escalation.md`
