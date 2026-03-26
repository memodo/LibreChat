# RAG API Setup Guide

## Overview

Enable the RAG API to allow semantic file search in LibreChat — both for Agent knowledge bases and chat-level document queries. This extends file handling beyond Azure OpenAI's native support (images and PDFs) to include Office documents, text files, and other formats.

## Current Status

- **Infrastructure:** Already configured in `docker-compose.yml` (rag_api + pgvector containers)
- **LibreChat config:** Already set in `librechat.yaml` (fileSearch, fileCitations, agent capabilities)
- **Blocked on:** Azure permissions to deploy the embedding model

## What's Already Done

1. `docker-compose.yml` includes `rag_api` and `vectordb` services
2. `RAG_API_URL=http://rag_api:${RAG_PORT:-8000}` is set on the `api` service in `docker-compose.yml`
3. `librechat.yaml` has:
   - `interface.fileSearch: true`
   - `interface.fileCitations: true`
   - `file_search` in `endpoints.agents.capabilities`
   - Citation tuning: `maxCitations: 30`, `maxCitationsPerFile: 7`, `minRelevanceScore: 0.45`
4. `.env` has placeholder variables at lines 355-357 (commented out)

## Remaining Steps

### 1. Azure: Deploy Embedding Model

**Requires:** Cognitive Services OpenAI Contributor role on `rg-openai-prod-sweden` (need supervisor to assign this role to `p.oliva@memodo.de`, or have them deploy the model directly).

- **Model:** `text-embedding-3-small`
- **Deployment name:** `text-embedding-3-small`
- **Deployment type:** Standard
- **Region:** Switzerland North (Sweden Central not available for this model)
- **Rate limit:** 120K tokens/min is sufficient
- **Dynamic quota:** Enabled

### 2. .env: Uncomment and Set RAG Variables

In `.env` around line 355, uncomment and configure:

```bash
RAG_OPENAI_BASEURL=https://memodo-openai-sweden.openai.azure.com
RAG_OPENAI_API_KEY=<Azure OpenAI API key for Sweden resource>
# RAG_USE_FULL_CONTEXT=  # Optional, leave commented unless needed
```

Note: Verify the base URL format Azure expects for embeddings — it may need the deployment name or API version appended depending on how the RAG API constructs its requests.

### 3. Docker: Restart Services

```bash
docker-compose down
docker-compose up -d
```

The `rag_api` and `vectordb` containers should start automatically since they're already in `docker-compose.yml`.

### 4. Verify

- Check `rag_api` container logs: `docker-compose logs rag_api`
- Confirm it connects to `vectordb` and can reach the Azure embeddings endpoint
- Test by uploading a document through an Agent with file_search enabled

## Architecture Reference

```
User uploads file
       │
       ▼
  LibreChat API
       │
       ├──► MinIO (file storage)
       │
       └──► RAG API (/embed)
               │
               ├──► Azure OpenAI (text-embedding-3-small, Switzerland North)
               │         generates embeddings
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
                   Returns relevant snippets → injected into LLM context
```

## Docker Services (from docker-compose.yml)

| Service | Image | Purpose |
|---|---|---|
| `rag_api` | `registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite:latest` | Embedding + semantic search API |
| `vectordb` | `pgvector/pgvector:0.8.0-pg15-trixie` | PostgreSQL with vector extension |

## Troubleshooting

- **RAG API won't start:** Check `vectordb` is healthy first (`docker-compose logs vectordb`)
- **Embedding fails:** Verify `RAG_OPENAI_BASEURL` and `RAG_OPENAI_API_KEY` are correct and the embedding deployment exists in Azure
- **File search returns no results:** Confirm the file was marked as `embedded: true` in MongoDB after upload
- **Authorization error on Azure deployment:** Need Cognitive Services OpenAI Contributor role on `rg-openai-prod-sweden`
