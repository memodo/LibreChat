#!/usr/bin/env bash
# scripts/mongodb-auth-migration.sh — MongoDB Authentication Migration (REQ-006)
#
# MANUAL PROCEDURE — Do NOT run this script unattended.
# Follow each step carefully. Read comments before executing.
#
# Prerequisites:
#   - MongoDB is running with --noauth (current state)
#   - You have generated passwords (see .env.prod.template)
#   - Backup scripts/cron are DISABLED (EDGE-012)
#   - A full manual backup has been taken
#
# Rollback:
#   If anything goes wrong, remove `command: mongod --auth --bind_ip_all`
#   from docker-compose.prod.yml and restart: ./prod.sh restart mongodb

set -euo pipefail

echo "============================================================"
echo "  MongoDB Authentication Migration"
echo "  REQ-006 — SPEC-010-production-readiness"
echo "============================================================"
echo ""
echo "This is a MANUAL procedure. Follow each step carefully."
echo "Press Ctrl+C at any time to abort."
echo ""

# ---------------------------------------------------------------------------
# Configuration — EDIT THESE before running
# ---------------------------------------------------------------------------
ADMIN_USER="admin"
ADMIN_PASSWORD=""  # Generate with: openssl rand -hex 32
LIBRECHAT_USER="librechat"
LIBRECHAT_PASSWORD=""  # Generate with: openssl rand -hex 32

MONGO_CONTAINER="chat-mongodb"

if [ -z "$ADMIN_PASSWORD" ] || [ -z "$LIBRECHAT_PASSWORD" ]; then
  echo "ERROR: You must edit this script and set ADMIN_PASSWORD and LIBRECHAT_PASSWORD"
  echo "       Generate with: openssl rand -hex 32"
  exit 1
fi

echo "Step 1: Verify MongoDB is running without auth"
echo "----------------------------------------------"
echo "Running: docker exec $MONGO_CONTAINER mongosh --eval \"db.adminCommand('ping')\""
docker exec "$MONGO_CONTAINER" mongosh --quiet --eval "db.adminCommand('ping')"
echo ""
echo "If the above shows { ok: 1 }, MongoDB is accessible without auth. Continue."
read -rp "Press Enter to continue or Ctrl+C to abort... "

echo ""
echo "Step 2: Create admin user in the 'admin' database"
echo "--------------------------------------------------"
echo "This creates the root admin user for database administration and health checks."
docker exec "$MONGO_CONTAINER" mongosh --quiet --eval "
  use admin;
  db.createUser({
    user: '$ADMIN_USER',
    pwd: '$ADMIN_PASSWORD',
    roles: [
      { role: 'root', db: 'admin' }
    ]
  });
  print('Admin user created successfully.');
"
echo ""

echo "Step 3: Create application user in the 'LibreChat' database"
echo "-----------------------------------------------------------"
echo "This creates the user that LibreChat uses to connect."
docker exec "$MONGO_CONTAINER" mongosh --quiet --eval "
  use LibreChat;
  db.createUser({
    user: '$LIBRECHAT_USER',
    pwd: '$LIBRECHAT_PASSWORD',
    roles: [
      { role: 'readWrite', db: 'LibreChat' }
    ]
  });
  print('LibreChat application user created successfully.');
"
echo ""

echo "Step 4: Update .env.prod"
echo "------------------------"
echo "Update these values in .env.prod:"
echo ""
echo "  MONGO_ADMIN_USER=$ADMIN_USER"
echo "  MONGO_ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "  MONGO_URI=mongodb://$LIBRECHAT_USER:$LIBRECHAT_PASSWORD@mongodb:27017/LibreChat?authSource=LibreChat"
echo ""
read -rp "Press Enter after updating .env.prod... "

echo ""
echo "Step 5: Enable authentication"
echo "-----------------------------"
echo "Verify that docker-compose.prod.yml has:"
echo "  mongodb:"
echo "    command: mongod --auth --bind_ip_all"
echo ""
echo "This should already be set in docker-compose.prod.yml."
read -rp "Press Enter to continue... "

echo ""
echo "Step 6: Restart MongoDB with authentication"
echo "--------------------------------------------"
echo "Running: ./prod.sh restart mongodb"
./prod.sh restart mongodb
echo ""
echo "Waiting 10 seconds for MongoDB to start..."
sleep 10

echo ""
echo "Step 7: Verify authentication works"
echo "------------------------------------"
echo "Testing admin connection..."
docker exec "$MONGO_CONTAINER" mongosh --quiet \
  --username "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping')"

echo ""
echo "Testing application connection..."
docker exec "$MONGO_CONTAINER" mongosh --quiet \
  --username "$LIBRECHAT_USER" \
  --password "$LIBRECHAT_PASSWORD" \
  --authenticationDatabase LibreChat \
  --eval "use LibreChat; db.conversations.countDocuments({})"

echo ""
echo "Step 8: Restart the API to pick up new MONGO_URI"
echo "-------------------------------------------------"
echo "Running: ./prod.sh restart api"
./prod.sh restart api
echo ""
echo "Waiting 15 seconds for API to start..."
sleep 15

echo ""
echo "Step 9: Verify API health"
echo "-------------------------"
docker exec LibreChat curl -sf http://localhost:3080/health && echo " — API is healthy" || echo " — API health check FAILED"

echo ""
echo "Step 10: Re-enable backup scripts"
echo "----------------------------------"
echo "Update backup scripts with new credentials and re-enable cron."
echo "Test each backup script manually before re-enabling cron."
echo ""
echo "  ./scripts/backup-mongodb.sh"
echo "  ./scripts/backup-minio.sh"
echo "  ./scripts/backup-postgres.sh"
echo "  ./scripts/backup-config.sh"
echo ""

echo "============================================================"
echo "  Migration Complete"
echo "============================================================"
echo ""
echo "REQ-053: Dev .env configuration drift"
echo "--------------------------------------"
echo "MongoDB now requires authentication. Choose one:"
echo "  (a) Update .env with the same credentials (simplest if dev/prod share MongoDB)"
echo "  (b) Run a separate unauthenticated MongoDB for development on a different port"
echo "Document your choice."
