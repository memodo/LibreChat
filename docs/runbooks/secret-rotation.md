# Secret Rotation Procedures

**Spec:** SPEC-010-production-readiness (REQ-046)
**Last Updated:** 2026-04-01

## Rotation Cadence

| Secret | Cadence | Requires Restart? | Session Impact |
|--------|---------|-------------------|----------------|
| JWT_SECRET | Annually, or on team member departure | Yes (API) | All sessions invalidated |
| JWT_REFRESH_SECRET | Annually, or on team member departure | Yes (API) | All sessions invalidated |
| CREDS_KEY | Annually, or on team member departure | Yes (API) | Encrypted credentials re-encrypted |
| CREDS_IV | Annually, or on team member departure | Yes (API) | Encrypted credentials re-encrypted |
| MEILI_MASTER_KEY | Annually | Yes (MeiliSearch + API) | None |
| MONGO_ADMIN_PASSWORD | Annually | No (pool reconnects) | None |
| MongoDB app password | Annually | Yes (API) | None |
| POSTGRES_PASSWORD | Annually | Yes (RAG API + vectordb) | None |
| MINIO_ROOT_PASSWORD | Annually | Yes (MinIO + API) | None |
| AZURE_OPENAI_API_KEY | Per Azure policy | Yes (API) | None |

## Immediate Rotation (Team Member Departure)

Rotate ALL secrets immediately when any team member with production access departs.

## Procedure: JWT Secrets

**Impact:** All active user sessions will be invalidated. Users must re-login.

```bash
cd /opt/librechat

# 1. Generate new secrets
NEW_JWT_SECRET=$(openssl rand -hex 32)
NEW_JWT_REFRESH=$(openssl rand -hex 32)

# 2. Update .env.prod
# Edit .env.prod and replace JWT_SECRET and JWT_REFRESH_SECRET
echo "JWT_SECRET=$NEW_JWT_SECRET"
echo "JWT_REFRESH_SECRET=$NEW_JWT_REFRESH"

# 3. Restart API
./prod.sh restart api

# 4. Verify
sleep 15
curl -sf http://localhost:3080/health && echo "API healthy"
```

**Verify success:** API is healthy. Existing sessions are invalidated (expected). New login works.

## Procedure: MongoDB Credentials

**Impact:** Brief API disconnection during restart.

```bash
cd /opt/librechat

# 1. Generate new passwords
NEW_ADMIN_PASS=$(openssl rand -hex 32)
NEW_APP_PASS=$(openssl rand -hex 32)

# 2. Update MongoDB admin password
docker exec chat-mongodb mongosh \
  --username admin \
  --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.getSiblingDB('admin').changeUserPassword('admin', '$NEW_ADMIN_PASS')"

# 3. Update MongoDB application password
docker exec chat-mongodb mongosh \
  --username admin \
  --password "$NEW_ADMIN_PASS" \
  --authenticationDatabase admin \
  --eval "db.getSiblingDB('LibreChat').changeUserPassword('librechat', '$NEW_APP_PASS')"

# 4. Update .env.prod
# MONGO_ADMIN_PASSWORD=$NEW_ADMIN_PASS
# MONGO_URI=mongodb://librechat:$NEW_APP_PASS@mongodb:27017/LibreChat?authSource=LibreChat

# 5. Restart API and verify
./prod.sh restart api
sleep 15
curl -sf http://localhost:3080/health && echo "API healthy"

# 6. Update backup scripts (they read from .env.prod, so no script changes needed)
# Test a backup to verify
./scripts/backup-mongodb.sh
```

**Verify success:** API connects with new credentials. Backup completes successfully.

## Procedure: PostgreSQL Credentials

```bash
cd /opt/librechat

# 1. Generate new password
NEW_PG_PASS=$(openssl rand -hex 32)

# 2. Change password in PostgreSQL
docker exec vectordb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "ALTER USER $POSTGRES_USER PASSWORD '$NEW_PG_PASS';"

# 3. Update .env.prod (POSTGRES_PASSWORD)

# 4. Restart RAG API and vectordb
./prod.sh restart vectordb rag_api

# 5. Verify
./scripts/backup-postgres.sh
```

## Procedure: MinIO Credentials

```bash
cd /opt/librechat

# 1. Generate new credentials
NEW_MINIO_PASS=$(openssl rand -hex 32)

# 2. Update .env.prod (MINIO_ROOT_PASSWORD)

# 3. Restart MinIO and dependent services
./prod.sh restart minio minio-init api

# 4. Verify
curl -sf http://localhost:9000/minio/health/live && echo "MinIO healthy"
./scripts/backup-minio.sh
```

## Procedure: CREDS_KEY / CREDS_IV

**WARNING:** These encrypt stored API keys. Changing them requires re-entering all user-provided API keys.

```bash
cd /opt/librechat

# 1. Generate new values
NEW_CREDS_KEY=$(openssl rand -hex 32)
NEW_CREDS_IV=$(openssl rand -hex 16)

# 2. Update .env.prod

# 3. Restart API
./prod.sh restart api

# 4. Inform users they need to re-enter their API keys
```

## Post-Rotation Checklist

- [ ] Verify API health: `curl -sf http://localhost:3080/health`
- [ ] Verify backup scripts work with new credentials
- [ ] Test user login
- [ ] Update .env (dev) if dev/prod share MongoDB (REQ-053)
- [ ] Back up new .env.prod: `./scripts/backup-config.sh`
