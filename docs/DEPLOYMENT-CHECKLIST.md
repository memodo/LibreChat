# Production Deployment Checklist — SPEC-010

**Purpose:** Step-by-step guide to deploy all SPEC-010 production readiness changes to the MemodoAI LibreChat server. Work through each phase in order. Check off each item as you complete it.

**Time estimate:** Phase 1 takes the most effort (1-2 hours of focused work). Phases 2-5 are faster.

**Where to run commands:** All commands run on the production server unless otherwise noted. The project is assumed to be at `/opt/librechat` — adjust paths if your deployment location differs.

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
  cd /opt/librechat
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

- [ ] **Verify .env.prod has no remaining placeholders:**
  ```bash
  grep '<' .env.prod
  # Should return nothing. If it shows lines, those still need real values.
  ```

- [ ] **Verify .env.prod is NOT tracked by git:**
  ```bash
  git status .env.prod
  # Should show nothing (not tracked) or show as untracked. It must NOT be staged.
  ```

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

### Step 1.7: Verify host firewall (REQ-016)

Confirm the host firewall is configured before bringing services up. The end-to-end port test runs in Post-Deployment Validation once services are listening.

- [ ] **Check that the firewall is active and blocks DB ports:**
  ```bash
  sudo ufw status verbose
  # Expect: 22/tcp, 80/tcp, 443/tcp ALLOW; 27017, 5432, 9000, 7700 not allowed
  ```
  If `ufw` is inactive or the wrong ports are allowed, fix it now. Docker's iptables rules can bypass UFW under some configurations — the nmap test in Post-Deployment Validation is the authoritative end-to-end check.

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
  ./prod.sh logs mongodb 2>&1 | grep -E '(init-librechat-user|Successfully added user)'
  # Expect to see "application user 'librechat' created" and two
  # "Successfully added user" lines (root + librechat).
  ```

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

- [ ] **Verify CORS (SEC-004):** The CORS investigation during implementation found that `app.use(cors())` is unconditional — `DOMAIN_CLIENT` does NOT restrict it at the Express level. You need a Caddy-level fix:
  ```bash
  # Test current CORS behavior from any machine:
  curl -sI -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    https://chat.memodo-eng.de/api/auth/login

  # If the response includes "Access-Control-Allow-Origin: *"
  # or allows the evil origin, CORS is open.
  # Fix: Add CORS headers in your Caddy config (infra repo).
  ```
  **Action needed in infra repo:** Add a `header` directive in your Caddyfile for `chat.memodo-eng.de` that sets `Access-Control-Allow-Origin` to `https://chat.memodo-eng.de` only. This is tracked as an external dependency.

- [ ] **Test registration restriction (SEC-005):** Open a browser incognito window, go to `https://chat.memodo-eng.de`, and try to register with a non-company email (e.g., `test@gmail.com`). It should be rejected.

- [ ] **Verify MongoDB is not accessible externally (SEC-001):** From your local machine:
  ```bash
  # Should fail or time out
  mongosh "mongodb://<PRODUCTION_SERVER_IP>:27017" --eval "db.adminCommand('ping')"
  ```

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

- [ ] **Review the crontab** and adjust paths if your deployment is not at `/opt/librechat`:
  ```bash
  cat crontab.prod
  # The PROJECT variable at the top sets the base path
  ```

- [ ] **Edit the PROJECT path** if needed:
  ```bash
  # If your deployment is at a different path:
  sed -i "s|PROJECT=/opt/librechat|PROJECT=/your/actual/path|" crontab.prod
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

**Do this on a local Docker environment, NOT on production.** On a fresh deployment the MongoDB backup will be near-empty — this test validates the tooling and procedure, not data fidelity. Re-run the restore drill once real usage has built up.

- [ ] Copy a MongoDB backup to your local machine and restore it:
  ```bash
  # On local machine:
  docker exec -i <local-mongodb-container> mongorestore \
    --archive --gzip --drop < /path/to/librechat_YYYYMMDD.archive.gz
  ```

- [ ] Verify data integrity after restore:
  ```bash
  docker exec <local-mongodb-container> mongosh --eval "
    use LibreChat;
    print('conversations:', db.conversations.countDocuments({}));
    print('messages:', db.messages.countDocuments({}));
    print('users:', db.users.countDocuments({}));
  "
  ```

---

## Phase 3: Monitoring and Alerting

### Step 3.1: Configure Alertmanager webhook

- [ ] **Edit `monitoring/alertmanager/alertmanager.yml`** and replace the placeholder webhook URLs with your actual notification endpoint:

  **For Slack:**
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

  **For Microsoft Teams:**
  ```yaml
  receivers:
    - name: default
      webhook_configs:
        - url: 'https://outlook.office.com/webhook/...'
          send_resolved: true
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
  docker compose -f monitoring/docker-compose.monitoring.yml ps
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

**Note:** The Redakt API container is defined in `docker-compose.prod.yml` but you need to verify the image is accessible.

- [ ] **Check if the Redakt API image exists:**
  ```bash
  docker pull ghcr.io/memodoai/redakt-api:v1.0.0
  ```
  If this fails, the image tag in `docker-compose.prod.yml` may need updating to match your actual Redakt image. Check with your team for the correct image reference.

- [ ] **If Redakt is already running** from a previous deployment, it should start automatically with `prod.sh`.

- [ ] **Verify PII detection is working in warn mode:**
  ```bash
  # Send a test message containing PII (e.g., a fake SSN or email)
  # Check the API logs for PII detection events:
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

- [ ] **Test data erasure procedure:** Create a test user, generate some conversations with file uploads, then:
  1. Delete the user via LibreChat admin panel
  2. Verify data is removed from:
     - MongoDB: `users`, `conversations`, `messages`, `transactions`, `files` collections
     - MinIO: uploaded files
     - pgvector: embeddings (check if cascading deletion is implemented)
  3. Document any manual cleanup steps required

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

- [ ] **External port scan** (from a different machine):
  ```bash
  nmap -p 22,80,443,3000,3080,5432,7700,9000,9090,9093,27017 <PRODUCTION_IP>
  # Only 22, 80, 443 should be open
  ```

- [ ] **CORS verification:**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    https://chat.memodo-eng.de/api/auth/login | grep -i access-control
  # Should NOT show Access-Control-Allow-Origin: * or the evil origin
  ```

- [ ] **Registration restriction:**
  Try registering with a non-company email — should be rejected.

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
