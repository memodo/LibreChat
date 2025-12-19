# RESEARCH-002-file-upload-alternatives

## Research Question

What are the options for uploading files in LibreChat that an LLM can access, without using OpenAI or Anthropic? Specifically exploring:
1. Together.ai custom endpoint capabilities
2. Nebius Token Factory (https://tokenfactory.nebius.com/) capabilities
3. Alternative approaches for PDF/document analysis

## Context from User

> For PDF/document analysis, you'll need to create an Agent with file search tools - this works best with OpenAI-compatible endpoints
>
> Important caveats:
> 1. For PDFs - the together.ai custom endpoint won't process PDFs natively. PDF processing via file search typically requires the Agents feature with OpenAI-compatible endpoints that support assistants/file search APIs.
> 2. The core limitation - Together.ai's API handles file attachments differently than OpenAI. LibreChat's file search feature works best with OpenAI's Assistants API.

---

## System Data Flow

### Key Entry Points
- **File Upload Route**: `api/server/routes/files/files.js:369-418`
  - POST `/` routes to `processFileUpload()` for Assistants or `processAgentFileUpload()` for Agents
- **Multer Middleware**: `api/server/routes/files/index.js:33`
- **Image Encoding**: `api/server/services/Files/images/encode.js:95` (`encodeAndFormat()`)

### Data Transformations
1. **Image files** → Base64 or URL (for vision models) via `encodeAndFormat()`
2. **Text/Documents** → Parsed text via `parseText()` (`packages/api/src/files/text.ts:18`)
3. **Vector embedding** → Via RAG API (`api/server/services/Files/VectorDB/crud.js:67`)

### External Dependencies
- **Storage**: Local, S3/MinIO, Azure Blob, Firebase (`api/server/services/Files/strategies.js`)
- **Vector DB**: PostgreSQL + pgvector via RAG API
- **OpenAI Files API**: For Assistants endpoint only
- **Embedding providers**: OpenAI, Ollama, HuggingFace, Azure

### Integration Points
- Custom endpoints receive images as `image_url` in messages (`api/app/clients/prompts/formatMessages.js:16-25`)
- Agent file search uses RAG API for context retrieval (`api/app/clients/prompts/createContextHandlers.js:14-35`)

---

## Files That Matter

### Core Logic
| Component | Path |
|-----------|------|
| Main upload handler | `api/server/routes/files/files.js` |
| Processing logic | `api/server/services/Files/process.js` |
| Storage strategies | `api/server/services/Files/strategies.js` |
| Image encoding | `api/server/services/Files/images/encode.js` |
| Vector DB handler | `api/server/services/Files/VectorDB/crud.js` |
| Text parsing | `packages/api/src/files/text.ts` |
| Vision message formatting | `api/app/clients/prompts/formatMessages.js` |
| Agent resource processing | `packages/api/src/agents/resources.ts` |
| File filtering by endpoint | `packages/api/src/files/filter.ts` |

### Configuration
| File | Purpose |
|------|---------|
| `librechat.yaml:7-18` | `fileConfig.endpoints` per-endpoint file settings |
| `librechat.yaml:21` | `fileStrategy` (s3, local, azure, firebase) |
| `.env` | `RAG_API_URL`, `RAG_OPENAI_BASEURL`, embedding provider keys |

---

## Research Findings

### 1. LibreChat File Handling Architecture

LibreChat has **three distinct file handling pathways**:

#### A. Vision/Image Attachments (Works with Custom Endpoints)
**How it works**: Images attached to messages are converted to base64 or URLs and sent directly to the LLM.

**Code path**:
- `api/server/services/Files/images/encode.js:95-251` - `encodeAndFormat()` function
- Creates `image_url` content parts in OpenAI format: `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }`

**Key finding**: This works with **any OpenAI-compatible endpoint** that supports vision models, including Together.ai and Nebius.

**Current config** (`librechat.yaml:7-18`):
```yaml
fileConfig:
  endpoints:
    together.ai:
      fileLimit: 5
      fileSizeLimit: 20
      supportedMimeTypes:
        - "image/.*"   # Images only
    Nebius AI:
      fileLimit: 5
      fileSizeLimit: 20
      supportedMimeTypes:
        - "image/.*"   # Images only
```

#### B. OpenAI Assistants File Search (OpenAI/Azure Only)
**How it works**: Files uploaded to OpenAI's Files API, associated with Assistants, stored in vector stores.

**Code path**: `api/server/services/Files/OpenAI/crud.js:15-39`

**Limitation**: **Only works with OpenAI/Azure endpoints** - requires Assistants API which Together.ai/Nebius don't support.

#### C. Agent File Search via RAG API (Provider-Agnostic)
**How it works**: Files uploaded to LibreChat's RAG API service, embedded in PostgreSQL/pgvector, retrieved as context.

**Code path**:
- Upload: `api/server/services/Files/VectorDB/crud.js:67-120` - `uploadVectors()`
- Query: `api/app/clients/tools/util/fileSearch.js:109` - POST to `${RAG_API_URL}/query`

**Key finding**: This is **provider-agnostic** - the RAG API handles embedding separately from the LLM provider. You can use Ollama or HuggingFace for embeddings while using any LLM for generation.

---

### 2. Together.ai Capabilities

#### Vision Support (Images)
**Status**: Fully supported

Together.ai supports vision models with the standard OpenAI `image_url` format:
- **URL-based images**: Pass image URLs directly
- **Base64-encoded images**: `data:image/jpeg;base64,{base64_data}`

**Available vision models** (from `librechat.yaml:49`):
- `Qwen/Qwen2.5-VL-72B-Instruct`

**Token pricing**: Images converted to 1,601-6,404 tokens depending on size.

#### File/Document Support
**Status**: No native file API

Together.ai does **not** have:
- Files API endpoint for uploads
- Assistants API with file search
- PDF native processing

**Workaround**: Use LibreChat's RAG API with Together.ai for generation (see Section 4).

---

### 3. Nebius Token Factory Capabilities

#### Overview
- **API Base**: `https://api.tokenfactory.nebius.com/v1/`
- **Compatibility**: OpenAI-compatible API
- **Documentation**: https://docs.tokenfactory.nebius.com/

#### Vision Support (Images)
**Status**: Fully supported

Nebius supports vision models with OpenAI-compatible format:
- URL-based images
- Base64-encoded images

**Example from their docs**:
```python
response = client.chat.completions.create(
    model="Qwen/Qwen2-VL-72B-Instruct",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What's in this image?"},
            {"type": "image_url", "image_url": {"url": "https://..."}},
        ],
    }]
)
```

#### File Upload API
**Status**: Limited - batch/fine-tuning only

Nebius has a Files API (`POST /v1/files`) but with limited purposes:
- `batch` - for batch inference jobs
- `fine-tune` - for fine-tuning datasets

**Not supported**: File search, assistants API, document-in-context for chat.

#### Available Models
- DeepSeek-R1, DeepSeek-V3
- Qwen2-VL-72B-Instruct (vision)
- Llama models
- Various embedding models

---

### 4. Alternative Approaches

#### Option A: RAG API with Non-OpenAI Embedding Provider (RECOMMENDED)

**Architecture**:
```
User uploads PDF/Doc → LibreChat → RAG API → PostgreSQL/pgvector
                                      ↓
                              Ollama/HuggingFace (embeddings)

User query → LibreChat Agent → RAG API (retrieval) → Context
                    ↓
           Together.ai/Nebius (generation) ← Context + Query
```

**Configuration** (`.env`):
```bash
RAG_API_URL=http://rag_api:8000
EMBEDDINGS_PROVIDER=ollama  # or huggingface, huggingfacetei
EMBEDDINGS_MODEL=nomic-embed-text
```

**Supported embedding providers**:
- `ollama` - Local, using models like `nomic-embed-text`, `mxbai-embed-large`
- `huggingface` - Remote HuggingFace sentence-transformers
- `huggingfacetei` - Self-hosted Text Embedding Inference
- `google_genai` - Google's embedding API
- `vertexai` - Google Vertex AI

**Benefits**:
- Works with ANY LLM provider for generation
- PDFs processed via LangChain document loaders
- No OpenAI/Anthropic dependency
- Self-hosted embeddings option (Ollama, TEI)

**How to enable**:
1. Deploy RAG API service (`docker-compose.yml:64`)
2. Configure embedding provider in RAG API
3. Enable `fileSearch: true` in `librechat.yaml:5`
4. Create an Agent with `file_search` tool resource

#### Option B: Vision Models for Image-Based Documents

**Use case**: Analyzing images, screenshots, scanned documents (as images)

**Configuration** (`librechat.yaml`):
```yaml
fileConfig:
  endpoints:
    together.ai:
      supportedMimeTypes:
        - "image/.*"
    Nebius AI:
      supportedMimeTypes:
        - "image/.*"
```

**Workflow**:
1. Convert PDF pages to images (PNG/JPEG)
2. Upload images to chat
3. Use vision model (Qwen2.5-VL-72B) to analyze

**Limitations**:
- Manual PDF-to-image conversion
- Token costs per image (1,601-6,404 tokens)
- Not suitable for text-heavy documents

#### Option C: Context Tool Resource (Text Extraction)

**How it works**: Files uploaded with `tool_resource: context` are parsed to text and injected into the prompt.

**Code path**: `api/server/services/Files/process.js:553-642`

**Supports**:
- Text files (.txt, .md)
- Code files
- Audio (via speech-to-text)
- OCR processing via Mistral (if configured)

**Configuration**: Enable `MISTRAL_OCR_API_KEY` in `.env` for OCR capability.

---

### 5. Recommended Solutions

#### For PDF/Document Analysis WITHOUT OpenAI/Anthropic:

**Best Option: RAG API + Ollama Embeddings + Together.ai/Nebius Generation**

| Component | Technology | Configuration |
|-----------|-----------|---------------|
| **File Storage** | MinIO (S3) | `fileStrategy: "s3"` |
| **Document Processing** | RAG API | `RAG_API_URL=http://rag_api:8000` |
| **Embeddings** | Ollama | `EMBEDDINGS_PROVIDER=ollama` |
| **Vector Store** | PostgreSQL + pgvector | Via RAG API |
| **LLM Generation** | Together.ai or Nebius | Custom endpoint in librechat.yaml |

**Steps to implement**:
1. Deploy RAG API container with PostgreSQL
2. Deploy Ollama with embedding model (e.g., `nomic-embed-text`)
3. Configure RAG API to use Ollama for embeddings
4. Enable `agents: true` and `fileSearch: true` in LibreChat
5. Create an Agent with file_search tool
6. Set Agent's model provider to Together.ai or Nebius

#### For Quick Image Analysis:

**Use Vision Models Directly**

Your current config already supports this:
- Together.ai: Use `Qwen/Qwen2.5-VL-72B-Instruct`
- Nebius: Use `Qwen/Qwen2-VL-72B-Instruct`

Simply upload images to the chat and select a vision model.

---

## Security Considerations

- **Authentication/Authorization**: RAG API uses JWT tokens generated by LibreChat (`api/server/services/Files/VectorDB/crud.js:25`)
- **Data Privacy**:
  - With Ollama embeddings: All data stays local
  - With cloud embeddings: Document content sent to embedding provider
- **Input Validation**: File filtering by endpoint (`packages/api/src/files/filter.ts:31-96`)

---

## Testing Strategy

- **Unit tests**: `api/test/app/clients/tools/util/fileSearch.test.js`
- **Text parsing tests**: `packages/api/src/files/text.spec.ts`
- **Edge cases**: Large files, unsupported MIME types, RAG API unavailable

---

## Documentation Needs

- User guide: How to set up RAG API with non-OpenAI embeddings
- Developer guide: Adding new embedding providers
- Configuration reference: All RAG API environment variables

---

## Summary

| Feature | Together.ai | Nebius | Via RAG API |
|---------|-------------|--------|-------------|
| Image/Vision | YES (VL models) | YES (VL models) | N/A |
| PDF Analysis | NO | NO | YES |
| Document Upload | NO | Batch/Fine-tune only | YES |
| File Search | NO | NO | YES |
| Provider Lock-in | No | No | No (use Ollama) |

**Bottom line**: Use the **RAG API with Ollama embeddings** for document analysis without OpenAI/Anthropic dependency. For image analysis, use **vision models** directly with Together.ai or Nebius.
