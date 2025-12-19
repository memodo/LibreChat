# RESEARCH-003-astra-assistants-api

## Overview

**Astra Assistants API** is an open-source, drop-in replacement for the OpenAI Assistants API v2, developed by DataStax. It enables you to use the full Assistants API feature set (threads, files, vector stores, function calling) with any LLM provider, not just OpenAI.

**GitHub**: https://github.com/datastax/astra-assistants-api
**Docker Hub**: `datastax/astra-assistants`
**License**: Open Source

---

## Key Benefits

### 1. Provider Independence
- Use **any LLM provider** for chat completions and embeddings
- Switch providers without changing application code
- Avoid vendor lock-in to OpenAI

### 2. Self-Hosting Option
- Run entirely on your own infrastructure
- Control where your data is stored and processed
- Meet compliance requirements (GDPR, HIPAA, etc.)

### 3. Cost Optimization
- Use cheaper LLM providers for different tasks
- Mix and match: expensive models for complex tasks, cheaper for simple ones
- No OpenAI markup on Assistants API features

### 4. Full API Compatibility
- 100% compatible with OpenAI Assistants API v2
- Minimal code changes to migrate existing applications
- Use existing OpenAI SDKs and libraries

### 5. Transparency
- Open source code - inspect how retrieval and function calling work
- Debug and customize behavior
- Community contributions and improvements

---

## Feature Comparison

| Feature | OpenAI Assistants | Astra Assistants |
|---------|------------------|------------------|
| **Threads** | Yes | Yes |
| **Messages** | Yes | Yes |
| **Assistants** | Yes | Yes |
| **Runs** | Yes | Yes |
| **Files** | Yes | Yes |
| **Vector Stores** | Yes | Yes |
| **File Search/Retrieval** | Yes | Yes |
| **Function Calling** | Yes | Yes |
| **Code Interpreter** | Yes | Yes |
| **Streaming** | Yes | Yes |
| **Multi-provider LLMs** | No (OpenAI only) | Yes (100+ providers) |
| **Custom Embeddings** | No | Yes |
| **Self-hosted** | No | Yes |
| **Open Source** | No | Yes |

---

## Supported LLM Providers

Astra Assistants uses **LiteLLM** to support 100+ LLM providers:

### Chat Completion Providers
| Provider | Model Examples | Config Prefix |
|----------|---------------|---------------|
| **OpenAI** | gpt-4o, gpt-4-turbo, gpt-3.5-turbo | (default) |
| **Anthropic** | claude-3-5-sonnet, claude-3-opus | `anthropic/` |
| **Google** | gemini-1.5-pro, gemini-1.5-flash | `gemini/` |
| **Cohere** | command-r-plus, command-r | `cohere/` or `cohere_chat/` |
| **Groq** | llama-3.1-70b, mixtral-8x7b | `groq/` |
| **Perplexity** | llama-3.1-sonar-large | `perplexity/` |
| **Together.ai** | Qwen, Llama, Mistral models | `together_ai/` |
| **AWS Bedrock** | Claude, Llama, Titan | `bedrock/` |
| **Google Vertex AI** | Gemini, PaLM | `vertex_ai/` |
| **Mistral AI** | mistral-large, mixtral | `mistral/` |
| **Ollama** | Any local model | `ollama/` |

### Embedding Providers
| Provider | Model Examples |
|----------|---------------|
| **OpenAI** | text-embedding-3-small, text-embedding-3-large |
| **Together.ai** | BAAI/bge-large-en-v1.5, m2-bert-80M-32k |
| **Cohere** | embed-english-v3.0, embed-multilingual-v3.0 |
| **Voyage AI** | voyage-large-2, voyage-code-2 |
| **HuggingFace** | sentence-transformers models |
| **Ollama** | nomic-embed-text, mxbai-embed-large |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Your Application                           │
│                   (OpenAI SDK / HTTP Client)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Astra Assistants API                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    FastAPI Server                       │    │
│  │  - OpenAI-compatible endpoints                          │    │
│  │  - Thread/Message/Run management                        │    │
│  │  - File processing & chunking                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│           ┌──────────────────┼──────────────────┐               │
│           ▼                  ▼                  ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │   LiteLLM   │    │   AstraDB   │    │  File Store │          │
│  │  (LLM calls)│    │  (vectors)  │    │  (documents)│          │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
┌─────────────────┐   ┌──────────────────┐
│  LLM Providers  │   │ Apache Cassandra │
│  (Together.ai,  │   │    + jvector     │
│   Anthropic,    │   │  (vector search) │
│   Groq, etc.)   │   │                  │
└─────────────────┘   └──────────────────┘
```

### Technical Stack
- **Framework**: FastAPI + Pydantic
- **Server**: Uvicorn (supports Kubernetes horizontal scaling)
- **Database**: AstraDB (Apache Cassandra + jvector for vectors)
- **LLM Abstraction**: LiteLLM
- **Monitoring**: Prometheus exporter
- **Code Generation**: OpenAPI specification for type safety

---

## Deployment Options

### Option 1: Managed Service (Astra)

Use DataStax's hosted service - no infrastructure to manage.

Uses a choice of hyperscalers (AWS, GCP, Azure) to host the database.

```python
from openai import OpenAI
from astra_assistants import patch

client = patch(OpenAI())
# Uses Astra's hosted service automatically
```

### Option 2: Docker (Self-Hosted)

```bash
docker pull datastax/astra-assistants
docker run -p 8080:8080 \
  -e ASTRA_DB_APPLICATION_TOKEN=your-token \
  -e OPENAI_API_KEY=your-key \
  datastax/astra-assistants
```

### Option 3: Docker Compose (With Local Models)

```yaml
version: '3.8'
services:
  astra-assistants:
    image: datastax/astra-assistants
    ports:
      - "8080:8080"
    environment:
      - ASTRA_DB_APPLICATION_TOKEN=${ASTRA_DB_APPLICATION_TOKEN}
      - TOGETHERAI_API_KEY=${TOGETHERAI_API_KEY}
      - OLLAMA_API_BASE_URL=http://ollama:11434
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
```

### Option 4: Local Development (Poetry)

```bash
git clone https://github.com/datastax/astra-assistants-api
cd astra-assistants-api
poetry install
poetry run python run.py
```

---

## Self-Hosted Database Options

While Astra Assistants API is designed around AstraDB (DataStax's managed service), there are options for fully self-hosted deployments.

### Option A: Self-Hosted Cassandra/DSE with Astra Assistants

The Astra Assistants API was designed to support self-hosted Cassandra and DataStax Enterprise (DSE) deployments.

**From the DataStax announcement:**
> "Making the server code open source will benefit users who want to deploy on premises / self hosted and point to their own self managed Cassandra / DSE databases or locally hosted LLM inference servers."

**Configuration approach:**
The database interactions are abstracted in `impl/astra_vector.py`. To use self-hosted Cassandra:

1. Clone the repository and examine `impl/astra_vector.py`
2. Configure connection using the DataStax Python CQL driver
3. Ensure your Cassandra cluster has jvector enabled for vector search

**Environment variables (likely needed):**
```bash
# Self-hosted Cassandra (check source code for exact vars)
CASSANDRA_CONTACT_POINTS=cassandra-node1,cassandra-node2
CASSANDRA_PORT=9042
CASSANDRA_USERNAME=cassandra
CASSANDRA_PASSWORD=your-password
CASSANDRA_KEYSPACE=assistant_api_db

# Or with secure connect bundle for DSE
SECURE_CONNECT_BUNDLE_PATH=/path/to/secure-connect-bundle.zip
```

**Note:** Self-hosted Cassandra configuration may require source code modifications. Check the GitHub issues and `impl/astra_vector.py` for current support status.

#### Needs Custom Development

The research document's claim is partially correct but misleading in practice.

**What this document says:**

The document cites a DataStax announcement stating that open-sourcing the code "will benefit users who want to deploy on premises / self hosted and point to their own self managed Cassandra / DSE databases."

**What's actually true:**

DataStax believes that making the server code open source will benefit users in a few ways: It enables folks who want to deploy on premises / self hosted and point to their own self managed cassandra / DSE databases or locally hosted LLM inference servers.

So DataStax did say this was a benefit of open-sourcing. However, there's a gap between the stated intention and actual implementation:

The database interactions occur in impl/astra_vector.py DataStax — notice the file is named specifically for Astra, not generic Cassandra.

The Astra Assistants API uses a Serverless (Vector) database for persistence. DataStax All documentation assumes AstraDB.
There's no documented configuration for self-hosted Cassandra — no environment variables, no setup guide, nothing in the official docs.

**The reality:**

The research document's "Option A: Self-Hosted Cassandra/DSE" is more theoretical than practical. You could fork the repo and modify impl/astra_vector.py to work with self-hosted Cassandra (especially with jvector for vectors), but this would be unsupported custom development, not a documented deployment option.

The document does include appropriate caveats (lines 227, 558, 562), but structuring it as "Option A" overstates its viability. A more accurate framing would be: "Theoretically possible with source code modifications, but not an officially supported or documented path."

---

### Option B: Open Assistant API (MLT-OSS) - MySQL/PostgreSQL

**GitHub**: https://github.com/MLT-OSS/open-assistant-api

A fully self-hosted alternative that uses standard databases instead of Cassandra.

**Tech Stack:**
- **Database**: MySQL 5.7+ (PostgreSQL likely supported via SQLAlchemy/Alembic)
- **Cache/Queue**: Redis
- **File Storage**: MinIO (S3-compatible)
- **RAG Engine**: R2R (optional, for enhanced retrieval)

**Docker Compose Setup:**
```yaml
version: '3.8'
services:
  api:
    image: mltoss/open-assistant-api
    ports:
      - "8086:8086"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - TOGETHERAI_API_KEY=${TOGETHERAI_API_KEY}  # Via OneAPI
      - DATABASE_URL=mysql://open_assistant:123456@db:3306/open_assistant
      - REDIS_URL=redis://redis:6379
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - APP_AUTH_ENABLE=false
    depends_on:
      - db
      - redis
      - minio

  worker:
    image: mltoss/open-assistant-api
    command: celery -A app.celery worker
    environment:
      # Same as api service
    depends_on:
      - db
      - redis

  db:
    image: mysql:5.7.44
    environment:
      - MYSQL_ROOT_PASSWORD=root123456
      - MYSQL_DATABASE=open_assistant
      - MYSQL_USER=open_assistant
      - MYSQL_PASSWORD=123456
    volumes:
      - ./volumes/mysql/data:/var/lib/mysql

  redis:
    image: redis:6-alpine

  minio:
    image: minio/minio
    command: server /data
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    volumes:
      - ./volumes/minio/data:/data
```

**Features:**
- OpenAI Assistants API compatible
- Supports OneAPI for multiple LLM providers (Together.ai, etc.)
- RAG with PDF, DOCX, PPTX, XLSX, PNG, MP3, MP4
- Built-in web search tool
- Message streaming
- Simple token-based auth for multi-tenancy

**Limitations:**
- Code interpreter still under development
- Less mature than Astra Assistants

---

### Option C: Myla - Lightweight Local Alternative

**GitHub**: https://github.com/muyuworks/myla

A minimal, privacy-focused implementation designed for local/private deployments.

**Tech Stack:**
- **Vector Store**: FAISS or LanceDB (file-based, no database server needed)
- **Embeddings**: sentence-transformers (local)
- **LLM**: Any OpenAI-compatible API

**Setup:**
```bash
pip install myla
```

```python
# .env
LLM_API_BASE=https://api.together.xyz/v1
LLM_API_KEY=your-together-key
LLM_MODEL=Qwen/Qwen2.5-72B-Instruct
```

**Features:**
- Zero external database dependencies
- Runs on laptop or server
- OpenAI Assistants API compatible
- ChatGLM support via chatglm.cpp

**Best for:**
- Personal/development use
- Edge deployments
- Minimal infrastructure requirements

---

### Option D: LibreChat RAG API - PostgreSQL + pgvector

**GitHub**: https://github.com/danny-avila/rag_api

Already integrated with LibreChat, uses standard PostgreSQL.

**Tech Stack:**
- **Database**: PostgreSQL + pgvector
- **Embeddings**: Configurable (OpenAI, Together.ai, HuggingFace, etc.)
- **Framework**: FastAPI + LangChain

**Docker Compose:**
```yaml
services:
  rag_api:
    image: ghcr.io/danny-avila/librechat-rag-api:latest
    ports:
      - "8000:8000"
    environment:
      - RAG_OPENAI_BASEURL=https://api.together.xyz/v1
      - RAG_OPENAI_API_KEY=${TOGETHERAI_API_KEY}
      - EMBEDDINGS_PROVIDER=openai
      - EMBEDDINGS_MODEL=BAAI/bge-large-en-v1.5
      - POSTGRES_DB=rag
      - POSTGRES_USER=rag
      - POSTGRES_PASSWORD=rag123
      - DB_HOST=postgres
    depends_on:
      - postgres

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_DB=rag
      - POSTGRES_USER=rag
      - POSTGRES_PASSWORD=rag123
    volumes:
      - ./volumes/postgres:/var/lib/postgresql/data
```

**Features:**
- Native LibreChat integration
- Standard PostgreSQL (widely supported)
- No Cassandra/specialized database
- Simpler than full Assistants API

**Limitations:**
- No threads (stateless)
- No full Assistants API (just file search)

---

## Self-Hosted Comparison

| Solution | Database | Full Assistants API | Threads | Complexity | Maturity |
|----------|----------|---------------------|---------|------------|----------|
| **Astra + Cassandra** | Cassandra/DSE | Yes | Yes | High | High |
| **Open Assistant API** | MySQL/PostgreSQL | Yes | Yes | Medium | Medium |
| **Myla** | FAISS/LanceDB | Yes | Yes | Low | Low |
| **LibreChat RAG API** | PostgreSQL | No (file search only) | No | Low | High |

### Recommendation by Use Case

| Use Case | Recommended Solution |
|----------|---------------------|
| **Enterprise, existing Cassandra** | Astra Assistants + Self-hosted Cassandra |
| **Standard infrastructure (MySQL/PostgreSQL)** | Open Assistant API (MLT-OSS) |
| **Minimal setup, personal use** | Myla |
| **Simple document Q&A with LibreChat** | LibreChat RAG API |
| **Maximum features, managed service OK** | Astra Assistants (hosted) |

---

## Configuration

### Environment Variables

```bash
# Required
ASTRA_DB_APPLICATION_TOKEN=AstraCS:...  # From astra.datastax.com

# LLM Providers (add keys for providers you want to use)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TOGETHERAI_API_KEY=...
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
COHERE_API_KEY=...
PERPLEXITY_API_KEY=pplx-...

# For local models
OLLAMA_API_BASE_URL=http://localhost:11434

# Optional
ASTRA_DB_DATABASE_NAME=assistant_api_db  # Default database name
```

### Using Different Models

Specify the model using the provider prefix:

```python
# OpenAI (default)
assistant = client.beta.assistants.create(
    model="gpt-4o",
    ...
)

# Anthropic Claude
assistant = client.beta.assistants.create(
    model="anthropic/claude-3-5-sonnet-20241022",
    ...
)

# Together.ai
assistant = client.beta.assistants.create(
    model="together_ai/Qwen/Qwen2.5-72B-Instruct",
    ...
)

# Groq
assistant = client.beta.assistants.create(
    model="groq/llama-3.1-70b-versatile",
    ...
)
```

### Using Different Embedding Models

```python
# Specify embedding model when uploading files
file = client.files.create(
    file=open("document.pdf", "rb"),
    purpose="assistants",
    embedding_model="together_ai/BAAI/bge-large-en-v1.5"
)
```

---

## Integration with LibreChat

LibreChat supports custom Assistants API endpoints via environment variables.

### Configuration

```bash
# .env
ASSISTANTS_API_KEY=your-astra-token
ASSISTANTS_BASE_URL=http://localhost:8080  # Or your Astra Assistants URL
ASSISTANTS_MODELS=together_ai/Qwen/Qwen2.5-72B-Instruct,anthropic/claude-3-5-sonnet
```

### How It Works

1. LibreChat's Assistants endpoint code (`api/server/services/Endpoints/assistants/initalize.js:57-59`) checks for `ASSISTANTS_BASE_URL`
2. If set, all Assistants API calls route to your Astra Assistants instance
3. You get full Assistants features (threads, files, vector stores) with your chosen LLM

---

## Core Concepts

### Threads
Persistent conversation containers that store message history:
- Survive across sessions
- Automatic context management
- Files attached persist for the thread lifetime

### Assistants
Configured AI entities with:
- System instructions
- Model selection (any supported provider)
- Tools (file_search, code_interpreter, functions)
- File attachments

### Vector Stores
Managed collections of embedded documents:
- Automatic chunking and embedding
- Semantic search during retrieval
- Supports custom embedding models

### Runs
Execution instances that:
- Process user messages through the assistant
- Handle tool calls and retrieval
- Support streaming responses

---

## Use Cases

### 1. Document Q&A with Non-OpenAI Models
Upload documents, ask questions using Claude, Gemini, or open-source models.

### 2. Cost-Optimized Assistants
Use GPT-4 for complex reasoning, Groq/Together.ai for simple queries.

### 3. Private/Compliant Deployments
Self-host everything for data sovereignty requirements.

### 4. Multi-Model Applications
Different assistants using different providers in the same application.

### 5. RAG Applications
Built-in retrieval with customizable embedding models.

---

## Limitations

1. **AstraDB Dependency**: Default setup requires AstraDB account; self-hosted Cassandra requires source code inspection (see Self-Hosted Database Options section)
2. **Code Interpreter**: Implementation may differ from OpenAI's sandboxed environment
3. **Newer Features**: May lag behind OpenAI's latest Assistants API features
4. **Maintenance**: DataStax was acquired by IBM (May 2025); long-term support unclear
5. **Self-hosted Cassandra**: Documentation for self-hosted Cassandra/DSE configuration is limited; may require code modifications

---

## Comparison: Astra Assistants vs RAG API

| Aspect | Astra Assistants API | LibreChat RAG API |
|--------|---------------------|-------------------|
| **API Style** | Full Assistants API | Simple file search |
| **Threads** | Yes (persistent) | No |
| **Complexity** | Higher | Lower |
| **Setup** | AstraDB + API server | PostgreSQL + RAG API |
| **Code Changes** | Minimal (patch client) | LibreChat config only |
| **Best For** | Complex multi-turn apps | Simple document Q&A |

---

## Quick Start

### 1. Get AstraDB Token
- Go to https://astra.datastax.com
- Create account (free tier available)
- Generate Application Token with "Database Administrator" role

### 2. Set Up Environment

```bash
# .env
ASTRA_DB_APPLICATION_TOKEN=AstraCS:your-token
TOGETHERAI_API_KEY=your-together-key  # Or other provider
```

### 3. Run with Docker

```bash
docker run -p 8080:8080 --env-file .env datastax/astra-assistants
```

### 4. Test with Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-astra-token",
    base_url="http://localhost:8080"
)

# Create assistant with Together.ai model
assistant = client.beta.assistants.create(
    name="Document Analyzer",
    model="together_ai/Qwen/Qwen2.5-72B-Instruct",
    tools=[{"type": "file_search"}]
)

# Upload file with Together.ai embeddings
file = client.files.create(
    file=open("report.pdf", "rb"),
    purpose="assistants",
    embedding_model="together_ai/BAAI/bge-large-en-v1.5"
)

# Create thread and run
thread = client.beta.threads.create()
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="Summarize the key findings in this report",
    attachments=[{"file_id": file.id, "tools": [{"type": "file_search"}]}]
)

run = client.beta.threads.runs.create_and_poll(
    thread_id=thread.id,
    assistant_id=assistant.id
)

# Get response
messages = client.beta.threads.messages.list(thread_id=thread.id)
print(messages.data[0].content[0].text.value)
```

---

## Resources

### Astra Assistants API
- **GitHub**: https://github.com/datastax/astra-assistants-api
- **DataStax Docs**: https://docs.datastax.com/en/astra-db-serverless/tutorials/astra-assistants-api.html
- **LiteLLM Docs**: https://docs.litellm.ai/docs/providers
- **AstraDB**: https://astra.datastax.com

### Self-Hosted Alternatives
- **Open Assistant API (MLT-OSS)**: https://github.com/MLT-OSS/open-assistant-api
- **Myla**: https://github.com/muyuworks/myla
- **LibreChat RAG API**: https://github.com/danny-avila/rag_api

### Database Resources
- **Apache Cassandra**: https://cassandra.apache.org/
- **jvector (Cassandra vector search)**: https://github.com/jbellis/jvector
- **pgvector (PostgreSQL)**: https://github.com/pgvector/pgvector

---

## Summary

Astra Assistants API is the most feature-complete open-source replacement for OpenAI's Assistants API. It's ideal when you need:

- Full Assistants API features (threads, vector stores, tools)
- Provider flexibility (Together.ai, Anthropic, etc.)
- Self-hosting capability
- Persistent conversation state

### Self-Hosted Decision Tree

```
Do you need full Assistants API (threads, vector stores)?
├── YES
│   ├── Have existing Cassandra/DSE infrastructure?
│   │   └── YES → Astra Assistants + Self-hosted Cassandra
│   │   └── NO → Open Assistant API (MLT-OSS) with MySQL/PostgreSQL
│   └── Need minimal infrastructure?
│       └── Myla (FAISS/LanceDB, no database server)
└── NO (just document Q&A)
    └── LibreChat RAG API + PostgreSQL/pgvector
```

### Quick Comparison

| If you want... | Use... |
|----------------|--------|
| Maximum features + managed service | Astra Assistants (hosted) |
| Full Assistants API + standard databases | Open Assistant API (MySQL) |
| Full Assistants API + no external DB | Myla (FAISS) |
| Simple document search + LibreChat native | RAG API (PostgreSQL) |
