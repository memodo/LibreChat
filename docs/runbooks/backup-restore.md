# Backup and Restore Procedures

**Spec:** SPEC-010-production-readiness (REQ-024, REQ-046)
**Last Updated:** 2026-04-01

## Backup Schedule

| Data Store   | Frequency | Script                       | Retention |
|-------------|-----------|------------------------------|-----------|
| MongoDB     | Daily 2AM | `scripts/backup-mongodb.sh`  | 30 days   |
| MinIO       | Daily 2:30AM | `scripts/backup-minio.sh` | 30 days   |
| PostgreSQL  | Weekly Sun 3AM | `scripts/backup-postgres.sh` | 30 days |
| Config      | Daily 3:30AM | `scripts/backup-config.sh` | 30 days  |

Backups are stored in `./backups/<type>/` with timestamp naming.

## Manual Backup (Before Maintenance)

Run all backup scripts manually before any maintenance:

```bash
cd /opt/librechat
./scripts/backup-mongodb.sh
./scripts/backup-minio.sh
./scripts/backup-postgres.sh
./scripts/backup-config.sh
```

**Verify success:** Each script prints a completion message with file size.

## Restore: MongoDB

**RTO:** < 1 hour for single-service recovery

```bash
cd /opt/librechat

# 1. List available backups
ls -lht backups/mongodb/

# 2. Stop the API to prevent writes during restore
./prod.sh stop api

# 3. Restore from archive (replace TIMESTAMP with actual filename)
BACKUP_FILE="backups/mongodb/librechat_20260401_020000.archive.gz"
docker exec -i chat-mongodb mongorestore \
  --archive --gzip \
  --username "$MONGO_ADMIN_USER" \
  --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --drop \
  < "$BACKUP_FILE"

# 4. Verify data integrity
docker exec chat-mongodb mongosh \
  --username "$MONGO_ADMIN_USER" \
  --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "use LibreChat; db.conversations.countDocuments({}); db.messages.countDocuments({})"

# 5. Trigger MeiliSearch re-index
# MeiliSearch will automatically sync from MongoDB on API restart.
# Search is unavailable during re-indexing (estimate: 5-15 minutes).

# 6. Restart the API
./prod.sh start api

# 7. Verify API health
sleep 15
curl -sf http://localhost:3080/health && echo "API healthy"
```

## Restore: PostgreSQL (RAG API)

```bash
cd /opt/librechat

# 1. List available backups
ls -lht backups/postgres/

# 2. Stop the RAG API
./prod.sh stop rag_api

# 3. Restore from dump (replace TIMESTAMP)
BACKUP_FILE="backups/postgres/rag_20260401_030000.dump"
docker exec -i vectordb pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean --if-exists \
  < "$BACKUP_FILE"

# 4. Verify
docker exec vectordb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM langchain_pg_embedding;"

# 5. Restart RAG API
./prod.sh start rag_api
```

## Restore: MinIO

```bash
cd /opt/librechat

# 1. List available backups
ls -lht backups/minio/

# 2. Restore using mc mirror (replace TIMESTAMP)
BACKUP_DIR="backups/minio/20260401_023000"
docker run --rm \
  --network "$(docker inspect chat-mongodb --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)" \
  -e "MC_HOST_myminio=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  -v "$(pwd)/${BACKUP_DIR}:/backup:ro" \
  minio/mc:RELEASE.2025-03-12T17-29-24Z \
  mirror /backup myminio/librechat

# 3. Verify
docker run --rm \
  --network "$(docker inspect chat-mongodb --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)" \
  -e "MC_HOST_myminio=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  minio/mc:RELEASE.2025-03-12T17-29-24Z \
  ls myminio/librechat/ | head -20
```

## Restore: Configuration

```bash
cd /opt/librechat

# 1. List available config backups
ls -lht backups/config/

# 2. Extract to a temporary directory first (do NOT overwrite in-place blindly)
BACKUP_FILE="backups/config/config_20260401_033000.tar.gz"
mkdir -p /tmp/config-restore
tar -xzf "$BACKUP_FILE" -C /tmp/config-restore

# 3. Review and selectively copy what you need
ls -la /tmp/config-restore/
diff /tmp/config-restore/.env.prod .env.prod

# 4. Copy files as needed
cp /tmp/config-restore/.env.prod .env.prod
cp /tmp/config-restore/librechat.yaml librechat.yaml

# 5. Restart services
./prod.sh up -d
```

## Backup Failure Troubleshooting

Check backup logs:
```bash
tail -50 backups/mongodb-backup.log
tail -50 backups/minio-backup.log
tail -50 backups/postgres-backup.log
tail -50 backups/config-backup.log
```

Common causes:
- **Disk full:** `df -h` — prune old backups or expand disk
- **Authentication error:** Credentials in .env.prod don't match database
- **Container not running:** `./prod.sh ps` — restart the service first
