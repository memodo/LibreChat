# conv-log sidecar — multi-stage build (REQ-055)
#
# Base image digest (node:22-alpine):
#   node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
#
#   Resolved 2026-05-26 via `docker pull node:22-alpine` +
#   `docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine`.
#   Re-verify and update on major Node 22 releases or security advisories.
#
# Top-level npm dependencies resolved at time of package-lock.json generation (2026-05-26):
#   lru-cache@11.1.0  mongodb@6.17.0  pg@8.16.3  pino@9.7.0  prom-client@15.1.3
#
# Deploy note (REQ-071): This sidecar touches NO LibreChat workspaces. The
# prod-sync.sh build-and-rsync flow documented in CLAUDE.md is NOT required for
# conv-log. Production deploys:
#   git push + git pull on prod + ./prod.sh up -d conv-log
# No `npm run build` step is needed on the prod host — the image is built by
# Docker Compose from source.

# ---- build stage ----
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

RUN addgroup -S convlog && adduser -S convlog -G convlog

WORKDIR /app

COPY --from=build --chown=convlog:convlog /app/node_modules ./node_modules
COPY --from=build --chown=convlog:convlog /app/dist ./dist
COPY --from=build --chown=convlog:convlog /app/package.json ./
COPY --chown=convlog:convlog migrations ./migrations

USER convlog

EXPOSE 9300

CMD ["node", "dist/index.js"]
