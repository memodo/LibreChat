# PII Detection Override Procedures

**Spec:** SPEC-010-production-readiness (REQ-041-A)
**Last Updated:** 2026-04-01

## Overview

PII detection uses the Redakt API to scan messages for personally identifiable information.
- **Warn mode** (initial default): PII is detected and logged, but messages are not blocked.
- **Fail-open** (initial default): If Redakt is unavailable, messages pass through unscanned.
- **Fail-closed** (future state): If Redakt is unavailable, ALL messages are blocked.

## Authorization

Only the following roles may execute PII overrides:
- System administrators with production SSH access
- Designated on-call engineers

All overrides must be communicated to the team lead within 1 hour.

## Procedure 1: Switch from Fail-Closed to Fail-Open

**When:** Redakt API is down and users cannot send messages.

```bash
cd /opt/librechat

# 1. Edit .env.prod
# Change: PII_DETECTION_FAIL_OPEN=true
sed -i 's/PII_DETECTION_FAIL_OPEN=false/PII_DETECTION_FAIL_OPEN=true/' .env.prod

# 2. Restart API
./prod.sh restart api

# 3. Verify messages can be sent
sleep 15
curl -sf http://localhost:3080/health && echo "API healthy"
```

**Verify success:** Users can send messages. PII events are NOT logged (Redakt is down).

**Communicate:** "PII scanning is temporarily degraded. Messages are not being scanned for PII. The team is working to restore the PII detection service."

## Procedure 2: Disable PII Detection Entirely

**When:** Redakt API is persistently failing or causing performance issues even in fail-open mode.

```bash
cd /opt/librechat

# 1. Edit .env.prod
# Change: PII_DETECTION=false
sed -i 's/PII_DETECTION=true/PII_DETECTION=false/' .env.prod

# 2. Restart API
./prod.sh restart api

# 3. Verify
sleep 15
curl -sf http://localhost:3080/health && echo "API healthy"
```

**Verify success:** API healthy. No PII-related errors in logs.

**Communicate:** "PII detection has been temporarily disabled due to a service issue. The team is investigating. Messages are not being scanned for PII."

## Procedure 3: Re-enable After Redakt Recovery

```bash
cd /opt/librechat

# 1. Verify Redakt is healthy
./prod.sh ps redakt-api
# Should show "Up" with "(healthy)"

# 2. Re-enable PII detection
# Edit .env.prod:
#   PII_DETECTION=true
#   PII_DETECTION_FAIL_OPEN=true  (or false if criteria are met)

# 3. Restart API
./prod.sh restart api

# 4. Verify PII detection is working
sleep 15
./prod.sh logs --tail 20 api | grep -i pii
```

**Verify success:** API logs show PII detection is active. Test by sending a message containing a test SSN or email.

**Communicate:** "PII detection has been restored. All messages are being scanned."

## Criteria for Switching to Fail-Closed

Do NOT switch `PII_DETECTION_FAIL_OPEN=false` until ALL of the following are true:

1. Redakt API has demonstrated >99.5% uptime over 30 days in production
2. This override procedure has been tested and is understood by the ops team
3. The Redakt health alert (REQ-032) is confirmed working and has fired correctly in a test
4. Stakeholder sign-off has been obtained

## Feature Interaction Matrix (EDGE-017)

| Event | Counts as Ban Violation? |
|-------|-------------------------|
| PII block (HTTP 400) | NO — PII blocks use a specific error type that the violation system ignores |
| Rate limit rejection (HTTP 429) | YES — indicates potential abuse |
| Token balance exhausted | NO — expected behavior |
| Message content violation | YES — standard violation handling |
