# Service Restart Procedures

**Spec:** SPEC-010-production-readiness (REQ-046)
**Last Updated:** 2026-04-01

## Prerequisites

- SSH access to production server
- Docker permissions (user in `docker` group)
- Location: `/opt/librechat` (or your project root)

## Restart a Single Service

```bash
cd /opt/librechat

# Restart a specific service
./prod.sh restart api
./prod.sh restart mongodb
./prod.sh restart meilisearch
./prod.sh restart vectordb
./prod.sh restart rag_api
./prod.sh restart minio
./prod.sh restart redakt-api
```

**Verify success:**
```bash
./prod.sh ps
# All services should show "Up" with "(healthy)" status
```

## Restart All Services

```bash
./prod.sh down
./prod.sh up -d
```

**Verify success:**
```bash
./prod.sh ps
curl -sf http://localhost:3080/health && echo "API healthy"
```

## Service-Specific Notes

### API (LibreChat)

- Restart invalidates in-flight requests (streaming responses will fail)
- Health check: `curl -f http://localhost:3080/health`
- Typical startup time: 15-30 seconds
- If API fails to start, check logs: `./prod.sh logs --tail 50 api`

### MongoDB

- Restart disconnects all active database connections
- API will automatically reconnect via connection pool
- After restart, verify: `./prod.sh exec mongodb mongosh --username "$MONGO_ADMIN_USER" --password "$MONGO_ADMIN_PASSWORD" --authenticationDatabase admin --eval "db.adminCommand('ping')"`
- If MongoDB fails to start, check for lock files: `ls -la data-node/mongod.lock`

### MeiliSearch

- Search functionality is unavailable during restart
- If index corruption occurs, delete `meili_data_v1.35.1/` and MeiliSearch will rebuild from MongoDB data
- Rebuild time depends on data volume (estimate: 5-15 minutes for typical deployment)

### MinIO

- File uploads and downloads are unavailable during restart
- Active file transfers will fail
- Health check: `curl -f http://localhost:9000/minio/health/live`

### Redakt API (PII Detection)

- PII detection is unavailable during restart
- In fail-open mode: messages pass through unscanned
- In fail-closed mode: ALL messages are blocked until Redakt recovers
- See [PII Override Runbook](pii-override.md) for emergency procedures

## Troubleshooting

### Container stuck in "Restarting" loop

```bash
# Check logs for the failing container
./prod.sh logs --tail 100 <service-name>

# Check resource usage
docker stats --no-stream

# Force recreate the container
./prod.sh up -d --force-recreate <service-name>
```

### Out of Memory (OOM)

```bash
# Check if OOM killed
docker inspect <container-name> --format '{{.State.OOMKilled}}'

# Check current memory usage
docker stats --no-stream

# If needed, increase memory limit in docker-compose.prod.yml
# then: ./prod.sh up -d <service-name>
```
