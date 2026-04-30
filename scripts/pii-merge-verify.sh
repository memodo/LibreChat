#!/bin/sh
# pii-merge-verify.sh — Static structural checks for the PII customization.
#
# Runs the section-2 (high-risk file) and section-6 (owned files) checks from
# docs/pii-merge-checklist.md. Catches the case where a merge from main shifts,
# removes, or alphabetically displaces our middleware insertions before tests
# spend minutes proving the same thing.
#
# Exits non-zero on any failure. All checks run regardless of earlier failures
# so you see the full damage in one pass.

set -u

FAILURES=0

fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

pass() {
  printf '  \033[32m✓\033[0m %s\n' "$1"
}

# Assert that $file contains the literal string $needle.
assert_contains() {
  file="$1"
  needle="$2"
  label="$3"
  if [ ! -f "$file" ]; then
    fail "$label — $file missing"
    return
  fi
  if grep -qF -- "$needle" "$file"; then
    pass "$label"
  else
    fail "$label — \"$needle\" not found in $file"
  fi
}

# Assert that the last occurrence of $before precedes the last occurrence of
# $after in $file. We use the last occurrence because anchors like
# "validateModel," appear both in the import block and again in the route
# chain, and we care about ordering inside the chain. Both args are literal.
assert_order() {
  file="$1"
  before="$2"
  after="$3"
  label="$4"
  if [ ! -f "$file" ]; then
    fail "$label — $file missing"
    return
  fi
  line_before=$(grep -nF -- "$before" "$file" | tail -1 | cut -d: -f1)
  line_after=$(grep -nF -- "$after" "$file" | tail -1 | cut -d: -f1)
  if [ -z "$line_before" ] || [ -z "$line_after" ]; then
    fail "$label — could not locate ordering anchors in $file"
    return
  fi
  if [ "$line_before" -lt "$line_after" ]; then
    pass "$label"
  else
    fail "$label — \"$before\" (line $line_before) should come before \"$after\" (line $line_after)"
  fi
}

assert_exists() {
  file="$1"
  label="$2"
  if [ -e "$file" ]; then
    pass "$label"
  else
    fail "$label — $file missing"
  fi
}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1

echo ""
echo "▶ Section 2: route middleware chains"

F="api/server/routes/agents/chat.js"
assert_contains "$F" "createDetectPII({ responseFormat: 'sse' })" "agents/chat.js declares createDetectPII (SSE)"
assert_order "$F" "router.use(moderateText)" "router.use(createDetectPII" "agents/chat.js mounts createDetectPII after moderateText"

F="api/server/routes/assistants/chatV1.js"
assert_contains "$F" "createDetectPII({ responseFormat: 'sse' })" "assistants/chatV1.js declares createDetectPII (SSE)"
assert_contains "$F" "sendPiiWarning" "assistants/chatV1.js declares sendPiiWarning"
assert_order "$F" "createDetectPII({ responseFormat: 'sse' })" "validateModel," "assistants/chatV1.js places createDetectPII before validateModel"
assert_order "$F" "setHeaders," "sendPiiWarning," "assistants/chatV1.js places sendPiiWarning after setHeaders"

F="api/server/routes/assistants/chatV2.js"
assert_contains "$F" "createDetectPII({ responseFormat: 'sse' })" "assistants/chatV2.js declares createDetectPII (SSE)"
assert_contains "$F" "sendPiiWarning" "assistants/chatV2.js declares sendPiiWarning"
assert_order "$F" "createDetectPII({ responseFormat: 'sse' })" "validateModel," "assistants/chatV2.js places createDetectPII before validateModel"
assert_order "$F" "setHeaders," "sendPiiWarning," "assistants/chatV2.js places sendPiiWarning after setHeaders"

F="api/server/routes/agents/openai.js"
assert_contains "$F" "createDetectPII({ responseFormat: 'json', isApiRoute: true })" "agents/openai.js declares createDetectPII (JSON)"
assert_order "$F" "router.use(checkRemoteAgentsFeature)" "createDetectPII({ responseFormat: 'json', isApiRoute: true })" "agents/openai.js places createDetectPII after checkRemoteAgentsFeature"

F="api/server/routes/agents/responses.js"
assert_contains "$F" "createDetectPII({ responseFormat: 'json', isApiRoute: true })" "agents/responses.js declares createDetectPII (JSON)"
assert_order "$F" "router.use(checkRemoteAgentsFeature)" "createDetectPII({ responseFormat: 'json', isApiRoute: true })" "agents/responses.js places createDetectPII after checkRemoteAgentsFeature"

echo ""
echo "▶ Section 2: middleware registry"

F="api/server/middleware/index.js"
assert_contains "$F" "require('./detectPII')" "middleware/index.js requires ./detectPII"
assert_contains "$F" "createDetectPII" "middleware/index.js exports createDetectPII"
assert_contains "$F" "sendPiiWarning" "middleware/index.js exports sendPiiWarning"

echo ""
echo "▶ Section 2: client SSE hooks"

F="client/src/hooks/SSE/useResumableSSE.ts"
assert_contains "$F" "useToastContext" "useResumableSSE.ts imports useToastContext"
assert_contains "$F" "data.warning" "useResumableSSE.ts handles data.warning"

F="client/src/hooks/SSE/useSSE.ts"
assert_contains "$F" "useToastContext" "useSSE.ts imports useToastContext"
assert_contains "$F" "data.warning" "useSSE.ts handles data.warning"

echo ""
echo "▶ Section 2: package files"

assert_contains "packages/data-provider/src/config.ts" "PII_DETECTION = 'pii_detection'" "data-provider config.ts has PII_DETECTION ErrorType"
assert_contains "packages/data-schemas/src/models/index.ts" "createGuardrailEventModel" "data-schemas models/index.ts wires GuardrailEvent"

echo ""
echo "▶ Section 2: admin & reporting"

F="api/server/routes/admin/usage.js"
assert_contains "$F" "/guardrail-events" "admin/usage.js exposes /guardrail-events"
assert_contains "$F" "/guardrail-summary" "admin/usage.js exposes /guardrail-summary"
assert_contains "$F" "/conversation/:conversationId" "admin/usage.js exposes /conversation/:conversationId"

assert_contains "api/server/routes/index.js" "adminUsage" "routes/index.js imports/exports adminUsage"
assert_contains "api/server/index.js" "app.use('/api/admin/usage', routes.adminUsage)" "server/index.js mounts /api/admin/usage"

F="client/src/routes/index.tsx"
assert_contains "$F" "AdminConversationViewer" "client routes/index.tsx wires AdminConversationViewer"
assert_contains "$F" "admin/conversation/:conversationId" "client routes/index.tsx registers conversation viewer route"

echo ""
echo "▶ Section 6: files we own exist"

assert_exists "api/server/middleware/detectPII.js" "middleware: detectPII.js"
assert_exists "api/server/middleware/__tests__/detectPII.spec.js" "test: detectPII.spec.js"
assert_exists "api/server/routes/__tests__/pii-middleware-chain.spec.js" "test: pii-middleware-chain.spec.js"
assert_exists "e2e/specs/pii-detection.spec.ts" "e2e: pii-detection.spec.ts"
assert_exists "client/src/components/Admin/Reporting/GuardrailEventsSection.tsx" "client: GuardrailEventsSection.tsx"
assert_exists "client/src/components/Admin/Reporting/AdminConversationViewer.tsx" "client: AdminConversationViewer.tsx"
assert_exists "packages/data-schemas/src/schema/guardrailEvent.ts" "schema: guardrailEvent.ts"
assert_exists "packages/data-schemas/src/models/guardrailEvent.ts" "model: guardrailEvent.ts"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "┌──────────────────────────────────────────────────────┐"
  printf "│  ✗ PII STRUCTURAL CHECKS FAILED (%d failure(s))       │\n" "$FAILURES"
  echo "│                                                      │"
  echo "│  The merge likely shifted, removed, or displaced     │"
  echo "│  our PII middleware. See docs/pii-merge-checklist.md │"
  echo "│  sections 2 and 4 for resolution guidance.           │"
  echo "└──────────────────────────────────────────────────────┘"
  exit 1
fi

echo "  ✓ All structural checks passed"
exit 0
