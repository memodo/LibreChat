#### Security Findings (Iter 2)

- **MEDIUM** SSRF allowlist remains hostname-only with documented weakness
  - Evidence: REQ-005 / SEC-008 / OD-2 (line 85, 120, 263): "`mcpSettings.allowedDomains` adds a single bare-hostname entry `mcp-m365`"; SEC-008 calls this "an explicitly documented inherited weakness."
  - Risk: Any process bound to the `mcp-m365` hostname (e.g., a future malicious or misconfigured sidecar reusing that name on `default`/`caddy_net`) would pass the allowlist regardless of port/scheme; allowlist gives no protection against in-stack lateral redirect.
  - Resolution: Add a REQ asserting (a) Docker Compose `container_name: mcp-m365` is unique on `caddy_net` (no other service may claim that DNS name), and (b) the implementation PR includes a `grep`-style CI assertion that no other compose service shares the hostname, until `isDomainAllowedCore` is tightened.

- **MEDIUM** Egress restriction in SEC-006 is opt-out-able via "operationally infeasible" escape hatch
  - Evidence: Step 2 note (line 334): "if egress restriction is operationally infeasible in the phase-1 sprint, this is documented as a residual risk in the rollout checklist and is closed under OD-6."
  - Risk: SEC-006(b) ("constrains outbound network egress to `graph.microsoft.com:443` only") becomes aspirational; a compromised sidecar could egress anywhere on 443 (exfiltrate Graph data to attacker-controlled host using the in-flight Bearer token within its 1h TTL).
  - Resolution: Promote egress restriction to a release gate: implementation PR MUST ship at least one concrete mechanism (egress proxy container OR `iptables` OUTPUT rule OR Docker user-defined network with no default route + explicit route). Remove the "documented residual risk" fallback from Step 2.

- **LOW** `Files.Read.All` + `Sites.Read.All` over-scope rationale relies on compensating controls that are partial
  - Evidence: REQ-008 (line 88-89): scopes are tenant-wide read; rationale cites SEC-003, SEC-004, PERF-004 (rate limit).
  - Risk: Compensating controls are valid but do not bound the *agent-driven* exfiltration risk (LLM prompt-injected to enumerate all SharePoint sites the user can read); read-only does not equal low-blast-radius when the agent is the attacker.
  - Resolution: Add a REQ that `serverInstructions` (UX-002) explicitly instructs the model not to enumerate without an explicit user-stated target, and that prompt-injection-resistant phrasing is added (e.g., "do not search unless the user names a site/folder"). Reference SPEC-009 PII pipeline (REQ-019) as the catch.

- **LOW** Audit log content discipline is well-specified but lacks negative assertion in Verification
  - Evidence: SEC-004 (line 116) defines metadata-only audit record; Verification §6 only asserts absence in `mcp-m365` logs, not in LibreChat-side audit logs.
  - Risk: A future logging change in `MCPManager` or `processMCPEnv` could spill request body / response body / Authorization header into LibreChat-side logs and pass verification.
  - Resolution: Extend Verification §6 (or add §11) with a negative assertion against LibreChat `api` container logs: `grep -E 'Bearer eyJ|"body":|recipient' api` returns no hits during a representative tool-call session.

Areas explicitly verified: BYOT trust boundary (REQ-006/020/SEC-001 — clear, sidecar treats token as opaque, header omitted when null); Softeria image pinning (REQ-002 / OD-1 — release gate with integrity hash, non-root, RO FS, no-new-privileges); phase-1 scope set (REQ-008, read-only, ADR-aligned); rate limiting (REQ-024 per-user/per-conversation + Graph 429 surfacing); cascading timeout (REQ-025); MCP protocol version pin (REQ-027); sidecar log content (SEC-007 with negative assertion in Verification §6); confused-deputy (mitigated — sidecar never elevates, OBO is user-scoped); secrets-in-spec examples (none — placeholders only); rate limit on MCP endpoint (REQ-024 covers); cryptographic primitives (N/A — token treated as opaque, rationale stated); resource limits (REQ-026); single-flight OBO (REQ-021) preventing thundering-herd as a security control.
