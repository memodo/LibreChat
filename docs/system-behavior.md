# System Behavior

Operational notes on how the LibreChat application behaves at runtime. This document captures non-obvious behaviors, data lifecycle details, and growth concerns that aren't apparent from configuration alone.

## File Storage (MinIO/S3)

MinIO serves as the persistent file storage layer, independent of Azure OpenAI. It stores:

- User-uploaded files (documents, images, PDFs, Office files)
- User avatars
- Agent file resources
- RAG file backups

**MinIO is required regardless of AI provider.** Azure OpenAI handles inference and embeddings; MinIO handles file persistence. The `fileStrategy: "s3"` setting in `librechat.yaml` points to MinIO.

Alternatives to MinIO: Azure Blob Storage (`azure`), local filesystem (`local`), or Firebase.

## Vector Database Embeddings (pgvector)

### Data Flow

1. User uploads a file
2. File is stored in MinIO (permanent backup)
3. File content is sent to Azure OpenAI embeddings endpoint to generate vectors
4. Vectors are stored in pgvector for semantic search/retrieval (RAG)

### Embedding Lifecycle

**Embeddings persist indefinitely.** There is no TTL, expiration, or scheduled cleanup.

**Embeddings ARE deleted when:**

- A user explicitly deletes a file (triggers `deleteVectors()` via the RAG API)
- A user account is deleted (`deleteUserFiles()` cascades to vector deletion)

**Embeddings are NOT deleted when:**

- A user deletes a conversation — only the conversation record is removed from MongoDB; associated files and embeddings remain in pgvector

### Storage Growth

Every file a user embeds stays in pgvector unless the file is manually deleted. With multiple users, this accumulates over time.

**No admin tools exist** for monitoring or managing vector DB storage (no bulk deletion, stats endpoints, or size reporting).

### Mitigation Options

- Monitor pgvector storage at the PostgreSQL level: `SELECT pg_database_size('mydatabase')`
- Set per-user storage quotas via `fileConfig` in `librechat.yaml`
- Build a cleanup script to identify orphaned embeddings (files not referenced by any active conversation)
- Educate users to delete files they no longer need
