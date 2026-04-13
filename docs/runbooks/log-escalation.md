# Log Level Escalation Procedure

**Spec:** SPEC-010-production-readiness (REQ-014-A, REQ-046)
**Last Updated:** 2026-04-01

## Purpose

During incident debugging, temporarily increase log verbosity to capture detailed diagnostic information. Debug-level logs are high-volume and must be reverted promptly.

## Constraints

- **Maximum debug duration:** 30 minutes
- **Risk:** Debug logs may rotate quickly even with log rotation enabled (PERF-004)
- **Risk:** High-volume logging can increase disk I/O and slightly degrade performance

## Escalation Procedure

### Step 1: Enable Debug Logging

```bash
cd /opt/librechat

# 1. Edit .env.prod — change LOG_LEVEL
# From: LOG_LEVEL=warn
# To:   LOG_LEVEL=debug
sed -i 's/LOG_LEVEL=warn/LOG_LEVEL=debug/' .env.prod

# 2. Restart the API container
./prod.sh restart api
```

### Step 2: Reproduce and Capture

```bash
# Follow logs in real-time
./prod.sh logs -f --tail 100 api

# Or capture to a file for analysis
./prod.sh logs --since "2m" api > /tmp/debug-logs-$(date +%Y%m%d_%H%M%S).txt
```

**Time limit:** Capture logs within 15 minutes of enabling debug mode.

### Step 3: Revert to Production Logging

**Do this immediately after capturing logs. Do NOT leave debug logging on.**

```bash
cd /opt/librechat

# 1. Revert LOG_LEVEL
# From: LOG_LEVEL=debug
# To:   LOG_LEVEL=warn
sed -i 's/LOG_LEVEL=debug/LOG_LEVEL=warn/' .env.prod

# 2. Restart API
./prod.sh restart api
```

### Step 4: Verify

```bash
# Confirm production logging is restored
./prod.sh logs --tail 5 api
# Should see only warn-level and above messages

# Verify API is healthy
curl -sf http://localhost:3080/health && echo "API healthy"
```

## Service-Specific Debug Logging

### MongoDB

```bash
# Enable MongoDB profiling for slow queries (>1s)
docker exec chat-mongodb mongosh \
  --username admin --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.setProfilingLevel(1, { slowms: 1000 })"

# Check slow query log
docker exec chat-mongodb mongosh \
  --username admin --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.system.profile.find().limit(10).sort({ts: -1}).pretty()"

# Disable profiling when done
docker exec chat-mongodb mongosh \
  --username admin --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.setProfilingLevel(0)"
```

### Docker Container Logs

```bash
# View logs for any service
./prod.sh logs --tail 100 <service-name>

# Follow logs
./prod.sh logs -f <service-name>

# Logs since a specific time
./prod.sh logs --since "2025-04-01T10:00:00" <service-name>
```

## Database Access via SSH Tunnel

For direct database inspection during debugging:

```bash
# From your local machine — create SSH tunnel to MongoDB
ssh -L 27017:localhost:27017 user@production-server

# Then connect with mongosh locally
mongosh "mongodb://admin:PASSWORD@localhost:27017/LibreChat?authSource=admin"
```
