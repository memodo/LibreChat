# LibreChat Integration Summary - Research Agent

**Date**: 2025-11-19
**Status**: ✅ Configuration Complete

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         LibreChat                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Frontend (React)                                      │ │
│  │  - Model selector: "Research Agent"                    │ │
│  │  - Chat interface with streaming responses             │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────────────┐ │
│  │  Backend (Express/OpenAIClient)                        │ │
│  │  - Reads librechat.yaml config                         │ │
│  │  - Makes HTTP requests to custom endpoint              │ │
│  │  - Streams SSE responses to frontend                   │ │
│  └────────────────────┬───────────────────────────────────┘ │
└───────────────────────┼───────────────────────────────────────┘
                        │
                        │ HTTP POST /v1/chat/completions
                        │ Authorization: Bearer <API_KEY>
                        │ Content-Type: application/json
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              External Research Agent Project                 │
│              /Users/pablooliva/Dev/AI dev/news agent/       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  FastAPI Wrapper (TO BE IMPLEMENTED)                   │ │
│  │  - POST /v1/chat/completions endpoint                  │ │
│  │  - Bearer token authentication                         │ │
│  │  - OpenAI-compatible SSE streaming                     │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────────────┐ │
│  │  3-Stage Haystack Agent Pipeline (EXISTING)            │ │
│  │  - ta_three_agents.py                                  │ │
│  │  - Stage 1: News Curator (FireCrawl)                   │ │
│  │  - Stage 2: Strategic Analyst (Together AI)            │ │
│  │  - Stage 3: Deep-Dive Specialist (Together AI)         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## What Was Done in LibreChat

### 1. Custom Endpoint Configuration

**File**: `librechat.yaml` (lines 6-15)

```yaml
endpoints:
  custom:
    # Research Agent - Multi-stage news analysis pipeline
    - name: "research-agent"
      apiKey: "${RESEARCH_AGENT_API_KEY}"
      baseURL: "http://localhost:8000"  # Change to production URL when deployed
      models:
        default: ["research-agent-v1"]
        fetch: false
      titleConvo: true
      titleModel: "current_model"
      streamRate: 25
      modelDisplayLabel: "Research Agent"
```

**Configuration Explained:**
- **name**: Internal identifier for the endpoint
- **apiKey**: References environment variable for authentication
- **baseURL**: Where the research agent API is running
- **models**: Lists available models (only one: "research-agent-v1")
- **fetch**: false = don't try to fetch model list from endpoint
- **streamRate**: 25ms word-chunking delay for smooth streaming UX
- **modelDisplayLabel**: What users see in the model dropdown

### 2. Environment Variable

**File**: `.env` (lines 104-106)

```bash
# Research Agent - Custom endpoint for multi-stage news analysis
# Set this to match the API_KEY in your news agent project
RESEARCH_AGENT_API_KEY=your-research-agent-api-key-here
```

**Action Required:**
Replace `your-research-agent-api-key-here` with the actual API key from your news agent project.

## What Needs to be Done in News Agent Project

### Required Implementation

The news agent project needs a FastAPI wrapper that:

1. **Exposes OpenAI-compatible endpoint:**
   ```python
   POST /v1/chat/completions
   ```

2. **Request Format (OpenAI-compatible):**
   ```json
   {
     "model": "research-agent-v1",
     "messages": [
       {"role": "user", "content": "What are the latest recruiting trends?"}
     ],
     "stream": true
   }
   ```

3. **Authentication:**
   ```http
   Authorization: Bearer <API_KEY>
   ```

4. **Response Format (SSE stream):**
   ```
   data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":"🔍 Stage 1: News Curator..."},"finish_reason":null}]}

   data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":"text"},"finish_reason":null}]}

   data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"research-agent-v1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

   data: [DONE]
   ```

### Reference Documentation

All implementation details are in this LibreChat repo's SDD folder:

- **Specification**: `SDD/requirements/SPEC-001-agent-workflow-api.md`
  - Complete requirements (13 functional + non-functional)
  - Edge cases and failure scenarios
  - Implementation roadmap

- **Research**: `SDD/research/RESEARCH-001-agent-workflow-api.md`
  - LibreChat custom endpoint architecture
  - OpenAI compatibility requirements
  - Integration patterns

- **Implementation Guide**: `SDD/OpenAI_Compatible_SSE_Streaming_FastAPI.md`
  - FastAPI + asyncio patterns
  - SSE streaming best practices
  - OpenAI format requirements

- **Code Templates**: `SDD/FastAPI_SSE_Code_Templates.md`
  - Ready-to-use code snippets
  - Example implementations

## Testing the Integration

### Step 1: Implement and Start Research Agent

In news agent project:
```bash
# Implement FastAPI wrapper (see reference docs above)
# Set API_KEY in .env
python fastapi_wrapper.py  # Or whatever you name it
```

### Step 2: Configure LibreChat API Key

In LibreChat `.env`:
```bash
RESEARCH_AGENT_API_KEY=<same-key-from-news-agent-project>
```

### Step 3: Start LibreChat

```bash
cd /Users/pablooliva/Dev/AI\ dev/LibreChat
npm run backend:dev  # Terminal 1
npm run frontend:dev # Terminal 2
```

### Step 4: Test in UI

1. Open LibreChat: `http://localhost:3080`
2. Click model dropdown
3. Select "Research Agent"
4. Send a research query
5. Verify streaming response with stage markers

### Expected Behavior

You should see streaming responses like:

```
🔍 Stage 1: News Curator - Searching for relevant articles...

Found 5 relevant articles about recruiting trends:
1. AI-powered hiring tools gain traction...
2. Remote work reshapes talent acquisition...

📊 Stage 2: Strategic Analyst - Analyzing trends and patterns...

**Key Insights:**
- Digital transformation accelerating...
- Candidate experience becoming competitive differentiator...

🔬 Stage 3: Deep-Dive Specialist - Generating comprehensive analysis...

**Deep-Dive Analysis: AI in Recruitment**

The integration of artificial intelligence into recruitment...
```

## Production Deployment

### Step 1: Deploy Research Agent

Deploy news agent to hosting platform:
- Railway.com
- Render.com
- Heroku
- AWS/GCP/Azure

Get production URL (e.g., `https://research-agent.railway.app`)

### Step 2: Update LibreChat Configuration

In `librechat.yaml`:
```yaml
baseURL: "https://research-agent.railway.app"  # Your production URL
```

### Step 3: Update API Keys

Set production API key in both:
- News agent project `.env`
- LibreChat `.env`

### Step 4: Restart LibreChat

```bash
# Docker deployment
docker-compose down && docker-compose up -d

# Development
npm run backend:dev && npm run frontend:dev
```

## API Key Synchronization

**Critical**: Both projects must use the **same API key**:

**News Agent Project** (`.env`):
```bash
API_KEY=your-secure-generated-key
```

**LibreChat** (`.env`):
```bash
RESEARCH_AGENT_API_KEY=your-secure-generated-key
```

Generate a secure key:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Troubleshooting

### LibreChat can't connect to research agent

**Check:**
1. Is research agent running? `curl http://localhost:8000/health`
2. Are API keys matching?
3. Is baseURL correct in `librechat.yaml`?

### Research agent returns 401 Unauthorized

**Check:**
- `RESEARCH_AGENT_API_KEY` in LibreChat `.env`
- `API_KEY` in news agent `.env`
- Both must be identical

### Streaming not working properly

**Check:**
- Response format matches OpenAI SSE specification exactly
- No reverse proxy buffering (set `X-Accel-Buffering: no` header)
- Content-Type is `text/event-stream`

### Model not appearing in dropdown

**Check:**
1. LibreChat restarted after config changes?
2. `librechat.yaml` syntax is valid YAML?
3. Environment variable properly set?

## Summary

**What's Done:**
- ✅ LibreChat configured to connect to external research agent
- ✅ Custom endpoint definition in `librechat.yaml`
- ✅ Environment variable placeholder in `.env`
- ✅ Documentation updated

**What's Next:**
- ⏳ Implement FastAPI wrapper in news agent project
- ⏳ Wrap existing `ta_three_agents.py` pipeline
- ⏳ Implement OpenAI-compatible SSE streaming
- ⏳ Test end-to-end integration
- ⏳ Deploy to production

**Key Insight:**
LibreChat integration is **purely configuration-based**. No LibreChat code changes required. All implementation work happens in the news agent project.
