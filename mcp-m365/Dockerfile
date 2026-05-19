# mcp-m365 — Microsoft 365 MCP sidecar (Softeria-backed, BYOT trust boundary)
#
# Build context: ./mcp-m365
# Runtime: streamable-http MCP server on :3000, consumed by the LibreChat API
# container at http://mcp-m365:3000/mcp via the Microsoft365 mcpServers entry
# in librechat.yaml. No host port is published.
#
# Per SPEC-014 REQ-002 / REQ-003 / SEC-006 / SEC-007:
#   - Base image pinned by multi-arch digest (NOT by tag).
#   - @softeria/ms-365-mcp-server pinned to a concrete semver, tarball verified
#     against a recorded SHA-256 before global install.
#   - No Entra credentials, no refresh tokens — auth is BYOT (per-request
#     Authorization header supplied by LibreChat).
#   - Read-only root filesystem at runtime (set via compose).
#
# Release gate (OD-1): resolved values recorded 2026-05-19 by running the
# Softeria sidecar locally and observing the advertised initialize response.
# Mirrored into ./VERSION and docker-compose.{override,prod}.yml.

FROM node:22-alpine@sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c

# Resolved 2026-05-19 via:
#   npm view @softeria/ms-365-mcp-server@latest version
# Mirror this value into ./VERSION and into docker-compose.*.yml build args.
ARG SOFTERIA_VERSION=0.110.0

# Resolved 2026-05-19 via:
#   npm view @softeria/ms-365-mcp-server@${SOFTERIA_VERSION} dist.integrity
# The registry publishes integrity as sha512-sri. We DO NOT use that value
# directly here. Instead, this ARG is the sha256 hex digest computed over the
# tarball that `npm pack` writes to disk:
#   sha256sum softeria-ms-365-mcp-server-<version>.tgz
# Record both in the implementation PR description (sri from registry + the
# sha256 we verify against here) so a future auditor can reproduce the chain.
ARG SOFTERIA_SHA256=38e495a29e7357f6777af6bf643c71ee9fd662fcd0aeec754c966ad8ea76ad8e

# SPEC-014 REQ-027 — sanity check: build-arg SOFTERIA_VERSION must equal the
# `SOFTERIA_VERSION=` line in the VERSION file. The VERSION file also pins
# `MCP_PROTOCOL_VERSION=2025-11-25` as the third locus required by REQ-027
# (the other two are `librechat.yaml` and
# `packages/api/src/mcp/MCPManager.ts::MICROSOFT365_EXPECTED_PROTOCOL_VERSION`).
COPY VERSION /build/VERSION
RUN VERSION_FROM_FILE="$(grep -E '^SOFTERIA_VERSION=' /build/VERSION | cut -d= -f2)" && \
    test "${VERSION_FROM_FILE}" = "${SOFTERIA_VERSION}" || \
    (echo "ABORT: VERSION mismatch: file=${VERSION_FROM_FILE} build-arg=${SOFTERIA_VERSION}"; exit 1)

# Verify tarball integrity before global install.
#
# `npm pack @softeria/ms-365-mcp-server@<v>` writes a file named
# `softeria-ms-365-mcp-server-<v>.tgz` — npm flattens the @scope/name prefix
# into <scope>-<name> on the packed filename. If a future Softeria release
# changes the package name or scope, run `npm pack --dry-run` once and adjust
# the verification line below.
RUN apk add --no-cache curl ca-certificates && \
    cd /tmp && \
    npm pack --pack-destination /tmp \
      @softeria/ms-365-mcp-server@${SOFTERIA_VERSION} && \
    echo "${SOFTERIA_SHA256}  softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz" \
      | sha256sum -c - && \
    npm install -g /tmp/softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz && \
    rm -f /tmp/softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz

EXPOSE 3000

ENTRYPOINT ["ms-365-mcp-server", "--http", "3000", "--toon"]
