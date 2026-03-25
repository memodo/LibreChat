# RESEARCH-004-astra-self-hosted-cassandra

## Research Question

What would it take to implement the Astra Assistants API with a local/self-hosted Apache Cassandra database instance instead of using AstraDB (DataStax's hosted service)?

## Context

This research builds on RESEARCH-003-astra-assistants-api which identified that:
- Self-hosted Cassandra is "theoretically possible with source code modifications"
- Database interactions occur in `impl/astra_vector.py`
- No documented configuration exists for self-hosted Cassandra

---

## Executive Summary

**Feasibility**: Possible but requires moderate code modifications (estimated 200-400 lines changed)

**Requirements**:
- Apache Cassandra 5.0+ (for native vector search with SAI + JVector)
- Fork and modify `impl/astra_vector.py` to use standard connection
- Pre-create schema (keyspace, 11 tables, indexes) manually
- Replace Astra-specific provisioning logic with direct CQL operations

**Effort Estimate**: 2-4 days for an experienced developer familiar with Cassandra

---

## System Data Flow

### Current Astra-Specific Flow

```
API Request
    │
    ▼
verify_db_client() [impl/routes/utils.py:287-318]
    │
    ├── astra-api-token header required
    ├── datastore_cache() returns/creates CassandraClient
    │
    ▼
CassandraClient [impl/astra_vector.py]
    │
    ├── get_or_create_db() → REST API: api.astra.datastax.com/v2/databases
    ├── download_secure_bundle() → /tmp/{dbid}.zip
    ├── connect() → Cluster(cloud={secure_connect_bundle})
    │
    ▼
AstraDB (Managed Cassandra)
```

### Required Self-Hosted Flow

```
API Request
    │
    ▼
verify_db_client() [MODIFIED]
    │
    ├── cassandra-token header (or env var)
    ├── datastore_cache() returns/creates CassandraClient
    │
    ▼
CassandraClient [MODIFIED - impl/astra_vector.py]
    │
    ├── NO provisioning (assumes DB exists)
    ├── connect() → Cluster(contact_points=['host1', 'host2'])
    │
    ▼
Self-Hosted Cassandra 5.0+ (with SAI indexes)
```

---

## Technical Requirements

### Cassandra Version

**Required**: Apache Cassandra 5.0 or later

**Why**: Vector search requires:
- `VECTOR<float, N>` data type (Cassandra 5.0+)
- StorageAttachedIndex (SAI) with JVector for ANN search (Cassandra 5.0+)
- `similarity_cosine()` function for vector similarity

**Alternative**: DataStax Enterprise (DSE) 6.9+ also supports these features.

**Sources**:
- [Apache Cassandra Vector Search Concepts](https://cassandra.apache.org/doc/latest/cassandra/vector-search/concepts.html)
- [Vector Search in Apache Cassandra 5.0 - Instaclustr](https://www.instaclustr.com/blog/vector-search-in-apache-cassandra-5-0/)

### Python Dependencies

From `pyproject.toml`:
```
cassandra-driver = "^3.28.0"
```

The DataStax Python driver supports both Astra and self-hosted Cassandra with different connection configurations.

---

## Code Modifications Required

### 1. CassandraClient Connection (impl/astra_vector.py)

**Current Code** (Astra-specific):
```python
def connect(self):
    # Downloads secure bundle from Astra API
    bundlepath = self.download_secure_bundle()

    cloud_config = {
        "secure_connect_bundle": bundlepath,
        "connect_timeout": 120
    }
    auth_provider = PlainTextAuthProvider("token", self.token)
    cluster = Cluster(cloud=cloud_config, auth_provider=auth_provider)
    self.session = cluster.connect()
```

**Required Change** (Self-hosted):
```python
def connect(self):
    # Use environment variables or config for connection
    contact_points = os.getenv("CASSANDRA_CONTACT_POINTS", "localhost").split(",")
    port = int(os.getenv("CASSANDRA_PORT", "9042"))
    username = os.getenv("CASSANDRA_USERNAME", "cassandra")
    password = os.getenv("CASSANDRA_PASSWORD", "cassandra")

    auth_provider = PlainTextAuthProvider(username, password)
    cluster = Cluster(
        contact_points=contact_points,
        port=port,
        auth_provider=auth_provider,
        reconnection_policy=ExponentialReconnectionPolicy(
            base_delay=1, max_delay=60
        )
    )
    self.session = cluster.connect()
```

### 2. Remove Astra Provisioning Logic

**Functions to Remove/Replace**:

| Function | Current Behavior | Self-Hosted Replacement |
|----------|-----------------|------------------------|
| `get_or_create_db()` | REST call to create AstraDB | Remove - assume DB exists |
| `make_keyspace()` | REST call to create keyspace | CQL: `CREATE KEYSPACE IF NOT EXISTS` |
| `download_secure_bundle()` | Downloads ZIP from Astra API | Remove entirely |
| `get_db_status()` | Checks HIBERNATED/ACTIVE state | Remove - not applicable |

### 3. Authentication Header Change (impl/routes/utils.py)

**Current** (Line 287-318):
```python
async def verify_db_client(
    request: Request,
    astra_api_token: Annotated[Optional[str], Header()] = None,
    astra_db_id: Annotated[Optional[str], Header()] = None,
) -> CassandraClient:
    if not astra_api_token:
        raise HTTPException(403, "Must pass an astradb token...")
```

**Required Change**:
```python
async def verify_db_client(
    request: Request,
    # Option A: Environment variables (simpler)
    # Option B: Headers for multi-tenancy
) -> CassandraClient:
    # Use env vars: CASSANDRA_CONTACT_POINTS, CASSANDRA_USERNAME, etc.
    # Or single shared connection pool
```

### 4. Schema Initialization

Currently, tables are created on-demand. For self-hosted:

**Pre-create Keyspace**:
```cql
CREATE KEYSPACE IF NOT EXISTS assistant_api
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 3
};
```

**Tables Required** (11 total):
1. `assistants_v2` - Assistant definitions
2. `files` - File metadata
3. `file_chunks` - Vector embeddings with multiple `embedding_*` columns
4. `messages` - Thread messages
5. `runs` - Execution runs
6. `run_steps` - Run step details
7. `threads` - Conversation threads
8. `vector_stores` - Vector store metadata
9. `vector_store_files` - File-to-store mappings
10. `vector_store_file_batches` - Batch operations
11. `tool_calls` - Function call records

**Vector Index Creation**:
```cql
CREATE CUSTOM INDEX IF NOT EXISTS file_chunks_embedding_idx
ON assistant_api.file_chunks (embedding)
USING 'StorageAttachedIndex';
```

---

## Environment Variables

### New Variables for Self-Hosted

```bash
# Required
CASSANDRA_CONTACT_POINTS=cassandra-node1,cassandra-node2,cassandra-node3
CASSANDRA_PORT=9042
CASSANDRA_KEYSPACE=assistant_api

# Authentication (if enabled)
CASSANDRA_USERNAME=cassandra
CASSANDRA_PASSWORD=your-secure-password

# Optional
CASSANDRA_DATACENTER=datacenter1
CASSANDRA_CONSISTENCY=LOCAL_QUORUM

# SSL/TLS (if enabled)
CASSANDRA_SSL_ENABLED=true
CASSANDRA_SSL_CA_CERTS=/path/to/ca.crt
```

### LLM Provider Variables (Unchanged)

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
TOGETHERAI_API_KEY=...
GROQ_API_KEY=...
OLLAMA_API_BASE_URL=http://localhost:11434
```

---

## Deployment Architecture

### Docker Compose Example

```yaml
version: '3.8'

services:
  # Self-hosted Cassandra cluster
  cassandra:
    image: cassandra:5.0
    ports:
      - "9042:9042"
    environment:
      - CASSANDRA_CLUSTER_NAME=AssistantsCluster
      - CASSANDRA_DC=datacenter1
      - CASSANDRA_ENDPOINT_SNITCH=GossipingPropertyFileSnitch
    volumes:
      - cassandra_data:/var/lib/cassandra
    healthcheck:
      test: ["CMD", "cqlsh", "-e", "SELECT now() FROM system.local"]
      interval: 30s
      timeout: 10s
      retries: 5

  # Modified Astra Assistants API
  assistants-api:
    build:
      context: ./astra-assistants-api-fork
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - CASSANDRA_CONTACT_POINTS=cassandra
      - CASSANDRA_PORT=9042
      - CASSANDRA_KEYSPACE=assistant_api
      - CASSANDRA_USERNAME=cassandra
      - CASSANDRA_PASSWORD=${CASSANDRA_PASSWORD}
      - TOGETHERAI_API_KEY=${TOGETHERAI_API_KEY}
      - OLLAMA_API_BASE_URL=http://ollama:11434
    depends_on:
      cassandra:
        condition: service_healthy
      ollama:
        condition: service_started

  # Local LLM (optional)
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

volumes:
  cassandra_data:
  ollama_data:
```

### Schema Initialization Script

```bash
#!/bin/bash
# init-cassandra.sh

until cqlsh cassandra 9042 -e "SELECT now() FROM system.local"; do
  echo "Waiting for Cassandra..."
  sleep 5
done

cqlsh cassandra 9042 << EOF
CREATE KEYSPACE IF NOT EXISTS assistant_api
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE assistant_api;

-- Assistants table
CREATE TABLE IF NOT EXISTS assistants_v2 (
    id text PRIMARY KEY,
    created_at bigint,
    description text,
    file_ids list<text>,
    instructions text,
    metadata text,
    model text,
    name text,
    object text,
    tools list<text>,
    temperature float,
    top_p float
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
    id text PRIMARY KEY,
    bytes bigint,
    created_at bigint,
    filename text,
    object text,
    purpose text,
    status text,
    status_details text
);

-- File chunks with vector support
CREATE TABLE IF NOT EXISTS file_chunks (
    file_id text,
    chunk_id text,
    content text,
    embedding vector<float, 1536>,
    PRIMARY KEY (file_id, chunk_id)
);

-- Create vector index
CREATE CUSTOM INDEX IF NOT EXISTS file_chunks_embedding_idx
ON file_chunks (embedding)
USING 'StorageAttachedIndex';

-- Additional tables: messages, threads, runs, etc.
-- (See full schema in implementation)
EOF

echo "Schema initialized successfully"
```

---

## Implementation Approach

### Option A: Fork and Modify (Recommended)

1. Fork `datastax/astra-assistants-api`
2. Create `impl/cassandra_client.py` with self-hosted connection logic
3. Modify `impl/astra_vector.py`:
   - Add environment variable configuration
   - Replace Astra-specific methods
   - Keep table creation logic but use CQL instead of REST
4. Update `impl/routes/utils.py` to use new auth approach
5. Create initialization scripts for schema
6. Build custom Docker image

**Pros**: Full control, maintain compatibility with upstream features
**Cons**: Need to maintain fork, merge updates from upstream

### Option B: Abstraction Layer

1. Create `DatabaseClient` interface/abstract class
2. Implement `AstraClient` (existing) and `CassandraClient` (new)
3. Use environment variable to select implementation
4. Potentially contribute back to upstream

**Pros**: Cleaner architecture, easier to contribute upstream
**Cons**: More initial work, may diverge from upstream patterns

### Option C: Use Alternative (Open Assistant API)

Consider MLT-OSS's [Open Assistant API](https://github.com/MLT-OSS/open-assistant-api) which:
- Uses MySQL/PostgreSQL (more common)
- Native self-hosted support
- OpenAI Assistants API compatible

**Pros**: No modifications needed, standard databases
**Cons**: Less mature than Astra Assistants, different codebase

---

## Files That Matter

### Core Files to Modify

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `impl/astra_vector.py` | Database operations | Replace connection logic, remove Astra API calls |
| `impl/routes/utils.py` | Client verification | Change auth mechanism |
| `pyproject.toml` | Dependencies | No changes needed |
| `Dockerfile` | Container build | Add init scripts |

### Files to Reference (Read-Only)

| File | Purpose |
|------|---------|
| `impl/routes/files.py` | File handling patterns |
| `impl/routes/assistants.py` | Assistant CRUD patterns |
| `impl/routes/threads.py` | Thread management patterns |
| `impl/routes/runs.py` | Run execution patterns |

---

## Security Considerations

### Authentication

- **Current**: Astra token passed in header (per-request)
- **Self-hosted options**:
  1. Environment variables (single tenant)
  2. Custom header with Cassandra credentials (multi-tenant)
  3. Proxy authentication layer

### Network Security

- Enable Cassandra SSL/TLS for production
- Use internal Docker network between services
- Firewall Cassandra ports (9042) from public access

### Data Privacy

- Self-hosted keeps all data on your infrastructure
- No data sent to DataStax/Astra services
- Embedding generation still uses external APIs (unless Ollama)

---

## Testing Strategy

### Unit Tests

- Mock Cassandra session for CassandraClient tests
- Verify CQL query generation
- Test connection retry logic

### Integration Tests

- Spin up Cassandra container
- Run schema initialization
- Execute CRUD operations on all tables
- Verify vector search functionality

### E2E Tests

- Full assistants API workflow
- File upload and retrieval
- Vector search accuracy

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cassandra 5.0 not widely deployed | High | Test with DSE 6.9+ as alternative |
| Schema drift from upstream | Medium | Version schema, track upstream changes |
| Vector search performance differences | Medium | Benchmark, tune SAI settings |
| Missing Astra-specific features | Low | Document limitations clearly |
| Maintenance burden of fork | Medium | Consider upstream contribution |

---

## Decision Points for User

Before implementation, clarify:

1. **Single-tenant or multi-tenant?**
   - Single: Env var config simpler
   - Multi: Need credential management layer

2. **Cassandra deployment**:
   - Docker single-node (dev/test)
   - Docker cluster (staging)
   - Kubernetes StatefulSet (production)
   - Managed Cassandra (Instaclustr, Amazon Keyspaces)

3. **LLM provider strategy**:
   - All external (Together.ai, OpenAI)
   - Hybrid (Ollama for embeddings, external for completion)
   - All local (full air-gapped)

4. **Fork maintenance**:
   - Internal fork (full control)
   - Upstream contribution attempt
   - Alternative solution (Open Assistant API)

---

## Summary

Self-hosted Cassandra with Astra Assistants API is **technically feasible** with moderate code modifications. The main work involves:

1. Replacing Astra-specific connection logic (~100 lines)
2. Removing REST API provisioning calls (~150 lines)
3. Creating schema initialization scripts
4. Building/maintaining a custom Docker image

**Key Requirements**:
- Apache Cassandra 5.0+ or DSE 6.9+
- Familiarity with Cassandra operations
- Willingness to maintain a fork

**Recommended Path**: Fork and modify (Option A), starting with a proof-of-concept that connects to a local Cassandra 5.0 container.

---

## Resources

### Documentation
- [Apache Cassandra Vector Search](https://cassandra.apache.org/doc/latest/cassandra/vector-search/concepts.html)
- [DataStax Python Driver](https://docs.datastax.com/en/developer/python-driver/3.25/getting_started/)
- [SAI Working Guide](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-working-with.html)

### Source Code
- [Astra Assistants API - GitHub](https://github.com/datastax/astra-assistants-api)
- [impl/astra_vector.py](https://github.com/datastax/astra-assistants-api/blob/main/impl/astra_vector.py)
- [impl/routes/utils.py](https://github.com/datastax/astra-assistants-api/blob/main/impl/routes/utils.py)

### Alternative Solutions
- [Open Assistant API (MLT-OSS)](https://github.com/MLT-OSS/open-assistant-api) - MySQL/PostgreSQL based
- [Myla](https://github.com/muyuworks/myla) - FAISS/LanceDB based
- [LibreChat RAG API](https://github.com/danny-avila/rag_api) - PostgreSQL + pgvector
