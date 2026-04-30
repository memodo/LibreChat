#!/usr/bin/env bash
# scripts/gdpr-erase-user.sh — GDPR Article 17 erasure for a single user (REQ-048).
#
# Usage:
#   ./scripts/gdpr-erase-user.sh <email>
#   ./scripts/gdpr-erase-user.sh <email> --dry-run    # show what would be deleted
#   ./scripts/gdpr-erase-user.sh <email> --yes        # skip the final confirm
#
# Coverage:
#   [auto] MongoDB     — 21 collections via config/delete-user.js
#   [auto] MeiliSearch — convos + messages indexes (cascades from Mongo deleteMany)
#   [auto] MinIO       — per-user prefixes across every top-level basePath in the bucket
#   [auto] pgvector    — RAG embeddings, per file_id, via the RAG API DELETE endpoint
#
# Operator follow-up (NOT done by this script — see docs/runbooks/gdpr-erasure.md):
#   - Verify the data subject's identity before invoking this script.
#   - Record the erasure in your compliance tracker; this script writes a local
#     audit file but does not push to any external system.
#   - Off-host backups (S3 / rsync) retain the user's data until their retention
#     window expires (default 30 days). Disclose this to the data subject —
#     GDPR Recital 26 allows backup-only retention with a documented schedule.
#   - MinIO console-created users/policies are out of scope.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env.prod"
AUDIT_DIR="${PROJECT_DIR}/backups/gdpr"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

API_CONTAINER="LibreChat"
MONGO_CONTAINER="chat-mongodb"
MINIO_HOST="minio:9000"
MC_IMAGE="minio/mc:RELEASE.2025-03-12T17-29-24Z"

# ---------- arg parsing ----------
EMAIL="${1:-}"
DRY_RUN=0
SKIP_CONFIRM=0
shift || true
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) SKIP_CONFIRM=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$EMAIL" ]; then
  echo "Usage: $0 <email> [--dry-run] [--yes]" >&2
  exit 2
fi

# ---------- helpers ----------
log() { echo "[$(date -Iseconds)] $*"; }
fail() { echo "[$(date -Iseconds)] ERROR: $*" >&2; exit 1; }

# Read a single key from .env.prod without sourcing it (handles values with
# shell-special chars and avoids collisions with bash readonly built-ins).
get_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

mongo_eval() {
  local script="$1"
  docker exec "$MONGO_CONTAINER" mongosh --quiet \
    --username "$LIBRECHAT_MONGO_USER" \
    --password "$LIBRECHAT_MONGO_PASSWORD" \
    --authenticationDatabase LibreChat \
    --eval "$script"
}

# ---------- pre-flight ----------
[ -f "$ENV_FILE" ] || fail ".env.prod not found at $ENV_FILE"

LIBRECHAT_MONGO_USER="$(get_env LIBRECHAT_MONGO_USER)"
LIBRECHAT_MONGO_PASSWORD="$(get_env LIBRECHAT_MONGO_PASSWORD)"
MINIO_ROOT_USER="$(get_env MINIO_ROOT_USER)"
MINIO_ROOT_PASSWORD="$(get_env MINIO_ROOT_PASSWORD)"
AWS_BUCKET_NAME="$(get_env AWS_BUCKET_NAME)"
AWS_BUCKET_NAME="${AWS_BUCKET_NAME:-librechat}"

[ -n "$LIBRECHAT_MONGO_PASSWORD" ] || fail "LIBRECHAT_MONGO_PASSWORD missing in .env.prod"
[ -n "$MINIO_ROOT_PASSWORD" ]      || fail "MINIO_ROOT_PASSWORD missing in .env.prod"

docker ps --format '{{.Names}}' | grep -q "^${API_CONTAINER}$" \
  || fail "API container '$API_CONTAINER' is not running"
docker ps --format '{{.Names}}' | grep -q "^${MONGO_CONTAINER}$" \
  || fail "Mongo container '$MONGO_CONTAINER' is not running"

NETWORK="$(docker inspect "$MONGO_CONTAINER" \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)"
[ -n "$NETWORK" ] || fail "Could not detect Docker network from $MONGO_CONTAINER"

mkdir -p "$AUDIT_DIR"
SAFE_EMAIL="$(echo "$EMAIL" | tr -c 'a-zA-Z0-9._-' '_')"
AUDIT_FILE="${AUDIT_DIR}/${TIMESTAMP}_${SAFE_EMAIL}.log"
exec > >(tee -a "$AUDIT_FILE") 2>&1

log "GDPR erasure starting"
log "  email:       $EMAIL"
log "  dry-run:     $DRY_RUN"
log "  audit file:  $AUDIT_FILE"
log "  bucket:      $AWS_BUCKET_NAME"
log "  network:     $NETWORK"

# ---------- 1. Look up user and capture file_ids ----------
log "Step 1: Looking up user and capturing file metadata"

USER_DOC="$(mongo_eval "
  const u = db.getSiblingDB('LibreChat').users.findOne(
    {email: '$EMAIL'.toLowerCase()},
    {_id:1, email:1, name:1}
  );
  print(JSON.stringify(u));
")"

if [ "$USER_DOC" = "null" ] || [ -z "$USER_DOC" ]; then
  log "No user found for email '$EMAIL' — nothing to do."
  exit 0
fi

USER_ID="$(echo "$USER_DOC" | sed -n 's/.*"_id":"\([^"]*\)".*/\1/p')"
[ -n "$USER_ID" ] || fail "Failed to parse _id from: $USER_DOC"
log "  user._id: $USER_ID"

FILES_JSON="$(mongo_eval "
  print(JSON.stringify(
    db.getSiblingDB('LibreChat').files.find(
      {user: '$USER_ID'},
      {_id:0, file_id:1, embedded:1, source:1}
    ).toArray()
  ));
")"
log "  files captured: $(echo "$FILES_JSON" | tr ',' '\n' | grep -c file_id || echo 0)"

# ---------- 2. Confirm with operator ----------
if [ "$SKIP_CONFIRM" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
  echo
  echo "About to ERASE all data for user: $EMAIL ($USER_ID)"
  echo "This is irreversible. Audit log: $AUDIT_FILE"
  read -r -p "Type the email again to confirm: " CONFIRM
  if [ "$CONFIRM" != "$EMAIL" ]; then
    log "Confirmation mismatch. Aborting."
    exit 1
  fi
fi

# ---------- 3. Mongo cleanup (delegate to delete-user.js) ----------
log "Step 2: MongoDB cleanup via config/delete-user.js"
if [ "$DRY_RUN" -eq 1 ]; then
  log "  [dry-run] would run: docker exec -i $API_CONTAINER npm run delete-user -- $EMAIL"
else
  # Pre-feed both prompts: "y" to delete user, "y" to also delete transactions.
  printf 'y\ny\n' \
    | docker exec -i "$API_CONTAINER" npm run delete-user -- "$EMAIL"
fi

# ---------- 4. RAG API cleanup (pgvector embeddings) ----------
log "Step 3: pgvector cleanup via RAG API DELETE /documents"

EMBEDDED_FILE_IDS="$(echo "$FILES_JSON" \
  | python3 -c '
import sys, json
data = json.loads(sys.stdin.read() or "[]")
ids = [f["file_id"] for f in data if f.get("embedded") and f.get("file_id")]
print(" ".join(ids))
' 2>/dev/null || echo "")"

if [ -z "$EMBEDDED_FILE_IDS" ]; then
  log "  no embedded files for this user — skipping RAG deletion"
else
  log "  embedded file_ids: $EMBEDDED_FILE_IDS"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "  [dry-run] would call RAG API DELETE for each file_id above"
  else
    # Mint a short-lived JWT inside the API container (same path the app uses,
    # via the bundled jsonwebtoken lib — no shell-side HMAC plumbing required).
    JWT="$(docker exec "$API_CONTAINER" node -e "
      const jwt = require('jsonwebtoken');
      console.log(jwt.sign({id: process.argv[1]}, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '5m'
      }));
    " "$USER_ID")"
    [ -n "$JWT" ] || fail "Failed to mint JWT inside $API_CONTAINER"

    # Build a JSON array of file_ids and call the RAG API from inside the network.
    FILE_IDS_JSON="$(printf '%s\n' $EMBEDDED_FILE_IDS \
      | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"

    docker run --rm --network "$NETWORK" \
      -e "JWT=$JWT" \
      -e "PAYLOAD=$FILE_IDS_JSON" \
      curlimages/curl:latest \
      -sS -X DELETE "http://rag_api:8000/documents" \
        -H "Authorization: Bearer $JWT" \
        -H "Content-Type: application/json" \
        -H "accept: application/json" \
        -d "$FILE_IDS_JSON" \
      || log "  WARN: RAG API call returned non-zero — investigate (see runbook §Edge cases)"
  fi
fi

# ---------- 5. MinIO cleanup ----------
log "Step 4: MinIO cleanup — removing all per-user prefixes from bucket '$AWS_BUCKET_NAME'"

MC_RUN=(docker run --rm --network "$NETWORK"
  -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@${MINIO_HOST}"
  "$MC_IMAGE")

# Enumerate top-level basePaths in the bucket. LibreChat uses 'images' by
# default but other code paths pass 'files', 'documents', etc. Removing every
# <basePath>/<USER_ID>/ is robust to that variation.
BASE_PATHS="$("${MC_RUN[@]}" --json ls "local/${AWS_BUCKET_NAME}/" 2>/dev/null \
  | python3 -c '
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
    except Exception:
        continue
    key = d.get("key", "")
    if key.endswith("/"):
        print(key.rstrip("/"))
' || echo "")"

if [ -z "$BASE_PATHS" ]; then
  log "  bucket has no top-level prefixes — nothing to remove"
else
  while IFS= read -r bp; do
    [ -z "$bp" ] && continue
    TARGET="local/${AWS_BUCKET_NAME}/${bp}/${USER_ID}/"
    if [ "$DRY_RUN" -eq 1 ]; then
      log "  [dry-run] would: mc rm --recursive --force $TARGET"
    else
      log "  removing: $TARGET"
      "${MC_RUN[@]}" rm --recursive --force "$TARGET" 2>&1 | sed 's/^/    /' \
        || log "  (no objects under $TARGET — already clean)"
    fi
  done <<< "$BASE_PATHS"
fi

# ---------- 6. Verification ----------
log "Step 5: Verification"

if [ "$DRY_RUN" -eq 1 ]; then
  log "  [dry-run] verification skipped"
else
  log "  Mongo collection counts (expect all 0):"
  mongo_eval "
    const lc = db.getSiblingDB('LibreChat');
    const uid = '$USER_ID';
    const checks = [
      ['users',           {_id: ObjectId(uid)}],
      ['conversations',   {user: uid}],
      ['messages',        {user: uid}],
      ['files',           {user: uid}],
      ['transactions',    {user: uid}],
      ['sessions',        {user: uid}],
      ['balances',        {user: uid}],
      ['agents',          {author: uid}],
      ['presets',         {user: uid}],
      ['memoryentries',   {userId: uid}],
      ['pluginauths',     {userId: uid}],
      ['tokens',          {userId: uid}],
      ['sharedlinks',     {user: uid}],
    ];
    checks.forEach(([c,q]) => print('    ' + c + ': ' + lc.getCollection(c).countDocuments(q)));
    print('    groups containing uid: ' + lc.groups.countDocuments({memberIds: uid}));
  "

  log "  MinIO objects under user prefix (expect none):"
  REMAINING="$("${MC_RUN[@]}" --json ls --recursive "local/${AWS_BUCKET_NAME}/" 2>/dev/null \
    | python3 -c "
import sys, json
uid = '$USER_ID'
hits = []
for line in sys.stdin:
    try:
        d = json.loads(line)
    except Exception:
        continue
    key = d.get('key', '')
    if '/' + uid + '/' in '/' + key:
        hits.append(key)
print('\n'.join(hits))
" || true)"
  if [ -z "$REMAINING" ]; then
    log "    (clean)"
  else
    log "    LEFTOVER OBJECTS — manual cleanup needed:"
    echo "$REMAINING" | sed 's/^/      /'
  fi
fi

log "Done. Audit log: $AUDIT_FILE"
log "Next steps (operator):"
log "  - Record erasure in your compliance tracker"
log "  - Notify the data subject; disclose backup retention window"
log "  - See docs/runbooks/gdpr-erasure.md for the full procedure"
