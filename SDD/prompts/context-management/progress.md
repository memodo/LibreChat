# Research Progress

## Completed: RESEARCH-002-file-upload-alternatives & RESEARCH-003-astra-assistants-api

### Research Phase Summary
**Date**: 2025-12-18 / 2025-12-19
**Status**: COMPLETE - Exploratory research finalized

### Phase Transition Note
Research phase complete. RESEARCH-002-file-upload-alternatives.md and RESEARCH-003-astra-assistants-api.md finalized. These are exploratory/informational research documents evaluating external solutions for file handling without OpenAI/Anthropic dependency. Ready for implementation decision.

### Research Question
What are the options for uploading files in LibreChat that an LLM can access, without using OpenAI or Anthropic?

### Key Findings

#### 1. LibreChat File Handling Architecture
Three distinct pathways identified:
- **Vision/Image Attachments**: Works with any OpenAI-compatible endpoint (Together.ai, Nebius)
- **OpenAI Assistants File Search**: Only works with OpenAI/Azure (requires Assistants API)
- **Agent File Search via RAG API**: Provider-agnostic solution

#### 2. Together.ai Capabilities
- Vision support: YES (Qwen2.5-VL-72B-Instruct)
- File/Document upload: NO (no Files API)
- PDF processing: NO (native)

#### 3. Nebius Token Factory Capabilities
- Vision support: YES (Qwen2-VL-72B-Instruct)
- File upload: Limited (batch/fine-tune only)
- PDF processing: NO (native)

### Recommended Solutions

**For PDF/Document Analysis WITHOUT OpenAI/Anthropic:**

Best Option: **RAG API + Ollama Embeddings + Together.ai/Nebius Generation**

| Component | Technology |
|-----------|-----------|
| File Storage | MinIO (S3) |
| Document Processing | RAG API |
| Embeddings | Ollama (nomic-embed-text) |
| Vector Store | PostgreSQL + pgvector |
| LLM Generation | Together.ai or Nebius |

**For Image Analysis:**
Use vision models directly - your current config already supports this.

### Files Referenced
- `api/server/routes/files/files.js:369-418` - Main upload handler
- `api/server/services/Files/images/encode.js:95-251` - Image encoding
- `api/server/services/Files/VectorDB/crud.js:67-120` - Vector upload
- `packages/api/src/files/text.ts:18` - Text parsing
- `librechat.yaml:7-18` - File config per endpoint

### Research Documents
- `SDD/research/RESEARCH-002-file-upload-alternatives.md`
- `SDD/research/RESEARCH-003-astra-assistants-api.md` (Astra Assistants API deep-dive)

### Next Steps

**Option A: RAG API + Together.ai (Simpler)**
1. Deploy RAG API + PostgreSQL containers
2. Configure Together.ai for embeddings:
   ```bash
   RAG_OPENAI_BASEURL=https://api.together.xyz/v1
   RAG_OPENAI_API_KEY=${TOGETHERAI_API_KEY}
   EMBEDDINGS_MODEL=BAAI/bge-large-en-v1.5
   ```
3. Create LibreChat Agent with file_search tool
4. Test PDF upload and retrieval

**Option B: Astra Assistants API (Full Assistants Features)**
1. Create AstraDB account and get token
2. Deploy Astra Assistants API container
3. Configure LibreChat:
   ```bash
   ASSISTANTS_BASE_URL=http://astra-assistants:8080
   ASSISTANTS_API_KEY=your-astra-token
   ```
4. Use Together.ai models via `together_ai/` prefix

---

## Previous Research

### RESEARCH-001-agent-workflow-api (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-001-agent-workflow-api-2025-11-19.md`
