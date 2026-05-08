# MemodoAI Features

This document tracks features discussed during development and implementation, including current capabilities, planned enhancements, and architectural decisions.

---

## Chat with Documents

MemodoAI supports multiple approaches for users to interact with uploaded documents during conversations. Each approach has different capabilities, infrastructure requirements, and supported file types.

### Option 1: Azure OpenAI Native File Handling (Current)

**Status:** Active

Users upload files directly in the chat interface. Azure OpenAI processes the file inline as part of the conversation using the Responses API.

**How it works:**
- User attaches a file via the chat input
- File is sent to Azure OpenAI, which parses and processes it on their side
- The model "sees" the file content directly within the conversation context

**Supported file types:**
- Images (PNG, JPG, etc.)
- PDFs

**Configuration:**
- `useResponsesApi: true` on the GPT-4.1 model spec
- File upload limits set in `fileConfig.endpoints.azureOpenAI` (5 files, 20MB each)

**Limitations:**
- No support for Office documents (.docx, .pptx, .xlsx)
- No persistent knowledge base across conversations
- Files are processed per-conversation, not reusable

**Infrastructure:** No additional services required. Azure handles everything.

---

### Option 2: RAG API with Vector Search

**Status:** Active (prod)

A self-hosted RAG (Retrieval-Augmented Generation) service that embeds uploaded documents into a vector database for semantic search. This enables two features that extend beyond Azure's native handling:

#### A. Agent Knowledge Bases

Admins or users create Agents with the "File Search" capability and upload documents to the agent. Those documents are embedded and stored persistently. Any user chatting with that agent can ask questions that trigger semantic search across those documents.

**Use case:** A "Company Policy Agent" with HR documents attached. Users ask natural-language questions and the agent retrieves relevant passages.

#### B. Chat-Level File Search

In a regular chat, users upload files and toggle "File Search" on in the chat input. The user's message is used as a semantic query against uploaded files, and relevant snippets are injected into the system prompt as context.

**Use case:** A user uploads a large .docx report and asks specific questions about its contents.

**Supported file types:**
- Everything in Option 1, plus:
- Office documents (.docx, .pptx, .xlsx)
- Plain text files (.txt, .csv, .md)
- Other text-based formats supported by the RAG API's parsing

**How it works:**
1. User uploads a file
2. File is sent to the RAG API service at `RAG_API_URL/embed`
3. RAG API chunks the document, generates embeddings (via Azure OpenAI's embedding model, e.g., `text-embedding-3-small`), and stores vectors in PostgreSQL with pgvector
4. When the user asks a question, the RAG API performs semantic search (`RAG_API_URL/query`) and returns the most relevant snippets
5. For agents, snippets are provided to the file_search tool; for chat, snippets are injected into the system prompt

**Infrastructure (deployed):**
- RAG API container (`registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite:v0.5.0`)
- `vectordb` container (`pgvector/pgvector:0.8.0-pg15-trixie`)
- Azure OpenAI `text-embedding-3-small` deployment on a separate resource (`memodo-openai-switzerland-north`, Switzerland North) — kept distinct from the chat-model resource (`memodo-openai-sweden`, Sweden Central) which serves GPT-5 / GPT-5-mini

**Hardware:** Lightweight. ~512MB RAM for the RAG API, ~1GB for PostgreSQL. Embeddings are computed by Azure, so no local GPU is needed.

**Environment variables (set in `.env` / `.env.prod`):**
- `RAG_API_URL` — internal URL of the RAG API service (`http://rag_api:8000`)
- `RAG_OPENAI_BASEURL` / `RAG_OPENAI_API_KEY` — Azure OpenAI endpoint + key for the embeddings resource
- `EMBEDDINGS_PROVIDER=azure`, `EMBEDDINGS_MODEL=text-embedding-3-small`
- `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` — same as the `RAG_OPENAI_*` pair (consumed by the rag_api container)
- `OPENAI_API_VERSION=2024-02-01`
- `RAG_USE_FULL_CONTEXT` — optional; returns full document content instead of snippets

**LibreChat config (`librechat.yaml`):**
- `interface.fileSearch: true` and `interface.fileCitations: true`
- `file_search` included in agent capabilities
- Citation tuning: `maxCitations: 30`, `maxCitationsPerFile: 7`, `minRelevanceScore: 0.25`

**MinIO requirement:** when LibreChat reaches MinIO over a public reverse-proxied endpoint (e.g. `https://minio.memodo-eng.de` via Caddy), `AWS_FORCE_PATH_STYLE=true` must be set in `.env.prod`. Without it, the AWS SDK uses virtual-hosted-style URLs (`https://<bucket>.minio.memodo-eng.de/...`) and the TLS handshake fails because the proxy has no wildcard cert. See `docs/rag-api-setup.md`.

---

### Comparison

| Capability | Azure Native (Option 1) | RAG API (Option 2) |
|---|---|---|
| Images | Yes | No (not applicable) |
| PDFs | Yes | Yes |
| Office docs (.docx, .pptx) | No | Yes |
| Text files (.txt, .csv) | No | Yes |
| Persistent agent knowledge base | No | Yes |
| Semantic search across documents | No | Yes |
| Additional infrastructure | None | RAG API + PostgreSQL |
| File citations in responses | No | Yes |

### Status

Both options coexist in prod. Option 1 handles the common case of uploading an image or PDF for quick questions inline. Option 2 is used for agents with persistent document knowledge bases and for chats involving Office documents (`.docx`, `.pptx`, `.xlsx`) and other text-based formats not supported by Azure native handling.

---

## Code Execution

LibreChat ships three distinct surfaces that involve code. Only two of them actually *execute* code; the third only *renders* it. None of the executing options are currently enabled in MemodoAI, so the model writes code as text in chat without running it.

### Option 1: LibreChat Code Interpreter API (Agents `execute_code`)

**Status:** Not enabled — and **closed to new subscriptions**

Hosted Python sandbox previously provided by the LibreChat team at `https://code.librechat.ai`. Backs the Agents `execute_code` capability — when a user toggles "Run Code" on an agent, the tool POSTs code to that endpoint, runs it in a sandboxed container, and returns stdout/stderr/files to the chat.

**Availability:** The LibreChat team is no longer accepting new subscriptions to the hosted Code Interpreter service, so new deployments cannot obtain a `LIBRECHAT_CODE_API_KEY` from them. **However, the underlying API contract is straightforward and several open-source backends implement it** — see "Self-hosted Option 1 backends" below. This keeps Option 1 on the table provided we run our own sandbox.

**How it works:**
- User enables `execute_code` on an agent (capability flag).
- At runtime, `api/server/services/ToolService.js:797-799` loads `LIBRECHAT_CODE_API_KEY` from auth values and forwards code to whatever URL `CODE_BASEURL` points at (defaults to `https://code.librechat.ai`; env var read in `node_modules/@librechat/agents/src/tools/CodeExecutor.ts:13`).
- The sandbox must implement: `POST /exec` (body `{ lang, code, args?, files?, session_id? }` → `{ stdout, stderr, files, session_id }`), `GET /files/:session_id`, `GET /download/:session_id/:id`, all authed via `X-API-Key` header.
- Tools whose registry entry declares `allowed_callers: ['code_execution']` (`packages/api/src/tools/classification.ts:217`) are loaded *into the sandbox session* rather than called directly by the agent.

**Caveats:**
- Pointing at the LibreChat hosted endpoint (if subscriptions reopened) would send user code and files to a third-party host — incompatible with MemodoAI's Azure-only data residency posture. A self-hosted backend on Hetzner avoids this.
- `programmatic_tools` capability is currently commented out in `defaultAgentCapabilities` (`config.ts:307`) — comment notes "requires latest Code Interpreter API."

#### Self-hosted Option 1 backends (open source)

Several community projects implement LibreChat's exact `CODE_BASEURL` contract and can be dropped behind it. We have not verified these in production; the list is a starting point for evaluation.

| Project | License | Sandbox | Languages | Sessions/Files | Notes |
|---|---|---|---|---|---|
| [usnavy13/LibreCodeInterpreter](https://github.com/usnavy13/LibreCodeInterpreter) | Apache-2.0 | nsjail + seccomp + namespaces | All 13 (py, js, ts, go, java, c, cpp, php, rs, r, f90, d, bash) | Redis-backed sessions, upload/download, auto-cleanup | Implements `/exec`, `/files/:session_id`, `/download/:session_id/:id` directly. Single `docker compose up`. Active project. **Lowest-effort drop-in.** |
| [Leonine-Studios/librechat-code-interpreter-judge0-bridge](https://github.com/Leonine-Studios/librechat-code-interpreter-judge0-bridge) | Per repo | Stateful proxy in front of Judge0 (isolate) | 60+ via Judge0 | Bridge adds session/file layer Judge0 lacks | Two services to run, but the executor underneath (Judge0) is battle-tested in competitive programming. Backup option if LibreCodeInterpreter has gaps. |
| Upstream LibreChat OSS release | TBD | TBD | TBD | TBD | The LibreChat maintainer publicly committed (per [discussion #9445](https://github.com/danny-avila/LibreChat/discussions/9445)) to open-sourcing the official interpreter. Status of that release is **not verified here** — check the discussion thread for current state before committing to a third-party project. |

**To wire up a self-hosted backend:**
1. Deploy the chosen sandbox container behind Caddy (or on the internal Docker network only).
2. In `.env`, set `CODE_BASEURL=http://<service>:<port>` and `LIBRECHAT_CODE_API_KEY=<shared-secret>` (the env var name LibreChat uses; the sandbox enforces the value via its `X-API-Key` check).
3. The "Run Code" item in the chat input dropdown becomes functional immediately; no code changes in LibreChat needed.

**To skip:**
- **Daytona** (AGPL-3.0) — network-copyleft is risky for a deployed fork.
- **Jupyter Kernel Gateway** — wrong API shape (WebSocket, not REST), no built-in sandboxing.
- **E2B self-hosted** — designed for Terraform on GCP/AWS; overkill for a single Hetzner VM.

---

### Option 2: OpenAI / Azure Assistants `code_interpreter`

**Status:** Not enabled (`ENDPOINTS=azureOpenAI,custom,agents` — neither `assistants` nor `azureAssistants` is listed)

Native sandbox capability built into the OpenAI Assistants API (and its Azure equivalent). Surfaces a separate "Assistants" endpoint in the UI; the `code_interpreter` toggle is exposed in the assistant builder. Defined in `packages/data-provider/src/config.ts:208-214` (`Capabilities.code_interpreter`) and included in `assistantEndpointSchema`'s default capability list.

**To enable on Azure (preserves Azure-only data residency):**
1. Add `azureAssistants` to `ENDPOINTS` in `.env`.
2. Add an `azureAssistants:` block under `endpoints` in `librechat.yaml` and mark an Assistants-capable group with `assistants: true`. Default capabilities already include `code_interpreter`; only override to *restrict*.
3. Verify the Azure region and model — Assistants API requires a specific deployment (typically `gpt-4o` / `gpt-4-turbo`); `gpt-5` / `gpt-5-mini` may not support it. Sweden Central does support Assistants, but the deployment must exist in the Azure resource.

**To enable on OpenAI direct:** Add `assistants` to `ENDPOINTS`, set `ASSISTANTS_API_KEY=<openai-key>`. Bypasses Azure entirely — **not compliant** with MemodoAI's data residency requirements.

**Caveats:**
- **Hard shutdown: August 26, 2026.** OpenAI announced the Assistants API beta deprecation on August 26, 2025, with full shutdown one year later on August 26, 2026 (per [OpenAI's deprecations page](https://developers.openai.com/api/docs/deprecations)). The replacement is the Responses API + Conversations API. **Azure aligns exactly — no lag this time.** The Azure OpenAI Assistants API retires on the same August 26, 2026 date, and Microsoft is steering Azure users to the [Microsoft Foundry Agents service](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements) (built on Responses API). LibreChat does not currently have first-class support for Foundry Agents, so any Assistants integration shipped now requires a second migration before the August 2026 shutdown.
- Not a generic agent capability: users must explicitly use the Assistants endpoint, not the existing Agents endpoint.
- Each assistant gets its own sandbox; no sharing with the Agents framework.

---

### Option 3: Artifacts (Sandpack) — *renderer, not interpreter*

**Status:** Enabled (`artifacts` listed in agent capabilities, `librechat.yaml:134`)

Renders model-generated UI code in an **iframe in the user's browser** using CodeSandbox's Sandpack (`client/src/components/Artifacts/ArtifactPreview.tsx:2`). Also renders Mermaid diagrams (`Artifacts/Mermaid.tsx`).

**What it can do:**
- Preview HTML / React / JS / Tailwind UI components.
- Render Mermaid diagrams.

**What it cannot do (common misconception):**
- Run Python or any non-JS language.
- Read uploaded files.
- Perform data analysis or return computed values back to the model.
- Execute anything server-side.

Artifacts is a **front-end preview surface**. If a user asks "calculate X" or "analyze this CSV," the model writes code in a code block — and unless Option 1 or Option 2 is enabled, nothing actually runs.

---

### UX implications: how the chat input changes per endpoint

The slider icon next to the file-upload paperclip in the chat input is the **ToolsDropdown** (`client/src/components/Chat/Input/ToolsDropdown.tsx`). It contains "Run Code" (Option 1), Web Search, File Search, Artifacts, and MCP server toggles. Whether it appears at all is determined by the active endpoint, per `client/src/components/Chat/Input/ChatForm.tsx:348-350`:

```ts
showEphemeralBadges={
  !!endpoint && !isAgentsEndpoint(endpoint) && !isAssistantsEndpoint(endpoint)
}
```

This gives three distinct UX modes depending on which entry the user picks from the model/spec switcher:

| Picked from switcher | Slider icon visible? | Where code execution is configured |
|---|---|---|
| GPT-5 (routes to `azureOpenAI`) | Yes | "Run Code" item in slider dropdown — driven by the `agents.capabilities` array in `librechat.yaml` |
| My Agents (`agents` endpoint) | No (auto-hidden) | `execute_code` toggle inside each agent's builder |
| Azure Assistants (`azureAssistants`, if enabled) | No (auto-hidden) | `code_interpreter` checkbox inside each assistant's builder |

So if Option 2 (Azure Assistants) is enabled and exposed via a `modelSpec` entry with `preset.endpoint: azureAssistants`, picking it from the switcher automatically hides the slider icon — the assistant builder owns the code-interpreter toggle. No code changes required.

### Cleanup option: hide the broken "Run Code" item

Only relevant if we decide *not* to deploy a self-hosted Option 1 backend (and not to wait for the upstream OSS release). In that case, the "Run Code" item in the slider dropdown on `azureOpenAI` chats and the `execute_code` toggle in the Agents builder both surface a non-functional feature. To hide them without affecting other tools, drop `execute_code` from the agents capabilities list in `librechat.yaml:134`:

```yaml
# Before
capabilities: ["deferred_tools", "execute_code", "file_search", "web_search", "actions", "tools", "artifacts"]

# After
capabilities: ["deferred_tools", "file_search", "web_search", "actions", "tools", "artifacts"]
```

Web Search, File Search, Artifacts, and MCP toggles all remain available. **Skip this cleanup if a self-hosted backend is on the roadmap** — the same `execute_code` capability flag is what makes the option work once `CODE_BASEURL` points at a real sandbox.

### Comparison

| Capability | Option 1 (self-hosted) | Option 1 (LibreChat hosted) | Assistants (Opt 2) | Artifacts (Opt 3) |
|---|---|---|---|---|
| Actually executes code | Yes (server-side sandbox) | Yes (server-side sandbox) | Yes (server-side sandbox) | No (browser renderer) |
| Languages | Up to all 13 (depends on backend) | All 13 | Python | HTML / JS / React only |
| Reads uploaded files | Yes | Yes | Yes | No |
| Returns results to model | Yes | Yes | Yes | No |
| Data residency | Inside Hetzner VPC | Third-party host | OpenAI or Azure | Client-side only |
| Available to new deployments | Yes (OSS backends exist) | **No (closed to subs)** | Yes | Yes |
| Currently enabled in MemodoAI | No | No | No | Yes |

### Status

No real code execution is wired up in MemodoAI. The model can write code as text, and Artifacts can render UI-style snippets in the browser, but Python execution / data analysis / file processing through code is unavailable. The realistic paths forward:

1. **Self-hosted Option 1 backend** — deploy an open-source sandbox (LibreCodeInterpreter, the Judge0 bridge, or the upstream OSS release once available) on Hetzner and point `CODE_BASEURL` at it. Reuses the existing chat-input "Run Code" UX and Agents builder toggle; data stays in our VPC. Lowest-friction restoration of the original feature.
2. **Azure Assistants (Option 2)** — preserves Azure data residency through the Assistants API, but **the API retires on August 26, 2026** (announced 2025-08-26 by OpenAI; Azure aligns with no lag and migrates users to the Microsoft Foundry Agents service). Standing this up in mid-2026 is effectively a short-term stopgap — assistants built on it would need to be re-migrated to a Foundry Agents / Responses API surface before shutdown, which LibreChat does not yet support. Only worth doing if there is an immediate, time-bounded need that cannot wait for a self-hosted Option 1 backend.
3. **Cleanup (do nothing for code execution)** — drop `execute_code` from `agents.capabilities` and ship without a code interpreter. Reasonable if neither path above is in scope; reversible later by adding the capability back when a backend is ready.

These are not mutually exclusive: a self-hosted Option 1 backend and Azure Assistants can coexist, with users picking whichever entry suits their task from the model/spec switcher.
