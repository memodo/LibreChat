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

### Option 2: RAG API with Vector Search (Not Yet Enabled)

**Status:** Not configured

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

**Infrastructure required:**
- RAG API container (Python FastAPI service from [danny-avila/rag_api](https://github.com/danny-avila/rag_api))
- PostgreSQL with pgvector extension (vector storage)
- An Azure OpenAI embedding model deployment (e.g., `text-embedding-3-small`)

**Hardware:** Lightweight. ~512MB RAM for the RAG API, ~1GB for PostgreSQL. Embeddings are computed by Azure, so no local GPU is needed.

**Environment variables:**
- `RAG_API_URL` — URL of the RAG API service
- `RAG_OPENAI_BASEURL` — Azure OpenAI endpoint for embeddings
- `RAG_OPENAI_API_KEY` — API key for the embeddings model
- `RAG_USE_FULL_CONTEXT` — Optional; returns full document content instead of snippets

**Existing configuration ready:**
- `interface.fileSearch: true` and `interface.fileCitations: true` in `librechat.yaml`
- `file_search` included in agent capabilities
- Citation tuning: `maxCitations: 30`, `maxCitationsPerFile: 7`, `minRelevanceScore: 0.45`

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

### Recommendation

Both options can coexist. Option 1 is already active and handles the common case of uploading an image or PDF for quick questions. Option 2 would be added when there is a need for agents with persistent document knowledge bases or for users who need to work with Office documents and other text-based formats.
