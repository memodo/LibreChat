# Research Progress

## Current: RESEARCH-004-astra-self-hosted-cassandra

### Research Phase Summary
**Date**: 2025-12-19
**Status**: COMPLETE

### Research Question
What would it take to implement the Astra Assistants API with a local/self-hosted Apache Cassandra database instance instead of using AstraDB (DataStax's hosted service)?

### Key Findings

#### 1. Feasibility Assessment
**Result**: Possible with moderate code modifications (estimated 200-400 lines changed, 2-4 days effort)

#### 2. Cassandra Version Requirement
- **Required**: Apache Cassandra 5.0+ or DSE 6.9+
- **Why**: Native vector search with SAI + JVector, `VECTOR<float, N>` type, `similarity_cosine()` function

#### 3. Code Modifications Needed

| Component | File | Changes |
|-----------|------|---------|
| Connection Logic | `impl/astra_vector.py` | Replace secure bundle with `Cluster(contact_points)` |
| Provisioning | `impl/astra_vector.py` | Remove `get_or_create_db()`, `make_keyspace()` REST calls |
| Authentication | `impl/routes/utils.py` | Change from Astra token to env vars or standard auth |
| Schema | N/A | Pre-create keyspace, 11 tables, SAI indexes |

#### 4. New Environment Variables
```bash
CASSANDRA_CONTACT_POINTS=host1,host2,host3
CASSANDRA_PORT=9042
CASSANDRA_KEYSPACE=assistant_api
CASSANDRA_USERNAME=cassandra
CASSANDRA_PASSWORD=your-password
```

### Implementation Options

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A (Recommended)** | Fork and modify | Full control, maintain upstream compatibility | Fork maintenance burden |
| **B** | Abstraction layer | Cleaner, contribute upstream | More initial work |
| **C** | Use Open Assistant API | No mods needed, MySQL/PostgreSQL | Different codebase, less mature |

### Decision Points Before Implementation
1. Single-tenant or multi-tenant deployment?
2. Cassandra deployment model (Docker/K8s/managed)?
3. LLM provider strategy (external/hybrid/local)?
4. Fork maintenance vs. alternative solution?

### Research Document
`SDD/research/RESEARCH-004-astra-self-hosted-cassandra.md`

### Sources Referenced
- [Apache Cassandra Vector Search](https://cassandra.apache.org/doc/latest/cassandra/vector-search/concepts.html)
- [Astra Assistants API - GitHub](https://github.com/datastax/astra-assistants-api)
- [DataStax Python Driver](https://docs.datastax.com/en/developer/python-driver/3.25/getting_started/)
- [Vector Search in Cassandra 5.0 - Instaclustr](https://www.instaclustr.com/blog/vector-search-in-apache-cassandra-5-0/)

---

## Previous Research

### RESEARCH-002 & RESEARCH-003 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-002-003-file-upload-research-2025-12-19.md`
**Topics**: File upload alternatives, Astra Assistants API overview

### RESEARCH-001 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-001-agent-workflow-api-2025-11-19.md`
