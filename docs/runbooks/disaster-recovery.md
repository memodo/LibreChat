# Disaster Recovery Procedure

**Spec:** SPEC-010-production-readiness (FAIL-008, REQ-046)
**Last Updated:** 2026-04-01
**Target RTO:** 4 hours for complete server failure

## Trigger

Complete server failure: hardware failure, hosting provider outage, or unrecoverable OS corruption.

External uptime monitor (REQ-031) fires alert within 5 minutes.

## Prerequisites

- Off-host backup copies (REQ-023) are accessible
- A new server with Docker and Docker Compose installed
- DNS access for domain updates
- This runbook and the config backup (REQ-022)

## Recovery Procedure

### Step 1: Provision New Server (Est: 30-60 min)

```bash
# 1. Provision a new server (same OS, Docker pre-installed)
# 2. Install Docker Compose v5.1+
# 3. Configure SSH key-only auth (REQ-047)
# 4. Install fail2ban
```

### Step 2: Restore Configuration (Est: 15 min)

```bash
# 1. Clone the repository
git clone <repo-url> /opt/librechat
cd /opt/librechat

# 2. Restore .env.prod from config backup
# (Download from off-host backup storage)
cp /path/to/config_backup/.env.prod .env.prod
cp /path/to/config_backup/librechat.yaml librechat.yaml

# 3. Create required directories
mkdir -p images uploads logs backups
```

### Step 3: Restore Data (Est: 60-120 min)

```bash
cd /opt/librechat

# 1. Start database containers (without API)
./prod.sh up -d mongodb vectordb minio

# Wait for databases to be ready
sleep 30
./prod.sh ps

# 2. Restore MongoDB
MONGO_BACKUP="/path/to/offhost/librechat_YYYYMMDD_HHMMSS.archive.gz"
docker exec -i chat-mongodb mongorestore \
  --archive --gzip \
  --username "$MONGO_ADMIN_USER" \
  --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --drop \
  < "$MONGO_BACKUP"

# 3. Restore PostgreSQL
PG_BACKUP="/path/to/offhost/rag_YYYYMMDD_HHMMSS.dump"
docker exec -i vectordb pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean --if-exists \
  < "$PG_BACKUP"

# 4. Restore MinIO
MINIO_BACKUP="/path/to/offhost/minio/YYYYMMDD_HHMMSS/"
docker run --rm \
  --network "$(docker network ls --filter name=librechat --format '{{.Name}}' | head -1)" \
  -e "MC_HOST_myminio=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  -v "${MINIO_BACKUP}:/backup:ro" \
  minio/mc:RELEASE.2025-03-12T17-29-24Z \
  mirror /backup myminio/librechat
```

### Step 4: Start Application (Est: 15-30 min)

```bash
cd /opt/librechat

# 1. Start all services
./prod.sh up -d

# 2. Wait for health checks to pass
sleep 30
./prod.sh ps

# 3. Verify API health
curl -sf http://localhost:3080/health && echo "API healthy"

# 4. MeiliSearch will auto-rebuild its index from MongoDB
# Search may be unavailable for 5-15 minutes
# Check progress: ./prod.sh logs -f meilisearch
```

### Step 5: Restore Caddy / TLS (Est: 15 min)

```bash
# Restore Caddy configuration from backup (REQ-026)
# This is in the infra repo: /opt/infra/
cd /opt/infra

# Restore caddy_data and caddy_config volumes
# If Caddy cert backup is not available, Caddy will auto-request new certs
# (may hit Let's Encrypt rate limits if domain recently had certs issued)

docker compose up -d
```

### Step 6: DNS Update (Est: 5-15 min)

If the server IP has changed:

```bash
# Update DNS A records for:
#   chat.memodo-eng.de -> NEW_IP
#   minio.memodo-eng.de -> NEW_IP (if using MinIO console)
#   grafana.memodo-eng.de -> NEW_IP (if using Grafana)
```

DNS propagation may take 5-60 minutes depending on TTL.

### Step 7: Restore Monitoring (Est: 15 min)

```bash
cd /opt/librechat
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

### Step 8: Restore Cron Jobs

```bash
crontab /opt/librechat/crontab.prod
crontab -l  # Verify
```

### Step 9: Verification Checklist

```bash
# Core services
curl -sf http://localhost:3080/health && echo "API: OK"
./prod.sh ps  # All services healthy

# Data integrity
docker exec chat-mongodb mongosh \
  --username admin --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "use LibreChat; print('conversations:', db.conversations.countDocuments({})); print('messages:', db.messages.countDocuments({}))"

# External access
# Verify https://chat.memodo-eng.de loads in browser

# Update external uptime monitor if URL/IP changed
```

## Post-Recovery

- [ ] Record actual recovery time for RTO refinement
- [ ] Run all backup scripts manually to establish a new baseline
- [ ] Verify backup cron is running: `crontab -l`
- [ ] Verify monitoring is running and scraping: check Prometheus targets
- [ ] Communicate service restoration to stakeholders
- [ ] Conduct post-incident review within 48 hours
