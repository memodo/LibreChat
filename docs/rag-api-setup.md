# RAG API Operational Notes

## Overview

RAG (Retrieval-Augmented Generation) provides semantic file search in LibreChat — both for Agent knowledge bases and chat-level document queries. It extends file handling beyond Azure OpenAI's native support (images and PDFs) to Office documents, text files, and other formats.

## Status

**Active in prod** as of May 2026. Embedding model deployed; vector storage operational; end-to-end smoke test passing with `.docx` upload + citations.

## Architecture

```
User uploads file
       │
       ▼
  LibreChat API
       │
       ├──► MinIO (file storage, S3-compatible)
       │     prod: https://minio.memodo-eng.de via Caddy
       │     local: http://minio:9000 internal
       │
       └──► RAG API (/embed)
               │
               ├──► Azure OpenAI text-embedding-3-small
               │     resource: memodo-openai-switzerland-north
               │     region: Switzerland North
               │     (separate from the chat resource memodo-openai-sweden in Sweden Central)
               │
               └──► PostgreSQL + pgvector (vectordb)
                     stores embeddings

User asks question
       │
       ▼
  LibreChat API
       │
       └──► RAG API (/query)
               │
               ├──► Azure OpenAI (generates query embedding)
               │
               └──► pgvector (semantic similarity search)
                     │
                     ▼
               Returns scored snippets → injected into LLM context
                                       → rendered as citations in UI
```

## Two-region Azure setup

| Resource | Region | Purpose | Env var routing |
|---|---|---|---|
| `memodo-openai-sweden` | Sweden Central | GPT-5, GPT-5-mini chat models | `AZURE_OPENAI_API_KEY_SWEDEN` (referenced by `librechat.yaml`) |
| `memodo-openai-switzerland-north` | Switzerland North | `text-embedding-3-small` | `RAG_OPENAI_*` and generic `AZURE_OPENAI_*` (consumed by `rag_api` container via `env_file: .env.prod`) |

`librechat.yaml:141` references `${AZURE_OPENAI_API_KEY_SWEDEN}` explicitly for chat, so the generic `AZURE_OPENAI_*` vars only flow to the rag_api container — no routing collision.

## Required env vars (`.env.prod`)

```bash
# RAG embeddings (Switzerland North)
RAG_OPENAI_BASEURL=https://memodo-openai-switzerland-north.openai.azure.com/
RAG_OPENAI_API_KEY=<switzerland-north-api-key>
EMBEDDINGS_PROVIDER=azure
EMBEDDINGS_MODEL=text-embedding-3-small
AZURE_OPENAI_API_KEY=<same-as-RAG_OPENAI_API_KEY>
AZURE_OPENAI_ENDPOINT=https://memodo-openai-switzerland-north.openai.azure.com/
OPENAI_API_VERSION=2024-02-01
# RAG_USE_FULL_CONTEXT=  # Optional — returns full document instead of snippets

# MinIO via public Caddy endpoint (path-style required, see below)
AWS_ENDPOINT_URL=https://minio.memodo-eng.de
AWS_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<minio-key>
AWS_SECRET_ACCESS_KEY=<minio-secret>
AWS_REGION=us-east-1
AWS_BUCKET_NAME=librechat
```

## LibreChat config (`librechat.yaml`)

```yaml
interface:
  fileSearch: true
  fileCitations: true

endpoints:
  agents:
    capabilities: [..., "file_search", ...]
    maxCitations: 30
    maxCitationsPerFile: 7
    minRelevanceScore: 0.25
```

**Note on `minRelevanceScore`:** the default of 0.45 is too strict for typical `text-embedding-3-small` matches against natural-language questions — relevant snippets often score 0.50–0.65 for "useful but not exact-match" content, and a first-question-after-upload race can leave partial embeddings that score lower still. 0.25 is permissive enough to render citations reliably; the `maxCitations` / `maxCitationsPerFile` caps bound the noise floor.

## MinIO + reverse proxy: path-style is mandatory

When `AWS_ENDPOINT_URL` points at a public hostname proxied by Caddy (or any reverse proxy that doesn't have a wildcard cert), `AWS_FORCE_PATH_STYLE=true` is required.

Without it, the AWS SDK constructs URLs like `https://<bucket>.minio.memodo-eng.de/<key>` (virtual-hosted-style). Caddy has no site block / cert for `*.minio.memodo-eng.de`, so the TLS handshake aborts with `SSL alert number 80` (internal_error). Symptom in LibreChat logs:

```
[uploadFileToS3] Error streaming file to S3: write EPROTO
  ...SSL routines:ssl3_read_bytes:tlsv1 alert internal error...
  SSL alert number 80
```

With path-style, URLs become `https://minio.memodo-eng.de/<bucket>/<key>` which matches the existing site block and Let's Encrypt cert.

For local dev, `AWS_ENDPOINT_URL=http://minio:9000` over the internal Docker network is plain HTTP and works either way — but `AWS_FORCE_PATH_STYLE=true` is still set in `.env` for consistency.

## Smoke test

Verify end-to-end after any RAG-related deploy:

1. **Container health** — `docker compose ps` should show `rag_api`, `vectordb`, `minio`, and `LibreChat` all `(healthy)` (the LibreChat healthcheck uses `wget --spider` because the slim image ships without curl — see `docker-compose.prod.yml`).

2. **Upload + query a `.docx`** (Office docs are not handled by Azure native, so they exclusively exercise the RAG path):
   - Upload to a chat with file_search-capable model (or to an Agent with File Search enabled)
   - Ask a specific question whose answer is only in the doc
   - Wait a few seconds after upload before asking the first question to give the embedding pipeline time to complete (otherwise sources may not be retrieved)
   - Expect: an answer grounded in the document, plus a "Searched your files" badge that expands to show cited snippets with relevance percentages

3. **Verify via logs** — `docker logs -f rag_api` during the test should show:
   - `POST /embed - 200` on upload
   - `POST /query - 200` on each question
   - `POST .../embeddings 200 OK` for each Azure embedding call (Switzerland North endpoint)

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SSL alert number 80` on file upload | Virtual-hosted-style S3 URLs blocked by Caddy | Set `AWS_FORCE_PATH_STYLE=true` in `.env.prod` |
| `ENOTFOUND bucket.endpoint` on file upload (local) | Same as above on internal HTTP endpoint | Set `AWS_FORCE_PATH_STYLE=true` |
| LibreChat container `(unhealthy)` despite app running | Healthcheck uses `curl`, not in slim image | Use `wget --spider` (already applied in `docker-compose.prod.yml`) |
| File uploads succeed, no citations on first question | Embedding pipeline still in flight | Wait a few seconds before asking; subsequent questions are fine |
| File uploads succeed, citations never render | `minRelevanceScore` too high | Lower in `librechat.yaml` (currently 0.25); inspect with `LOG_LEVEL=debug` to see the `No sources above relevance threshold` line |
| `rag_api` container won't start | `vectordb` not ready | Check `docker compose logs vectordb` first |
| Embedding fails (4xx/5xx in rag_api logs) | Wrong key/endpoint, or deployment doesn't exist | Verify `RAG_OPENAI_BASEURL` and key against the Switzerland North resource |
| File search returns no results | File didn't embed | Check `embedded: true` on the file record in MongoDB |

## Docker services (from `docker-compose.yml` / `docker-compose.prod.yml`)

| Service | Image | Purpose |
|---|---|---|
| `rag_api` | `registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite` | Embedding + semantic search API |
| `vectordb` | `pgvector/pgvector:0.8.0-pg15-trixie` | PostgreSQL with vector extension |
| `minio` | `minio/minio` | S3-compatible object storage for uploaded files |
