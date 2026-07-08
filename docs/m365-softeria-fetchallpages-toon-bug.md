# Upstream bug draft — Softeria `ms-365-mcp-server`

Draft of a GitHub issue for https://github.com/softeria/ms-365-mcp-server.
Discovered 2026-07-07 while enabling read-only SharePoint (Phase 1) in LibreChat.
Confirmed present on our pinned `0.110.0` **and** on current `main` (≥ `0.129.0`).
Mitigated locally by steering the agent away from `fetchAllPages` via
`librechat.yaml` `Microsoft365.serverInstructions` (v3). Filed upstream
2026-07-08 (issue link: _TODO — add URL_). Decision: keep `--toon`; the
mitigation is the `serverInstructions` steering, real fix tracked upstream.

---

## Title

`fetchAllPages` is broken under `--toon`: the pagination merge `JSON.parse()`s TOON-encoded output

## Environment

- `@softeria/ms-365-mcp-server` — reproduced on `0.110.0`; **code confirmed unchanged on `main` (≥ `0.129.0`)**.
- Transport: `--http` (streamable-http). Also applies to stdio.
- Output format: `--toon` (equivalently `MS365_MCP_OUTPUT_FORMAT=toon`).
- Node 22 (alpine).

## Summary

When the server is started with `--toon`, any tool call that also passes
`fetchAllPages: true` fails to paginate. The pagination merge logic in
`graph-tools.ts` calls `JSON.parse()` on the response body, but by that point
`graph-client.ts` has already re-encoded that body into **TOON**, which is not
JSON. The parse throws, the exception is caught and only logged, and the tool
falls back to returning the **first page only**.

The `--toon` output path and the `fetchAllPages` merge path disagree about
whether the in-flight body is JSON or TOON.

## Steps to reproduce

1. Start the server with `--toon` (or `MS365_MCP_OUTPUT_FORMAT=toon`).
2. Call any paginated GET list tool with `fetchAllPages: true`, e.g.
   `list-mail-messages`, `list-sharepoint-site-list-items`, `list-chat-messages`.
3. Watch the server log.

## Expected

`fetchAllPages: true` follows `@odata.nextLink` and returns all pages merged
into one response (subject to the `MS365_MCP_MAX_PAGES` / `MS365_MCP_MAX_ITEMS`
bounds), TOON-encoded.

## Actual

The server logs, for every such call:

```
ERROR: Error during pagination: SyntaxError: Unexpected token 'v', "value[71]:"... is not valid JSON
```

(`value[71]:` is the TOON array header — `JSON.parse` chokes on the leading `v`.)

- **Single-page result:** the tool still returns the complete first page, so the
  only visible artifact is the misleading `Error during pagination` log line.
- **Multi-page result:** the merge loop never runs, so the caller silently
  receives **only page one** despite requesting all pages. This is silent data
  truncation — arguably the more dangerous outcome, since a partial result is
  presented as if it were complete.

Net: with `--toon` enabled, `fetchAllPages: true` is effectively non-functional.

## Root cause (file/line refs on `main`)

`src/graph-client.ts` — the response body is TOON-encoded before it leaves the client:

```ts
// line 3
import { encode as toonEncode } from '@toon-format/toon';

// serializeData(), ~line 212
private serializeData(data: unknown, outputFormat: 'json' | 'toon', pretty = false): string {
  if (outputFormat === 'toon') {
    try {
      return toonEncode(data);            // <-- content[0].text becomes TOON
    } catch (error) {
      logger.warn(`Failed to encode as TOON, falling back to JSON: ${error}`);
      ...
    }
  }
  ...
}

// formatJsonResponse() builds content[0].text via serializeData(..., this.outputFormat)
// e.g. lines ~268 / ~313
content: [{ type: 'text', text: this.serializeData(responseData.data, this.outputFormat) }],
```

`src/graph-tools.ts` — the `fetchAllPages` merge then parses that same text as JSON:

```ts
// ~line 994
if (fetchAllPages && paginationEnabled && response?.content?.[0]?.text) {
  try {
    let combinedResponse = JSON.parse(response.content[0].text);        // line 996  <-- text is TOON → throws
    let nextLink = combinedResponse['@odata.nextLink'];
    ...
    while (nextLink && ...) {
      ...
      const nextJsonResponse = JSON.parse(nextResponse.content[0].text); // line 1024 <-- same problem
      ...
    }
    ...
    response.content[0].text = JSON.stringify(combinedResponse);
  } catch (e) {
    logger.error(`Error during pagination: ${e}`);                       // line 1062 <-- swallowed
  }
}
```

Because `graphRequest()` → `formatJsonResponse()` → `serializeData(..., 'toon')`
runs *before* the merge, `response.content[0].text` is already TOON at line 996.

Note: this is independent of the previously fixed `fetchAllPages` issues
(#333/#340 stripped `@odata.nextLink`, #419 lost query params, #479 delta links,
#519 page/item bounds). Those all assume a JSON body; none addresses the TOON
encoding running ahead of the merge.

## Suggested fix

Paginate on the raw JSON and TOON-encode **once, at the end**. Concretely, do the
`fetchAllPages` merge on the un-serialized `data` before `serializeData()` is
applied, so the merge always operates on JSON and only the final merged result is
encoded to the configured output format. (Alternatively, TOON-decode in the merge
loop when `outputFormat === 'toon'`, but pagination-before-encoding is cleaner and
avoids a decode round-trip.)

As a minimal guard in the meantime, the `fetchAllPages` schema/handler could
warn or no-op when the output format is `toon`, instead of silently returning
the first page.
