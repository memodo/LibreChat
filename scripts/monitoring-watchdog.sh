#!/usr/bin/env bash
# scripts/monitoring-watchdog.sh — Monitoring health watchdog (REQ-027-A)
#
# Simple cron-based watchdog that checks if Prometheus, Grafana, and
# Alertmanager are healthy. Runs every 5 minutes via crontab.prod.
# Independent of the Prometheus alerting pipeline — prevents silent
# monitoring failure.
#
# Uses localhost port bindings (127.0.0.1:PORT) for Prometheus and Grafana
# health checks. Falls back to docker inspect if curl fails.
#
# If a service is unhealthy for >5 minutes (detected across consecutive runs),
# sends a notification via webhook or logs the failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STATE_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date -Iseconds)"

# Create state directory if needed
mkdir -p "$STATE_DIR"

# Share the Teams webhook URL with Alertmanager (single secret file). Read it
# directly rather than going through Alertmanager — the watchdog must still
# reach Teams when the Alertmanager pipeline itself is down.
WEBHOOK_FILE="${PROJECT_DIR}/monitoring/alertmanager/secrets/teams-webhook-url"
if [ -f "$WEBHOOK_FILE" ]; then
  WEBHOOK_URL=$(tr -d '\n\r' < "$WEBHOOK_FILE")
else
  WEBHOOK_URL=""
fi

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

send_alert() {
  local message="$1"
  echo "[$TIMESTAMP] ALERT: $message"

  if [ -n "$WEBHOOK_URL" ]; then
    local msg ts payload
    msg=$(json_escape "$message")
    ts=$(json_escape "$TIMESTAMP")
    # Power Automate Workflows ignore {"text": ...} — Adaptive Card required.
    payload=$(cat <<EOF
{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"\$schema":"http://adaptivecards.io/schemas/adaptive-card.json","type":"AdaptiveCard","version":"1.4","body":[{"type":"TextBlock","text":"MemodoAI Watchdog","weight":"Bolder","size":"Medium"},{"type":"TextBlock","text":"${msg}","wrap":true},{"type":"TextBlock","text":"${ts}","isSubtle":true,"size":"Small","spacing":"Small"}]}}]}
EOF
)
    curl -sf -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      > /dev/null 2>&1 || echo "[$TIMESTAMP] WARNING: Failed to send webhook alert"
  fi
}

check_service_http() {
  local name="$1"
  local url="$2"
  local state_file="${STATE_DIR}/.watchdog_${name}"

  if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
    # Healthy — clear any failure state
    rm -f "$state_file"
  else
    if [ -f "$state_file" ]; then
      # Second consecutive failure — alert
      send_alert "${name} has been unhealthy for >5 minutes. URL: ${url}"
    else
      # First failure — record state, will alert on next check
      echo "$TIMESTAMP" > "$state_file"
      echo "[$TIMESTAMP] WARNING: ${name} health check failed. Will alert on next failure."
    fi
  fi
}

check_service_docker() {
  local name="$1"
  local container="$2"
  local state_file="${STATE_DIR}/.watchdog_${name}"

  local status
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")

  if [ "$status" = "healthy" ]; then
    # Healthy — clear any failure state
    rm -f "$state_file"
  else
    if [ -f "$state_file" ]; then
      # Second consecutive failure — alert
      send_alert "${name} container '${container}' is ${status} for >5 minutes."
    else
      # First failure — record state, will alert on next check
      echo "$TIMESTAMP" > "$state_file"
      echo "[$TIMESTAMP] WARNING: ${name} container '${container}' is ${status}. Will alert on next failure."
    fi
  fi
}

# Check monitoring stack health via localhost port bindings (127.0.0.1:PORT)
# These ports are bound in monitoring/docker-compose.monitoring.yml
check_service_http "prometheus" "http://localhost:9090/-/healthy"
check_service_http "grafana" "http://localhost:3000/api/health"

# Check Alertmanager via localhost port binding
check_service_http "alertmanager" "http://localhost:9093/-/healthy"

# Also check core services as a secondary safety net
# Note: API port 3080 is mapped via base docker-compose.yml (${PORT}:${PORT})
check_service_http "librechat" "http://localhost:3080/health"

# Check database containers via Docker health status (no port bindings needed)
check_service_docker "mongodb" "chat-mongodb"
check_service_docker "vectordb" "vectordb"
