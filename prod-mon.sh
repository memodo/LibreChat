#!/usr/bin/env bash
# prod-mon.sh — Production monitoring stack helper
#
# Wraps `docker compose` for the monitoring stack (Prometheus, Grafana,
# Alertmanager, exporters, cAdvisor) with the correct compose file and
# production env file. Sibling to prod.sh — keeps the application stack
# and the monitoring stack as separate compose projects.
#
# Contains no secrets — safe to commit to version control.
#
# Usage:
#   ./prod-mon.sh up -d                          # Start the monitoring stack
#   ./prod-mon.sh down                            # Stop the monitoring stack
#   ./prod-mon.sh restart prometheus              # Restart a single service
#   ./prod-mon.sh logs -f alertmanager            # Follow Alertmanager logs
#   ./prod-mon.sh ps                              # List monitoring services
#   ./prod-mon.sh exec prometheus \
#     wget -qO- --post-data= http://localhost:9090/-/reload   # Reload alert rules
#
# Prerequisites (must already be up — see prod.sh):
#   - Application stack running so librechat_default exists
#   - Redakt stack running so redakt_default exists
#   - caddy_net external network exists

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec docker compose \
  -f "${SCRIPT_DIR}/monitoring/docker-compose.monitoring.yml" \
  --env-file "${SCRIPT_DIR}/.env.prod" \
  "$@"
