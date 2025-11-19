# LibreChat Agent Workflow Integration - Implementation Guide

## Project Overview

**Objective:** Create an OpenAI-compatible API endpoint that wraps a multi-agent research workflow and integrates it with LibreChat, allowing users to chat naturally with research results in the LibreChat interface.

**User:** Pablo at Memodo (368 employees across 4 European countries)

**Context:** The user wants to integrate an agent workflow system that performs research on current news, analysis, and deep thinking. Results should be returned and displayed within LibreChat's chat interface, with streaming support for real-time updates.

---

## Architecture Overview

```
User Query → LibreChat UI → Custom API Endpoint → Agent Workflow → Streaming Response → LibreChat UI
```

### Components:
1. **LibreChat** - Frontend chat interface (already set up)
2. **Custom API Wrapper** - FastAPI server that accepts OpenAI-compatible requests
3. **Agent Workflow** - Existing research agent system (assumed to exist)
4. **Streaming Bridge** - SSE implementation to stream results back

---

## Technical Requirements

### 1. API Endpoint Specification

The custom endpoint must be OpenAI-compatible with the following structure:

**Endpoint:** `POST /v1/chat/completions`

**Request Format:**
```json
{
  "model": "research-agent",
  "messages": [
    {"role": "user", "content": "Research the latest developments in AI regulation"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4000
}
```

**Response Format (Streaming):**

Server-Sent Events (SSE) format with `Content-Type: text/event-stream`:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent","choices":[{"index":0,"delta":{"content":"Based"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent","choices":[{"index":0,"delta":{"content":" on"},"finish_reason":null}]}

...

data: [DONE]
```

**Response Format (Non-Streaming):**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1699000000,
  "model": "research-agent",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Complete response here"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 100,
    "total_tokens": 110
  }
}
```

### 2. LibreChat Configuration

**File:** `librechat.yaml` (at project root)

```yaml
version: 1.1.9

endpoints:
  custom:
    - name: "Research Agent"
      apiKey: "${RESEARCH_AGENT_API_KEY}"  # Set in .env
      baseURL: "https://your-api-domain.com"  # or http://localhost:8000 for local dev
      models:
        default: ["research-agent-v1"]
      titleConvo: true
      titleModel: "research-agent-v1"
      streamRate: 25  # Recommended 25-40 for smooth streaming
      modelDisplayLabel: "Research Agent"
      directEndpoint: false  # LibreChat will append /v1/chat/completions
      # Optional: Add custom headers if needed
      # headers:
      #   X-Custom-Header: "value"
```

**File:** `.env` (add this line)
```bash
RESEARCH_AGENT_API_KEY=your_api_key_here
```

**File:** `docker-compose.override.yml` (if using Docker)
```yaml
version: '3.4'

services:
  api:
    volumes:
      - ./librechat.yaml:/app/librechat.yaml
```

---

## Implementation Steps

### Step 1: Create FastAPI Wrapper

**File Structure:**
```
agent-api/
├── main.py
├── models.py
├── agent_workflow.py
├── requirements.txt
└── .env
```

**requirements.txt:**
```txt
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3
python-dotenv==1.0.0
httpx==0.26.0
```

**models.py:**
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
    frequency_penalty: Optional[float] = 0.0
    presence_penalty: Optional[float] = 0.0

class ChatCompletionChoice(BaseModel):
    index: int
    message: Optional[ChatMessage] = None
    delta: Optional[dict] = None
    finish_reason: Optional[str] = None

class ChatCompletionResponse(BaseModel):
    id: str
    object: Literal["chat.completion", "chat.completion.chunk"]
    created: int
    model: str
    choices: List[ChatCompletionChoice]
    usage: Optional[dict] = None
```

**main.py:**
```python
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import StreamingResponse
from models import ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChoice, ChatMessage
from agent_workflow import execute_agent_workflow
import json
import time
import uuid
from typing import Optional
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Research Agent API")

# Simple API key validation
VALID_API_KEY = os.getenv("RESEARCH_AGENT_API_KEY", "default_key")

def verify_api_key(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing API key")
    
    # Handle "Bearer TOKEN" format
    token = authorization.replace("Bearer ", "")
    
    if token != VALID_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return token

@app.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    api_key: str = Header(None, alias="authorization", convert_underscores=True)
):
    # Verify API key
    verify_api_key(api_key)
    
    # Generate unique ID for this completion
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_timestamp = int(time.time())
    
    if request.stream:
        return StreamingResponse(
            stream_agent_response(request, completion_id, created_timestamp),
            media_type="text/event-stream"
        )
    else:
        return await generate_non_streaming_response(request, completion_id, created_timestamp)

async def stream_agent_response(request: ChatCompletionRequest, completion_id: str, created: int):
    """
    Generator function that streams the agent workflow results as SSE
    """
    try:
        # First, send role delta
        yield format_sse_message({
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": request.model,
            "choices": [{
                "index": 0,
                "delta": {"role": "assistant"},
                "finish_reason": None
            }]
        })
        
        # Execute agent workflow and stream results
        # This is where you integrate your agent workflow
        async for chunk in execute_agent_workflow(request.messages, request.temperature):
            yield format_sse_message({
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": request.model,
                "choices": [{
                    "index": 0,
                    "delta": {"content": chunk},
                    "finish_reason": None
                }]
            })
        
        # Send final chunk
        yield format_sse_message({
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": request.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop"
            }]
        })
        
        # Send DONE signal
        yield "data: [DONE]\n\n"
        
    except Exception as e:
        # Send error in SSE format
        yield format_sse_message({
            "error": {
                "message": str(e),
                "type": "internal_error"
            }
        })

async def generate_non_streaming_response(request: ChatCompletionRequest, completion_id: str, created: int):
    """
    Generate complete response without streaming
    """
    try:
        # Collect all chunks
        full_content = ""
        async for chunk in execute_agent_workflow(request.messages, request.temperature):
            full_content += chunk
        
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def format_sse_message(data: dict) -> str:
    """Format data as Server-Sent Event"""
    return f"data: {json.dumps(data)}\n\n"

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "research-agent-api"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

**agent_workflow.py:**
```python
from typing import AsyncGenerator, List
from models import ChatMessage
import asyncio

async def execute_agent_workflow(
    messages: List[ChatMessage],
    temperature: float = 0.7
) -> AsyncGenerator[str, None]:
    """
    This is where you integrate your actual agent workflow.
    This is a placeholder that simulates an agent workflow with streaming.
    
    Replace this with your actual agent workflow implementation.
    
    Args:
        messages: List of chat messages (conversation history)
        temperature: Temperature parameter for generation
        
    Yields:
        str: Chunks of the response text
    """
    # Extract the user's query (last user message)
    user_query = next((m.content for m in reversed(messages) if m.role == "user"), "")
    
    # TODO: Replace this with your actual agent workflow
    # Your workflow should:
    # 1. Accept the user query and conversation history
    # 2. Execute your research pipeline (news gathering, analysis, etc.)
    # 3. Stream results back as they become available
    
    # Placeholder implementation - simulates streaming response
    response_text = f"""Based on my research and analysis regarding: "{user_query}"

Here are my findings:

1. Current Context: [Your agent would gather current news and context here]

2. Analysis: [Your agent would perform deep analysis here]

3. Key Insights:
   - Insight 1
   - Insight 2
   - Insight 3

4. Recommendations: [Your agent would provide recommendations here]

This is where your multi-agent research workflow would stream its actual findings."""
    
    # Simulate streaming by yielding words one at a time
    words = response_text.split()
    for i, word in enumerate(words):
        yield word + (" " if i < len(words) - 1 else "")
        await asyncio.sleep(0.05)  # Simulate processing time
        
    # TODO: Replace the above with actual integration like:
    # async for result_chunk in your_agent_workflow.run(user_query):
    #     yield result_chunk
```

### Step 2: Running the API

**Development:**
```bash
cd agent-api
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Production (with Docker):**

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  research-agent-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - RESEARCH_AGENT_API_KEY=${RESEARCH_AGENT_API_KEY}
    restart: unless-stopped
```

### Step 3: Testing the Integration

**Test with curl:**
```bash
# Non-streaming test
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key_here" \
  -d '{
    "model": "research-agent-v1",
    "messages": [{"role": "user", "content": "What are the latest developments in AI?"}],
    "stream": false
  }'

# Streaming test
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key_here" \
  -d '{
    "model": "research-agent-v1",
    "messages": [{"role": "user", "content": "Research AI regulation trends"}],
    "stream": true
  }'
```

**Test with Python:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="your_api_key_here",
    base_url="http://localhost:8000/v1"
)

# Streaming
stream = client.chat.completions.create(
    model="research-agent-v1",
    messages=[{"role": "user", "content": "Research quantum computing advances"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

---

## Integration with Your Agent Workflow

### Key Integration Points in `agent_workflow.py`:

You need to replace the placeholder in `execute_agent_workflow()` with your actual agent workflow. Here's the integration pattern:

```python
async def execute_agent_workflow(
    messages: List[ChatMessage],
    temperature: float = 0.7
) -> AsyncGenerator[str, None]:
    """
    Integrate your agent workflow here
    """
    # 1. Extract conversation context
    user_query = next((m.content for m in reversed(messages) if m.role == "user"), "")
    conversation_history = [{"role": m.role, "content": m.content} for m in messages]
    
    # 2. Initialize your agent workflow
    # Example: agent = YourAgentWorkflow(query=user_query, history=conversation_history)
    
    # 3. Execute and stream results
    # Option A: If your workflow already supports streaming
    # async for chunk in agent.run_streaming():
    #     yield chunk
    
    # Option B: If your workflow returns complete results, you can chunk them
    # result = await agent.run()
    # for sentence in split_into_sentences(result):
    #     yield sentence + " "
    #     await asyncio.sleep(0.1)  # Small delay for better UX
    
    # Option C: If your workflow has multiple stages, stream stage results
    # for stage in ["news_gathering", "analysis", "synthesis"]:
    #     yield f"\n\n## {stage.replace('_', ' ').title()}\n\n"
    #     result = await agent.execute_stage(stage)
    #     yield result
```

---

## Deployment Considerations

### 1. Production Deployment Options

**Railway.com (Since you've explored this):**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Digital Ocean / Azure / AWS:**
- Deploy using container services
- Ensure firewall rules allow HTTPS traffic
- Use environment variables for secrets

### 2. Security

- Use proper API keys (generate with `openssl rand -hex 32`)
- Enable HTTPS/TLS in production
- Consider rate limiting:
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/v1/chat/completions")
@limiter.limit("10/minute")
async def chat_completions(...):
    ...
```

### 3. Monitoring

Add logging:
```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest, ...):
    logger.info(f"Request from user: {request.messages[-1].content[:50]}...")
    # ... rest of code
```

---

## Troubleshooting

### Common Issues:

1. **LibreChat not showing custom endpoint:**
   - Verify `librechat.yaml` is in the correct location
   - Check docker-compose.override.yml mounts the file
   - Restart LibreChat containers: `docker-compose restart`

2. **Streaming not working:**
   - Ensure `Content-Type: text/event-stream` header is set
   - Verify SSE format: `data: {json}\n\n`
   - Check for buffering issues in reverse proxies (disable buffering for SSE)

3. **API authentication failing:**
   - Verify API key in .env matches request header
   - Check header format: `Authorization: Bearer YOUR_KEY`

4. **Timeout issues:**
   - Increase timeout in LibreChat config
   - Ensure your workflow completes within reasonable time
   - Consider chunking long operations

---

## References

### Documentation:
- LibreChat Custom Endpoints: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint
- OpenAI API Reference: https://platform.openai.com/docs/api-reference/chat
- FastAPI Documentation: https://fastapi.tiangolo.com/
- SSE Specification: https://html.spec.whatwg.org/multipage/server-sent-events.html

### Code Examples:
- Building OpenAI-Compatible APIs: https://towardsdatascience.com/how-to-build-an-openai-compatible-api-87c8edea2f06
- FastAPI + AutoGen Streaming: https://github.com/LineaLabs/autogen-fastapi
- Azure OpenAI Streaming: https://github.com/thivy/azure-openai-js-stream

---

## Next Steps for Claude Code

1. **Review** the placeholder implementation in `agent_workflow.py`
2. **Integrate** your actual multi-agent research workflow
3. **Test** locally with curl and LibreChat
4. **Deploy** to your preferred hosting platform
5. **Monitor** performance and adjust streaming rate as needed

## Questions to Consider

- What does your agent workflow currently look like? (Python? JavaScript? API-based?)
- Does it already support streaming, or will results need to be chunked?
- What's your deployment preference? (Railway, Docker, serverless, etc.)
- Do you need authentication beyond API keys? (OAuth, JWT, etc.)
- What's the expected response time for your agent workflow?

---

**Created:** 2025-11-18
**For:** Claude Code Implementation
**Context:** LibreChat integration for multi-agent research workflow with streaming support
