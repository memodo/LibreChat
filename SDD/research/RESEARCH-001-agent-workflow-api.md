# RESEARCH-001-agent-workflow-api

## System Data Flow

### Entry Points
- **LibreChat Custom Endpoint**: `librechat.yaml` configuration → `endpoints.custom` array
  - Location: `/Users/pablooliva/Dev/AI dev/LibreChat/librechat.yaml`
  - Format: OpenAI-compatible endpoint configuration

### Target Agent Workflow
- **File**: `/Users/pablooliva/Dev/AI dev/news agent/ta_three_agents.py`
- **Architecture**: Three-stage sequential pipeline
  1. **Stage 1 - Curator**: News gathering via FireCrawl web search tool
  2. **Stage 2 - Analyst**: Strategic analysis from curated news
  3. **Stage 3 - Deep-Dive**: Comprehensive analysis of selected topic
- **Technology Stack**:
  - Haystack Agents framework
  - Together AI (OpenAI-compatible API at `https://api.together.xyz/v1`)
  - FireCrawl API for web search
  - Model: `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8`

### Data Transformations
1. **User Query** → LibreChat UI
2. **LibreChat** → Custom API endpoint (`POST /v1/chat/completions`)
3. **API Wrapper** → Agent workflow execution
4. **Agent Pipeline**:
   - Query → Curator (with web search) → Curated news text
   - Curated news → Analyst → Strategic analysis text
   - Strategic analysis → Deep-Dive → Final comprehensive report
5. **Streaming Response** → LibreChat UI via SSE

### External Dependencies
- **Together AI API**: `https://api.together.xyz/v1` (requires `TOGETHER_API_KEY`)
- **FireCrawl API**: Web search service (requires `FIRECRAWL_API_KEY`)
- **MongoDB**: LibreChat conversation storage
- **Redis** (optional): LibreChat caching

### Integration Points
- **Configuration Loading**: `api/server/services/Config/loadCustomConfig.js:42` - Loads librechat.yaml
- **Endpoint Config Extraction**: `packages/api/src/app/config.ts:54-69` - Gets custom endpoint config
- **Client Initialization**: `api/server/services/Endpoints/custom/initialize.js:26-171` - Creates OpenAIClient
- **Route Handler**: `api/server/routes/edit/custom.js:1-26` - POST /api/edit/custom
- **Controller**: `api/server/controllers/EditController.js:136-184` - Main request handler
- **OpenAI Client**: `api/app/clients/OpenAIClient.js:760-1210` - HTTP client with streaming
- **SSE Event Sender**: `packages/api/src/utils/events.ts:1-26` - sendEvent() function
- **Stream Handler**: `SplitStreamHandler` - Processes OpenAI SSE chunks
- **OpenAI Compatibility**: Must match OpenAI chat completions format exactly
- **Authentication**: API key via Bearer token in Authorization header

## Stakeholder Mental Models

### Product Team Perspective
- **Goal**: Enable users to interact naturally with research agent in chat interface
- **UX Expectations**:
  - Streaming responses (like ChatGPT)
  - Real-time progress updates
  - Follow-up questions work naturally
  - Research agent appears as selectable model in UI
- **Success Metrics**:
  - Response appears to stream in real-time
  - Conversation history maintained
  - Multi-turn conversations work

### Engineering Team Perspective
- **Integration Requirements**:
  - Minimal changes to existing LibreChat codebase
  - External API wrapper approach (decoupled architecture)
  - Maintainable and testable
- **Technical Concerns**:
  - Agent workflow is synchronous Python script
  - Needs async/streaming adapter
  - Three stages = long execution time (up to 3+ minutes)
  - Need chunking strategy for user feedback
- **Deployment**: Separate service (Railway.com or similar)

### Support Team Perspective
- **Operational Concerns**:
  - Long response times (multi-stage agent pipeline)
  - External API dependencies (Together AI, FireCrawl)
  - API rate limits and costs
  - Error handling for multi-stage failures
- **Monitoring Needs**:
  - Request logging
  - Stage completion tracking
  - Error details for debugging

### User Perspective
- **Expectations**:
  - Ask question about recruiting/HR news
  - Get comprehensive research results
  - Natural chat experience
- **Pain Points**:
  - Long wait times without feedback
  - Need intermediate progress updates

## Production Edge Cases

### Agent Workflow Characteristics
1. **Synchronous Execution**:
   - Current implementation is not async
   - Each stage waits for previous stage completion
   - Total execution time: 30s + 60s + 120s = 3.5 minutes (max)

2. **Output Format**:
   - Returns complete text (no native streaming)
   - Three separate markdown documents
   - Needs chunking for SSE streaming

3. **Error Scenarios**:
   - FireCrawl API failures → Curator stage fails
   - Together AI timeouts → Any stage can fail
   - Missing API keys → Immediate failure
   - Invalid model name → OpenAI client error

4. **Tool Usage**:
   - Only Curator agent uses tools (web_search)
   - Analyst and Deep-Dive agents are text-only (expected warnings in logs)

### LibreChat Integration Issues
1. **Timeout Handling**:
   - LibreChat default timeout may be too short
   - Need to configure longer timeout in endpoint config

2. **Streaming Buffer**:
   - SSE format must be exact: `data: {json}\n\n`
   - Reverse proxy buffering can break streaming

3. **API Key Management**:
   - LibreChat expects `Authorization: Bearer {key}` header
   - Must be configured in `.env` as `RESEARCH_AGENT_API_KEY`

4. **Model Selection**:
   - LibreChat sends `model` field in request
   - API wrapper should accept but ignore (uses Together AI internally)

## Files That Matter

### LibreChat Core Files

#### Configuration Layer
- **librechat.yaml** - Custom endpoint definition at project root
- **.env** - API key storage (e.g., `RESEARCH_AGENT_API_KEY`)
- **docker-compose.override.yml** - Volume mount for config

#### Configuration Loading Pipeline
- **api/server/services/Config/loadCustomConfig.js**
  - `loadCustomConfig()` - Reads and validates librechat.yaml
  - `loadYaml(configPath)` - YAML parser with env var resolution
  - `configSchema.strict().safeParse()` - Schema validation
- **api/server/services/Config/app.js**
  - `getAppConfig()` - Loads config and caches in Redis
- **packages/api/src/app/config.ts**
  - `getCustomEndpointConfig()` - Extracts specific endpoint config
  - `normalizeEndpointName()` - Normalizes for comparison
- **api/server/services/Config/loadConfigModels.js**
  - Extracts model lists, supports `models.fetch` for dynamic loading

#### Request Handling Pipeline
- **api/server/routes/edit/custom.js**
  - Route: POST /api/edit/custom
  - Middleware: validateEndpoint → validateModel → buildEndpointOption → setHeaders
- **api/server/controllers/EditController.js:136-184**
  - Initializes client, sends message, handles response
- **api/server/services/Endpoints/custom/initialize.js**
  - `initializeClient()` - Creates OpenAIClient for custom endpoint
  - Extracts env vars: `extractEnvVariable(apiKey, baseURL)`
  - Resolves custom headers with user context
  - Creates OpenAI SDK client with custom baseURL

#### HTTP Client & Streaming
- **api/app/clients/OpenAIClient.js**
  - Line 760-1210: `chatCompletion()` - Main streaming method
  - Line 880-887: Creates OpenAI SDK client with custom baseURL
  - Line 1023-1024: `openai.chat.completions.stream(params)`
  - Line 1070-1086: Stream consumption with rate control
  - Line 795-797: Custom header injection
  - Line 921-965: Custom param add/drop logic
- **packages/api/src/utils/generators.ts:15-42**
  - `createFetch()` - Custom fetch with URL override for directEndpoint
- **api/app/clients/tools/util/handleOpenAIErrors.js**
  - Error handling for OpenAI-compatible endpoints

#### SSE & Stream Processing
- **packages/api/src/utils/events.ts:1-26**
  - `sendEvent(res, event)` - Formats and sends SSE to client
  - Format: `event: message\ndata: ${JSON.stringify(event)}\n\n`
- **api/server/utils/handleText.js:24-68**
  - `createOnProgress()` - Progress callback for streaming
  - Calls `sendEvent()` for each chunk
- **SplitStreamHandler** (referenced in OpenAIClient.js:1004-1012)
  - Processes OpenAI SSE chunks
  - Accumulates text, extracts reasoning/thinking blocks

### Agent Workflow Files
- **Main Script**: `/Users/pablooliva/Dev/AI dev/news agent/ta_three_agents.py`
  - Entry point: `main()` function
  - CLI-based (uses argparse)
  - Outputs to files (not streaming)

- **Prompts** (external dependencies):
  - `recruiting-prompts/prompt_1_news_curator.md`
  - `recruiting-prompts/prompt_2_strategic_analyst.md`
  - `recruiting-prompts/prompt_3_deep_dive.md`

### New API Wrapper Files (To Be Created)
- **FastAPI Server**: `main.py`
- **Request/Response Models**: `models.py`
- **Workflow Integration**: `agent_workflow.py`
- **Requirements**: `requirements.txt`
- **Configuration**: `.env`
- **Deployment**: `Dockerfile`, `docker-compose.yml`

## Security Considerations

### Authentication/Authorization
- **API Key**: Simple bearer token authentication
  - Generate with: `openssl rand -hex 32`
  - Store in LibreChat `.env` and API wrapper `.env`
  - Validate on every request

- **Rate Limiting**: Should implement to prevent abuse
  - Recommended: 10 requests/minute per user
  - Library: `slowapi` for FastAPI

### Data Privacy
- **User Queries**: Contains potentially sensitive business questions
  - Log only summary/metadata, not full content
  - Comply with GDPR (Memodo operates in EU)

- **API Keys**: Must never be exposed in responses or logs
  - Use environment variables
  - Mask in error messages

### Input Validation
- **Request Validation**: Pydantic models handle basic validation
- **Query Length**: Should limit message content length
- **Message History**: Limit number of messages in conversation

## Testing Strategy

### Unit Tests
- **API Wrapper**:
  - Request/response model validation
  - SSE formatting
  - API key validation
  - Error handling

- **Workflow Integration**:
  - Message extraction from LibreChat format
  - Chunking strategy for streaming
  - Stage-by-stage execution

### Integration Tests
- **End-to-End Flow**:
  - LibreChat → API wrapper → mock agent response → LibreChat
  - Test with curl commands
  - Test with Python OpenAI client

- **Streaming Tests**:
  - Verify SSE format correctness
  - Test partial response handling
  - Test connection interruption

### Edge Cases to Test
1. **Empty/invalid queries**
2. **Very long queries** (token limits)
3. **API timeouts** (Together AI or FireCrawl)
4. **Missing API keys**
5. **Invalid authentication**
6. **Concurrent requests**
7. **Network interruptions during streaming**

## Documentation Needs

### User-Facing Docs
- **How to use Research Agent in LibreChat**:
  - Select "Research Agent" from model dropdown
  - Example queries
  - Expected response times
  - Limitations (DACH/recruiting focus)

### Developer Docs
- **API Wrapper Documentation**:
  - Architecture overview
  - Request/response formats
  - Error codes and messages
  - Deployment instructions

- **Agent Workflow Integration**:
  - How to modify agent prompts
  - How to add new stages
  - Monitoring and debugging

### Configuration Docs
- **LibreChat Setup**:
  - `librechat.yaml` configuration
  - Environment variables
  - Docker setup

- **API Wrapper Setup**:
  - Environment variables
  - Running locally
  - Running in production
  - Health checks

## LibreChat Integration - Detailed Findings

### Custom Endpoint Request Flow
```
Frontend sends message
  ↓
POST /api/edit/custom
  ↓
Middleware Chain:
  • validateEndpoint - Checks endpoint exists in config
  • validateModel - Validates model availability
  • buildEndpointOption - Builds request options
  • setHeaders - Sets SSE headers (Content-Type: text/event-stream)
  ↓
EditController.js:136-141
  • initializeClient({ req, res, endpointOption })
  ↓
custom/initialize.js:26-171
  • getCustomEndpointConfig() - Extract endpoint config
  • extractEnvVariable(apiKey) - Resolve ${RESEARCH_AGENT_API_KEY}
  • extractEnvVariable(baseURL) - Resolve URL
  • resolveHeaders() - Inject custom headers with user context
  • new OpenAIClient(apiKey, clientOptions)
  ↓
EditController.js:168-184
  • client.sendMessage(text, { progressCallback, progressOptions: { res } })
  ↓
OpenAIClient.js:760-1210 - chatCompletion()
  • Extract baseURL from completionsUrl (line 781)
  • Apply addParams/dropParams (lines 921-965)
  • Inject custom headers (lines 795-797)
  • Create OpenAI SDK client with custom baseURL (lines 880-887)
  • Call openai.chat.completions.stream(params) (line 1023)
    → Makes: POST {baseURL}/v1/chat/completions
    → Headers: Authorization: Bearer {RESEARCH_AGENT_API_KEY}
  • For each chunk in stream (lines 1070-1086):
    - Add finish_reason: null if missing
    - streamHandler.handle(chunk)
    - await sleep(streamRate)  # Rate control from config
  ↓
handleText.js:24-68 - progressCallback
  • Accumulates chunk text
  • Calls sendEvent(res, payload)
  ↓
events.ts:1-26 - sendEvent()
  • Formats SSE: "event: message\ndata: {...}\n\n"
  • res.write() to client
  ↓
Frontend EventSource
  • Receives real-time chunks
  • Displays in chat UI
```

### OpenAI-Compatible Request Format Expected
```json
POST {baseURL}/v1/chat/completions
Headers:
  Content-Type: application/json
  Authorization: Bearer {RESEARCH_AGENT_API_KEY}
  {custom headers from librechat.yaml if configured}

Body:
{
  "model": "research-agent-v1",
  "messages": [
    {"role": "user", "content": "What are the latest recruiting trends?"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4000,
  "top_p": 1.0
  // + any addParams from librechat.yaml
  // - any dropParams from librechat.yaml
}
```

### OpenAI-Compatible Response Format Expected
```
Content-Type: text/event-stream

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1699000000,"model":"research-agent-v1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Key Configuration Options for librechat.yaml
```yaml
endpoints:
  custom:
    - name: "research-agent"
      apiKey: "${RESEARCH_AGENT_API_KEY}"
      baseURL: "http://localhost:8000"  # or production URL
      models:
        default: ["research-agent-v1"]
        fetch: false
      titleConvo: true
      titleModel: "research-agent-v1"
      modelDisplayLabel: "Research Agent"
      streamRate: 25  # Milliseconds between chunks (25-40 recommended)
      directEndpoint: false  # False = LibreChat appends /v1/chat/completions
      # Optional custom headers (can reference env vars or user context)
      headers:
        X-Custom-Header: "value"
      # Optional parameter manipulation
      addParams:
        custom_field: "value"
      dropParams:
        - "unsupported_param"
```

### SSE Format Details
LibreChat wraps OpenAI chunks in its own event format:
- **Intermediate chunks**: `event: message\ndata: {"text":"Hello","initial":false,"message":true}\n\n`
- **Final event**: `event: message\ndata: {"final":true,"conversation":{...},"responseMessage":{...}}\n\n`

The OpenAIClient extracts content from OpenAI SSE format and reformats for LibreChat's frontend.

## Critical Design Decisions

### Question 1: Async Workflow Adapter Strategy
**Options Analyzed:**

**A. Subprocess Execution**
- Run `ta_three_agents.py` as subprocess from FastAPI
- Capture stdout/stderr for streaming
- **Pros**: Minimal changes to existing workflow
- **Cons**: Hard to stream intermediate progress, process management complexity

**B. Async Generator Refactor**
- Convert workflow to async generator that yields chunks
- Modify Haystack agent execution to stream results
- **Pros**: True streaming, fine-grained control
- **Cons**: Significant refactoring of existing code

**C. Hybrid: Stage-by-Stage Streaming**
- Run each stage synchronously
- Stream complete stage outputs as they finish
- Add stage progress markers (e.g., "🔍 Stage 1: Curator...")
- **Pros**: Moderate refactoring, provides feedback during long execution
- **Cons**: Not word-by-word streaming, but good enough UX

**RECOMMENDATION**: **Option C - Stage-by-Stage Streaming**
- Provides intermediate feedback without massive refactoring
- Each stage completion triggers a stream chunk
- Stage boundaries are natural breakpoints in the workflow
- Can add simulated word-by-word streaming by chunking stage outputs

### Question 2: Deployment Architecture
**Options:**

**A. Co-located Services**
- FastAPI wrapper + agent scripts in same container/deployment
- Single Railway.com deployment
- **Pros**: Simple deployment, shared file system for prompts
- **Cons**: Larger container, more dependencies

**B. Separated Services**
- FastAPI wrapper separate from agent execution environment
- Agent could be serverless function or separate container
- **Pros**: Independent scaling, lighter API container
- **Cons**: More complex deployment, network latency

**RECOMMENDATION**: **Option A - Co-located**
- Simpler for initial deployment
- Agent scripts have local file dependencies (prompt .md files)
- Railway.com supports Python environments well
- Can refactor to separate services later if needed

### Question 3: Progress Feedback Strategy
**Challenge**: 3.5-minute max execution time needs user feedback

**Solution - Multi-Level Progress**:
1. **Stage Headers**: Stream stage start messages
   - "🔍 Stage 1: News Curator - Searching for relevant articles..."
   - "📊 Stage 2: Strategic Analyst - Analyzing trends..."
   - "🔬 Stage 3: Deep-Dive Specialist - Generating comprehensive report..."

2. **Stage Completion**: Stream complete stage output when done
   - Curator output → stream immediately
   - Analyst output → stream immediately
   - Deep-Dive output → stream immediately

3. **Word-by-Word Chunking**: Split stage outputs into words/sentences
   - After stage completes, yield chunks with small delays
   - Simulates streaming UX without workflow changes

4. **Optional Tool Usage Feedback**: If Curator uses web_search tool
   - Stream: "Searching: {query}..."
   - Stream: "Found 10 results, analyzing..."

## Implementation Plan

### Phase 1: API Wrapper Development
1. Create FastAPI server with OpenAI-compatible endpoints
2. Implement SSE streaming response format
3. Add API key authentication
4. Implement stage-by-stage streaming wrapper

### Phase 2: Workflow Integration
1. Import and wrap `ta_three_agents.py` functions
2. Create async generator for stage-by-stage execution
3. Add progress markers and stage headers
4. Implement chunking for stage outputs

### Phase 3: LibreChat Configuration
1. Add custom endpoint to `librechat.yaml`
2. Configure environment variables
3. Test local integration
4. Verify streaming behavior

### Phase 4: Deployment
1. Set up Railway.com project
2. Configure environment variables
3. Deploy API wrapper + agent scripts
4. Update LibreChat baseURL to production URL
5. Monitor and optimize

### Phase 5: Testing & Refinement
1. Test end-to-end flow
2. Optimize stream rate and chunking
3. Add error handling and retries
4. Monitor performance and costs

---

**Status**: Research complete - Ready for specification phase
**Date**: 2025-11-19
**Next**: Create implementation specification based on findings
