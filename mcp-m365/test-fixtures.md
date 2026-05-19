# M365 MCP Test Fixtures — PII Canary Infrastructure

Backs SPEC-014 Verification §11 (PII canary). Documents the dedicated test
identity and seeded data that the integration tests assert against.

## Test identity

| Field | Value |
|---|---|
| UPN | `librechat-test@memodo.de` |
| Display name | LibreChat M365 Test |
| Tenant | `memodo.de` (production Entra tenant) |
| Role | Standard user (no admin roles) |
| Mailbox license | Microsoft 365 E3 (minimum) |

This account is used **only** for automated M365 MCP integration testing.
It must never carry production correspondence or be shared with humans.

## Seeded fixtures

### Mail fixture — `mail.canary.iban`

A single email lives in the test mailbox at the path
`Inbox/librechat-canary/iban-canary.eml` with the following structure:

| Header | Value |
|---|---|
| Subject | `[LIBRECHAT-CANARY] Synthetic IBAN payload` |
| From | `librechat-test@memodo.de` |
| To | `librechat-test@memodo.de` |
| Body (text) | Includes the synthetic IBAN `DE00 1234 5678 9012 3456 78` |

The IBAN is **structurally valid** but matches no real account. PII detection
tests assert this string is flagged when M365 mail bodies are surfaced into
chat context.

### SharePoint fixture — `sharepoint.canary.doc`

A single `.docx` file lives at the path
`Documents/librechat-canary/iban-doc-canary.docx` inside the
`librechat-test-fixtures` SharePoint site (provisioned in the same tenant).
The document body contains the same synthetic IBAN payload as the mail
fixture, allowing the PII pipeline to be exercised across both Outlook and
SharePoint surfaces.

## Provisioning

Fixture setup is **one-time manual Azure/M365 work**, performed out-of-band
by an admin in the `memodo.de` tenant. It is NOT part of CI for two reasons:

1. Provisioning requires tenant-admin credentials that must not appear in CI.
2. Once seeded, the fixtures are stable; rebuilding them per run would cost
   throttled Graph operations and add brittleness.

The Verification Plan documents the manual provisioning steps in §11.

## Rotation

If `librechat-test@memodo.de` is ever compromised or its mailbox grows
beyond the seeded fixtures, rotate by:

1. Disabling the account in Entra.
2. Provisioning a fresh account (e.g., `librechat-test2@memodo.de`).
3. Re-seeding the two fixtures above.
4. Updating this document with the new UPN.
5. Updating the integration test bootstrap config.
