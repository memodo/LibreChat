# Agent Workflow API - Implementation Research

## Project Overview

**Goal**: Wrap the existing three-stage agent workflow (`ta_three_agents.py`) in an OpenAI-compatible FastAPI server to enable integration with LibreChat.

**Integration Target**: LibreChat custom endpoint expecting OpenAI chat completions format with SSE streaming.

---

## Current Agent Workflow Analysis

### Architecture

**File**: `ta_three_agents.py`

**Three-Stage Pipeline**:

1. **Stage 1 - News Curator**
   - Function: `run_curator_agent(agent, user_query)`
   - Purpose: Web search and news curation via FireCrawl
   - Tool: `web_search` (FireCrawl API)
   - Timeout: 30 seconds
   - Max Tokens: 1500
   - Output: Curated news text (5-7 min read)

2. **Stage 2 - Strategic Analyst**
   - Function: `run_analyst_agent(agent, curated_news, company_context, extra_questions)`
   - Purpose: Strategic analysis of curated news
   - Tools: None (text-only)
   - Timeout: 60 seconds
   - Max Tokens: 5000
   - Output: Strategic analysis (20-30 min read)

3. **Stage 3 - Deep-Dive Specialist**
   - Function: `run_deepdive_agent(agent, strategic_analysis, topic_hint)`
   - Purpose: Comprehensive deep-dive analysis
   - Tools: None (text-only)
   - Timeout: 120 seconds
   - Max Tokens: 8000
   - Output: Deep-dive report (30-45 min read)

### Technology Stack

- **Agent Framework**: Haystack Agents
- **LLM Provider**: Together AI (OpenAI-compatible API at `https://api.together.xyz/v1`)
- **Model**: `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8`
- **Web Search**: FireCrawl API
- **Dependencies**: `haystack-ai`, `firecrawl-py`, `python-dotenv`

### Current Execution Model

- **Synchronous**: Each stage runs sequentially and blocks
- **File-based Output**: Saves three markdown files to `agent_outputs/`
- **CLI Interface**: Uses `argparse` for command-line execution
- **Error Handling**: Try/catch in `web_search()`, dependency validation in `validate_dependencies()`

### Environment Variables Required

```bash
TOGETHER_API_KEY=tgp_v1_YOUR_KEY_HERE
FIRECRAWL_API_KEY=fc_YOUR_KEY_HERE
MODEL=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8  # Optional, has default
```

### Prompt Files (External Dependencies)

```
recruiting-prompts/
├── prompt_1_news_curator.md
├── prompt_2_strategic_analyst.md
└── prompt_3_deep_dive.md
```

These files must be accessible at runtime for agent system prompts.

---

## API Wrapper Requirements

### OpenAI-Compatible Endpoint Specification

**Endpoint**: `POST /v1/chat/completions`

**Request Format**:

```json
{
  "model": "research-agent-v1",
  "messages": [
    {"role": "system", "content": "Optional system message"},
    {"role": "user", "content": "What are the latest recruiting trends in DACH?"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4000
}
```

**Request Headers**:

```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

**Response Format (Streaming - SSE)**:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":"🔍"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":" Stage"},"finish_reason":null}]}

... (more chunks) ...

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Response Format (Non-Streaming)**:

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1699000000,
  "model": "research-agent-v1",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Complete response text here..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 2500,
    "total_tokens": 2510
  }
}
```

---

## Implementation Architecture

### Recommended Approach: Stage-by-Stage Streaming

**Rationale**:
- Existing workflow is synchronous - minimal refactoring needed
- Three stages with clear boundaries are natural streaming points
- Provides user feedback during long execution (up to 3.5 minutes)
- Can simulate word-by-word streaming by chunking stage outputs

**Streaming Strategy**:

```
User Query
  ↓
Stage 1: Curator (0-30s)
  → Stream: "🔍 Stage 1: News Curator - Searching for articles..."
  → Execute: run_curator_agent()
  → Stream: Curator output (chunked word-by-word)
  ↓
Stage 2: Analyst (30s-90s)
  → Stream: "\n\n📊 Stage 2: Strategic Analyst - Analyzing trends..."
  → Execute: run_analyst_agent()
  → Stream: Analyst output (chunked word-by-word)
  ↓
Stage 3: Deep-Dive (90s-210s)
  → Stream: "\n\n🔬 Stage 3: Deep-Dive Specialist - Generating report..."
  → Execute: run_deepdive_agent()
  → Stream: Deep-Dive output (chunked word-by-word)
  ↓
Complete: Send finish_reason: "stop" and [DONE]
```

### Project Structure

```
agent-workflow-api/
├── main.py                    # FastAPI server
├── models.py                  # Pydantic request/response models
├── agent_wrapper.py           # Wrapper around ta_three_agents.py
├── streaming.py               # SSE streaming utilities
├── requirements.txt           # Dependencies
├── .env                       # Environment variables
├── Dockerfile                 # Container definition
├── docker-compose.yml         # Docker Compose config
├── README.md                  # Setup and usage docs
│
├── ta_three_agents.py         # Existing agent workflow (copy or symlink)
└── recruiting-prompts/        # Prompt files (copy or symlink)
    ├── prompt_1_news_curator.md
    ├── prompt_2_strategic_analyst.md
    └── prompt_3_deep_dive.md
```

---

## Implementation Components

### 1. Request/Response Models (`models.py`)

```python
from pydantic import BaseModel
from typing import List, Optional, Literal

class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    stream: Optional[bool] = False
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 4000
    top_p: Optional[float] = 1.0

class DeltaContent(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None

class ChatCompletionChoice(BaseModel):
    index: int
    delta: Optional[DeltaContent] = None
    message: Optional[ChatMessage] = None
    finish_reason: Optional[str] = None

class ChatCompletionChunk(BaseModel):
    id: str
    object: Literal["chat.completion.chunk"]
    created: int
    model: str
    choices: List[ChatCompletionChoice]

class ChatCompletionResponse(BaseModel):
    id: str
    object: Literal["chat.completion"]
    created: int
    model: str
    choices: List[ChatCompletionChoice]
    usage: Optional[dict] = None
```

### 2. Agent Workflow Wrapper (`agent_wrapper.py`)

**Purpose**: Wrap existing `ta_three_agents.py` functions for async streaming

```python
import asyncio
from typing import AsyncGenerator, List
from models import ChatMessage

# Import existing functions
from ta_three_agents import (
    build_agent,
    run_curator_agent,
    run_analyst_agent,
    run_deepdive_agent,
    attach_web_tool,
    read_text
)
from pathlib import Path

async def execute_workflow_streaming(
    messages: List[ChatMessage],
    temperature: float = 0.7
) -> AsyncGenerator[str, None]:
    """
    Execute three-stage workflow with stage-by-stage streaming.

    Yields:
        str: Text chunks to stream to client
    """
    # Extract user query (last user message)
    user_query = next(
        (m.content for m in reversed(messages) if m.role == "user"),
        ""
    )

    if not user_query:
        yield "Error: No user query found in messages."
        return

    # Load prompts
    try:
        p1 = read_text(Path("recruiting-prompts/prompt_1_news_curator.md"))
        p2 = read_text(Path("recruiting-prompts/prompt_2_strategic_analyst.md"))
        p3 = read_text(Path("recruiting-prompts/prompt_3_deep_dive.md"))
    except FileNotFoundError as e:
        yield f"Error: Prompt file not found - {e}"
        return

    # Build agents
    model = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"

    curator = build_agent(
        system_prompt=p1,
        model=model,
        tools=attach_web_tool(),
        timeout=30,
        max_tokens=1500
    )

    analyst = build_agent(
        system_prompt=p2,
        model=model,
        timeout=60,
        max_tokens=5000
    )

    deepdive = build_agent(
        system_prompt=p3,
        model=model,
        timeout=120,
        max_tokens=8000
    )

    # Stage 1: Curator
    yield "🔍 **Stage 1: News Curator**\n\n"
    yield "Searching for relevant articles and curating news...\n\n"

    # Run curator in thread pool (blocking operation)
    loop = asyncio.get_event_loop()
    curated = await loop.run_in_executor(
        None,
        run_curator_agent,
        curator,
        user_query
    )

    # Stream curator output (chunked)
    async for chunk in chunk_text(curated):
        yield chunk

    yield "\n\n---\n\n"

    # Stage 2: Analyst
    yield "📊 **Stage 2: Strategic Analyst**\n\n"
    yield "Analyzing curated news and generating strategic insights...\n\n"

    analysis = await loop.run_in_executor(
        None,
        run_analyst_agent,
        analyst,
        curated,
        "",  # company_context
        ""   # extra_questions
    )

    async for chunk in chunk_text(analysis):
        yield chunk

    yield "\n\n---\n\n"

    # Stage 3: Deep-Dive
    yield "🔬 **Stage 3: Deep-Dive Specialist**\n\n"
    yield "Generating comprehensive analysis...\n\n"

    deep = await loop.run_in_executor(
        None,
        run_deepdive_agent,
        deepdive,
        analysis,
        ""  # topic_hint
    )

    async for chunk in chunk_text(deep):
        yield chunk


async def chunk_text(text: str, chunk_size: int = 3) -> AsyncGenerator[str, None]:
    """
    Split text into chunks for streaming.

    Args:
        text: Full text to chunk
        chunk_size: Number of words per chunk
    """
    words = text.split()

    for i in range(0, len(words), chunk_size):
        chunk_words = words[i:i + chunk_size]
        chunk = " ".join(chunk_words)

        # Add space after chunk if not last
        if i + chunk_size < len(words):
            chunk += " "

        yield chunk
        await asyncio.sleep(0.02)  # Small delay for streaming effect
```

### 3. SSE Streaming Utilities (`streaming.py`)

```python
import json
import time
import uuid
from typing import AsyncGenerator

def format_sse_chunk(
    content: str,
    completion_id: str,
    model: str,
    finish_reason: str = None
) -> str:
    """
    Format content as OpenAI-compatible SSE chunk.
    """
    chunk = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {"content": content} if content else {},
            "finish_reason": finish_reason
        }]
    }
    return f"data: {json.dumps(chunk)}\n\n"


async def stream_workflow_response(
    workflow_generator: AsyncGenerator[str, None],
    model: str
) -> AsyncGenerator[str, None]:
    """
    Convert workflow text chunks to OpenAI SSE format.
    """
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    # Send role delta first
    role_chunk = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {"role": "assistant"},
            "finish_reason": None
        }]
    }
    yield f"data: {json.dumps(role_chunk)}\n\n"

    # Stream content chunks
    try:
        async for text_chunk in workflow_generator:
            yield format_sse_chunk(text_chunk, completion_id, model)
    except Exception as e:
        # Send error chunk
        error_chunk = {
            "error": {
                "message": str(e),
                "type": "internal_error"
            }
        }
        yield f"data: {json.dumps(error_chunk)}\n\n"
        return

    # Send final chunk with finish_reason
    yield format_sse_chunk("", completion_id, model, finish_reason="stop")

    # Send DONE signal
    yield "data: [DONE]\n\n"
```

### 4. FastAPI Server (`main.py`)

```python
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
import os
from dotenv import load_dotenv

from models import ChatCompletionRequest, ChatCompletionResponse
from agent_wrapper import execute_workflow_streaming
from streaming import stream_workflow_response

load_dotenv()

app = FastAPI(
    title="Research Agent API",
    description="OpenAI-compatible API for multi-agent research workflow",
    version="1.0.0"
)

# API Key validation
VALID_API_KEY = os.getenv("API_KEY")
if not VALID_API_KEY:
    raise ValueError("API_KEY environment variable not set")


def verify_api_key(authorization: Optional[str] = Header(None)) -> str:
    """Verify API key from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    # Handle "Bearer TOKEN" format
    token = authorization.replace("Bearer ", "").strip()

    if token != VALID_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return token


@app.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    OpenAI-compatible chat completions endpoint.
    """
    # Validate dependencies
    if not os.getenv("TOGETHER_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="TOGETHER_API_KEY not configured"
        )

    if not os.getenv("FIRECRAWL_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="FIRECRAWL_API_KEY not configured"
        )

    if request.stream:
        # Streaming response
        workflow_gen = execute_workflow_streaming(
            messages=request.messages,
            temperature=request.temperature
        )

        sse_stream = stream_workflow_response(
            workflow_generator=workflow_gen,
            model=request.model
        )

        return StreamingResponse(
            sse_stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  # Disable nginx buffering
            }
        )
    else:
        # Non-streaming response
        full_content = ""
        async for chunk in execute_workflow_streaming(
            messages=request.messages,
            temperature=request.temperature
        ):
            full_content += chunk

        import time
        import uuid

        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": request.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": full_content
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": sum(len(m.content.split()) for m in request.messages),
                "completion_tokens": len(full_content.split()),
                "total_tokens": sum(len(m.content.split()) for m in request.messages) + len(full_content.split())
            }
        }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "research-agent-api",
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "Research Agent API",
        "version": "1.0.0",
        "endpoints": {
            "chat_completions": "/v1/chat/completions",
            "health": "/health"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        log_level="info"
    )
```

### 5. Dependencies (`requirements.txt`)

```txt
# FastAPI and server
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3
python-dotenv==1.0.0

# Agent workflow dependencies
haystack-ai==2.0.0
firecrawl-py==0.0.16
openai==1.0.0  # For Together AI (OpenAI-compatible)

# Optional: Rate limiting
slowapi==0.1.9
```

### 6. Environment Configuration (`.env`)

```bash
# API Wrapper Authentication
API_KEY=your_generated_api_key_here

# Agent Workflow Dependencies
TOGETHER_API_KEY=tgp_v1_YOUR_TOGETHER_KEY
FIRECRAWL_API_KEY=fc_YOUR_FIRECRAWL_KEY

# Model Configuration (optional, has default)
MODEL=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8

# Server Configuration
PORT=8000
```

### 7. Docker Configuration (`Dockerfile`)

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 8. Docker Compose (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  research-agent-api:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    volumes:
      - ./recruiting-prompts:/app/recruiting-prompts:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## Development Workflow

### Local Development Setup

```bash
# 1. Clone/navigate to agent workflow directory
cd /path/to/news-agent

# 2. Create project structure
mkdir -p agent-workflow-api
cd agent-workflow-api

# 3. Create files (main.py, models.py, etc.)
# ... copy implementations from above ...

# 4. Copy or symlink agent workflow and prompts
cp ../ta_three_agents.py .
cp -r ../recruiting-prompts .

# 5. Set up Python environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 6. Install dependencies
pip install -r requirements.txt

# 7. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 8. Generate API key for the wrapper
openssl rand -hex 32  # Use this as API_KEY in .env

# 9. Run server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Testing

**Test Health Endpoint**:

```bash
curl http://localhost:8000/health
```

**Test Non-Streaming**:

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "research-agent-v1",
    "messages": [
      {"role": "user", "content": "What are the latest recruiting trends?"}
    ],
    "stream": false
  }'
```

**Test Streaming**:

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "research-agent-v1",
    "messages": [
      {"role": "user", "content": "Analyze AI in recruiting"}
    ],
    "stream": true
  }'
```

**Test with Python OpenAI Client**:

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="http://localhost:8000/v1"
)

stream = client.chat.completions.create(
    model="research-agent-v1",
    messages=[
        {"role": "user", "content": "Latest DACH recruiting news?"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

## Deployment Guide

### Railway.com Deployment

1. **Prepare Repository**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Research Agent API"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Create Railway Project**:
   - Visit [railway.app](https://railway.app)
   - Create new project from GitHub repo
   - Railway auto-detects Python and Dockerfile

3. **Configure Environment Variables** in Railway dashboard:
   - `API_KEY=<your-generated-key>`
   - `TOGETHER_API_KEY=<your-together-key>`
   - `FIRECRAWL_API_KEY=<your-firecrawl-key>`
   - `PORT=8000` (Railway may override)

4. **Deploy**:
   - Railway auto-deploys on commit
   - Get deployment URL: `https://<your-app>.railway.app`

5. **Update LibreChat**:
   - Edit LibreChat's `librechat.yaml`:
     ```yaml
     endpoints:
       custom:
         - name: "research-agent"
           apiKey: "${RESEARCH_AGENT_API_KEY}"
           baseURL: "https://<your-app>.railway.app"
           models:
             default: ["research-agent-v1"]
     ```
   - Add to LibreChat's `.env`:
     ```bash
     RESEARCH_AGENT_API_KEY=<same-as-API_KEY-above>
     ```

### Alternative: Docker Deployment

```bash
# Build image
docker build -t research-agent-api .

# Run container
docker run -d \
  --name research-agent-api \
  -p 8000:8000 \
  --env-file .env \
  -v $(pwd)/recruiting-prompts:/app/recruiting-prompts:ro \
  research-agent-api

# Or use docker-compose
docker-compose up -d
```

---

## Error Handling Strategy

### API-Level Errors

```python
# In main.py
from fastapi import HTTPException

# Missing API keys
if not os.getenv("TOGETHER_API_KEY"):
    raise HTTPException(status_code=500, detail="TOGETHER_API_KEY not configured")

# Invalid request
if not request.messages:
    raise HTTPException(status_code=400, detail="messages field is required")
```

### Workflow-Level Errors

```python
# In agent_wrapper.py
try:
    curated = await loop.run_in_executor(None, run_curator_agent, curator, user_query)
except Exception as e:
    yield f"\n\n❌ Error in Stage 1: {str(e)}\n\n"
    return
```

### Streaming Error Format

```python
# In streaming.py
except Exception as e:
    error_chunk = {
        "error": {
            "message": str(e),
            "type": "internal_error",
            "code": "workflow_execution_failed"
        }
    }
    yield f"data: {json.dumps(error_chunk)}\n\n"
```

---

## Monitoring & Logging

### Logging Setup

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# In endpoints
@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest, ...):
    logger.info(f"Request: {request.model}, messages: {len(request.messages)}")
    # ... handle request ...
    logger.info(f"Response completed for {request.model}")
```

### Metrics to Track

- Request count by endpoint
- Average response time per stage
- Error rate by stage
- API key usage
- Together AI API costs (token usage)
- FireCrawl API usage

---

## Security Considerations

### API Key Generation

```bash
# Generate secure random key
openssl rand -hex 32
# Example: 7f3d9c2a1b8e4f6d5a2c9e1b7f3d9c2a1b8e4f6d5a2c9e1b7f3d9c2a1b8e
```

### Rate Limiting (Optional)

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/v1/chat/completions")
@limiter.limit("10/minute")
async def chat_completions(...):
    ...
```

### CORS Configuration (if needed)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-librechat-domain.com"],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)
```

---

## Optimization Opportunities

### Future Enhancements

1. **True Async Streaming**:
   - Refactor Haystack agent execution to stream tokens as they're generated
   - Requires modifying Together AI client calls

2. **Caching**:
   - Cache recent queries (Redis)
   - Cache FireCrawl search results (short TTL)

3. **Parallel Tool Execution**:
   - Run multiple FireCrawl searches concurrently in Stage 1

4. **Context Management**:
   - Support conversation history for follow-up questions
   - Maintain user sessions

5. **Model Selection**:
   - Allow different models per stage
   - Support model parameter override from request

6. **Progress Webhooks**:
   - Optional webhook for stage completion notifications

---

## Troubleshooting Guide

### Common Issues

**Issue**: "TOGETHER_API_KEY not found"
- **Solution**: Ensure `.env` file exists and contains `TOGETHER_API_KEY=...`
- Check that `load_dotenv()` is called before accessing env vars

**Issue**: "Prompt file not found"
- **Solution**: Verify `recruiting-prompts/` directory exists in project root
- Check file paths match exactly (case-sensitive)

**Issue**: Streaming stops mid-response
- **Solution**: Check nginx/reverse proxy buffering settings
- Add header: `X-Accel-Buffering: no`

**Issue**: Timeout errors
- **Solution**: Increase timeout in deployment platform
- Railway: Adjust timeout in service settings
- Consider breaking into smaller requests

**Issue**: "Invalid finish_reason"
- **Solution**: Ensure last chunk has `finish_reason: "stop"`
- Verify `[DONE]` signal is sent

---

## Testing Checklist

- [ ] Health endpoint returns 200
- [ ] Authentication rejects invalid API keys
- [ ] Non-streaming mode returns complete response
- [ ] Streaming mode sends SSE format correctly
- [ ] Stage progress markers appear in stream
- [ ] All three stages execute successfully
- [ ] Error handling works for missing env vars
- [ ] Error handling works for invalid queries
- [ ] Timeout handling works (if stages exceed timeout)
- [ ] Response format matches OpenAI spec exactly
- [ ] Integration with LibreChat works end-to-end

---

## Next Steps

1. **Set up project structure** following the architecture above
2. **Implement core components**:
   - Models (Pydantic schemas)
   - Agent wrapper (async streaming)
   - Streaming utilities (SSE formatting)
   - FastAPI server (endpoints + auth)
3. **Test locally** with curl and Python client
4. **Deploy to Railway** (or preferred platform)
5. **Configure LibreChat** to use custom endpoint
6. **Test integration** end-to-end
7. **Monitor and optimize** based on usage patterns

---

**Document Status**: Implementation guide ready
**Created**: 2025-11-19
**Target Project**: `/Users/pablooliva/Dev/AI dev/news agent/`
**Integration Target**: LibreChat custom endpoint
