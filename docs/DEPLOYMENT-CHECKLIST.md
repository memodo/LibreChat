# Production Deployment Checklist — SPEC-010

**Purpose:** Step-by-step guide to deploy all SPEC-010 production readiness changes to the MemodoAI LibreChat server. Work through each phase in order. Check off each item as you complete it.

**Time estimate:** Phase 1 takes the most effort (1-2 hours of focused work). Phases 2-5 are faster.

**Where to run commands:** All commands run on the production server unless otherwise noted. The project is assumed to be at `/opt/librechat` — adjust paths if your deployment location differs.

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

- [ ] **Take a full manual backup of everything** before making any changes:
  ```bash
  mkdir -p ~/pre-spec010-backup

  # MongoDB
  docker exec chat-mongodb mongodump --archive --gzip --db LibreChat \
    > ~/pre-spec010-backup/mongodb-$(date +%Y%m%d).archive.gz

  # PostgreSQL
  docker exec vectordb pg_dump -U myuser -d mydatabase --format=custom \
    > ~/pre-spec010-backup/postgres-$(date +%Y%m%d).dump

  # MinIO data (copy the directory)
  cp -r ./minio-data ~/pre-spec010-backup/minio-data-$(date +%Y%m%d)

  # Config files
  cp .env ~/pre-spec010-backup/.env.bak
  cp librechat.yaml ~/pre-spec010-backup/librechat.yaml.bak
  cp docker-compose.yml ~/pre-spec010-backup/docker-compose.yml.bak
  cp docker-compose.override.yml ~/pre-spec010-backup/docker-compose.override.yml.bak
  ```

- [ ] **Disable any existing cron jobs** that might interfere (e.g., backup crons running mid-migration):
  ```bash
  crontab -l > ~/pre-spec010-backup/crontab.bak  # Save current crontab
  crontab -r 2>/dev/null || true                   # Remove current crontab
  ```

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
  - Set `MONGO_URI` using the LibreChat MongoDB password:
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

### Step 1.3: MongoDB authentication migration (REQ-006)

This is the highest-risk step. Read the full script first, then run it interactively.

- [ ] **Read the migration script** before running it:
  ```bash
  cat scripts/mongodb-auth-migration.sh
  ```

- [ ] **Edit the script** with your passwords:
  ```bash
  nano scripts/mongodb-auth-migration.sh
  ```
  Set these two variables at the top:
  ```bash
  ADMIN_PASSWORD="<paste your MONGO_ADMIN_PASSWORD from .env.prod>"
  LIBRECHAT_PASSWORD="<paste your LIBRECHAT_MONGO_PASSWORD>"
  ```

- [ ] **Run the migration interactively** (it pauses at each step for confirmation):
  ```bash
  bash scripts/mongodb-auth-migration.sh
  ```
  Follow each prompt. The script will:
  1. Verify MongoDB is accessible without auth
  2. Create the admin user
  3. Create the LibreChat application user
  4. Prompt you to update `.env.prod` (already done in Step 1.1)
  5. Restart MongoDB with `--auth`
  6. Verify auth works for both users
  7. Restart the API
  8. Verify API health

- [ ] **After migration succeeds, clear the passwords from the script:**
  ```bash
  nano scripts/mongodb-auth-migration.sh
  # Set ADMIN_PASSWORD="" and LIBRECHAT_PASSWORD="" back to empty
  ```

- [ ] **Handle dev environment (REQ-053):** Since MongoDB now requires auth, your dev `.env` needs updating too. Choose one:
  - **(a) Simplest — update `.env` with the same credentials:**
    ```bash
    # Copy the MONGO_URI line from .env.prod to .env
    grep MONGO_URI .env.prod
    # Edit .env and update the MONGO_URI line to match
    ```
  - **(b) Separate dev MongoDB:** If you want dev to stay unauthenticated, spin up a second MongoDB on a different port. (More complex — only do this if you actively develop locally.)

### Step 1.4: Change PostgreSQL credentials (REQ-007)

- [ ] **Change the password inside PostgreSQL:**
  ```bash
  # Get the new password from .env.prod
  NEW_PG_PASS=$(grep POSTGRES_PASSWORD .env.prod | cut -d= -f2-)

  docker exec vectordb psql -U myuser -d mydatabase \
    -c "ALTER USER myuser PASSWORD '$NEW_PG_PASS';"

  # Also change the username if .env.prod uses a different username:
  # The template uses POSTGRES_USER=librechat_rag
  # If you need to create a new user instead:
  docker exec vectordb psql -U myuser -d mydatabase -c "
    CREATE USER librechat_rag WITH PASSWORD '$NEW_PG_PASS';
    GRANT ALL PRIVILEGES ON DATABASE mydatabase TO librechat_rag;
    ALTER DATABASE mydatabase OWNER TO librechat_rag;
  "
  ```

  **Note:** If changing the username, you also need to update the database name to match `POSTGRES_DB` in `.env.prod`. For a small deployment, the simplest approach is to keep the existing username (`myuser`) and just change the password. In that case, update `.env.prod` to use `POSTGRES_USER=myuser` and `POSTGRES_DB=mydatabase` (matching your current setup).

### Step 1.5: Change MinIO credentials (REQ-008)

- [ ] MinIO reads credentials from environment variables on startup. The new credentials in `.env.prod` will take effect when you restart MinIO with `prod.sh`. No in-database password change is needed — MinIO uses env vars directly.

  **However**, if you've created additional MinIO users/policies via the console, those are stored separately and won't be affected.

### Step 1.6: Set up production librechat.yaml

- [ ] Review the example and merge production settings into your `librechat.yaml`:
  ```bash
  # Compare your current config with the production example
  diff librechat.yaml librechat.yaml.prod.example
  ```

  Key sections to add or update in your `librechat.yaml`:
  - `registration.allowedDomains` — restricts who can register (REQ-011)
  - `balance` section — enables token limits per user (REQ-037)
  - `rateLimits` section — file upload and import rate limits (REQ-036)
  - `actions.allowedDomains: []` and `mcpSettings.allowedDomains: []` — SSRF protection (REQ-052)

  **Important:** Don't replace your entire `librechat.yaml` with the example — merge the new sections in. The example contains your actual endpoint configs for reference, but your live file may have differences.

### Step 1.7: Verify host firewall (REQ-016)

- [ ] **Check that database ports are not accessible from outside.** From a different machine (NOT the production server):
  ```bash
  # Run from your local machine or another server
  nmap -p 27017,5432,9000,7700 <PRODUCTION_SERVER_IP>
  # All four ports should show as "closed" or "filtered"
  # Only ports 80, 443, and 22 should be open
  ```

  If database ports are open, Docker's port mapping may be bypassing your firewall. The `docker-compose.prod.yml` removes the MongoDB port mapping (REQ-013), but if the base `docker-compose.yml` exposes other database ports, they may still be reachable. Once you start with `prod.sh`, the production overrides will take effect.

### Step 1.8: Start services with production config

- [ ] **Make prod.sh executable** (should already be, but verify):
  ```bash
  chmod +x prod.sh
  ```

- [ ] **Stop the current dev stack:**
  ```bash
  docker compose down
  ```

- [ ] **Start with production config:**
  ```bash
  ./prod.sh up -d
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

### Step 1.9: Set NODE_ENV=production (REQ-009) — Maintenance Window

**Do this last in Phase 1.** This invalidates all active user sessions.

- [ ] **Notify users** they will need to re-login.

- [ ] Verify `NODE_ENV=production` is set in `.env.prod` (should already be from the template).

- [ ] Restart the API to pick up the change:
  ```bash
  ./prod.sh restart api
  ```

- [ ] **Verify secure cookies are set:** Log in via browser, open DevTools > Application > Cookies. Look for the session cookie — it should have `Secure` and `HttpOnly` flags.

### Phase 1 Rollback

If anything in Phase 1 breaks the service:
- **MongoDB auth:** Remove `command: mongod --auth --bind_ip_all` from `docker-compose.prod.yml`, then `./prod.sh restart mongodb && ./prod.sh restart api`
- **Image switch:** Revert image tag in `docker-compose.prod.yml` to the dev image
- **Full rollback:** Stop prod stack, restore from pre-flight backup, start with original `docker compose up -d`

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

**Do this on a local Docker environment, NOT on production.**

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
