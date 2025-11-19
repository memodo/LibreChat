# SPEC-001-agent-workflow-api

## Executive Summary

- **Based on Research:** RESEARCH-001-agent-workflow-api.md
- **Creation Date:** 2025-11-19
- **Author:** Claude (with Pablo Oliva)
- **Status:** Specification Complete - External Project Scope
- **LibreChat Integration:** Complete (2025-11-19) - Configuration only

**Overview:** This specification defines the integration of a multi-stage AI research agent (Haystack-based) into LibreChat as a custom endpoint. The solution provides an OpenAI-compatible API wrapper that enables natural chat interactions with a 3-stage research pipeline (Curator → Analyst → Deep-Dive) while providing real-time progress feedback during 3-5 minute execution times.

## Scope Clarification

**This specification defines requirements for an external project**, not for changes to the LibreChat codebase:

- **LibreChat Integration**: ✅ Complete (configuration-only in librechat.yaml and .env)
- **API Wrapper Implementation**: To be developed in separate project at `/Users/pablooliva/Dev/AI dev/news agent/`
- **LibreChat Changes**: None required - leverages custom endpoint feature
- **Implementation Tracking**: See PROMPT-001-agent-workflow-api-2025-11-19.md for LibreChat configuration completion

The requirements, edge cases, failure scenarios, and implementation guidance in this specification apply to the **external research agent API wrapper project**, not to LibreChat itself.

## Research Foundation

### Production Issues Addressed
- **Long execution times without feedback**: Multi-stage agent pipeline requires 3-5 minutes to complete, creating poor UX without intermediate progress updates
- **Synchronous workflow in async environment**: Existing Haystack agent workflow is synchronous Python script; needs async wrapper for web API integration
- **OpenAI compatibility requirements**: LibreChat requires exact OpenAI SSE format for streaming responses

### Stakeholder Validation
- **Product Team Requirements**:
  - Natural chat interface for research agent (appears as selectable model)
  - Streaming responses with real-time progress updates
  - Multi-turn conversation support with history
  - Expected 3-5 minute response times acceptable with proper feedback

- **Engineering Team Constraints**:
  - Minimal changes to LibreChat codebase (use custom endpoint feature)
  - External API wrapper approach for maintainability
  - Decoupled architecture allowing independent deployment
  - Support for Railway.com or similar platform deployment

- **Support Team Concerns**:
  - Clear error messages for API failures (Together AI, FireCrawl)
  - Request logging and stage completion tracking
  - Cost monitoring for external API usage
  - Rate limiting to prevent abuse

- **User Expectations**:
  - Ask recruiting/HR news research questions
  - Receive comprehensive, multi-perspective analysis
  - See progress during long-running research
  - Natural chat experience with follow-up questions

### System Integration Points
- **LibreChat Configuration**: `librechat.yaml` custom endpoint definition (root)
- **Config Loading**: `api/server/services/Config/loadCustomConfig.js:42` - Loads librechat.yaml
- **Endpoint Extraction**: `packages/api/src/app/config.ts:54-69` - Gets custom endpoint config
- **Client Initialization**: `api/server/services/Endpoints/custom/initialize.js:26-171` - Creates OpenAIClient
- **Route Handler**: `api/server/routes/edit/custom.js:1-26` - POST /api/edit/custom
- **Request Controller**: `api/server/controllers/EditController.js:136-184` - Main request handler
- **OpenAI Client**: `api/app/clients/OpenAIClient.js:760-1210` - HTTP client with SSE streaming
- **SSE Event Sender**: `packages/api/src/utils/events.ts:1-26` - sendEvent() function

## Intent

### Problem Statement
LibreChat users need access to a sophisticated multi-stage research agent that gathers news, performs strategic analysis, and generates comprehensive reports. The existing agent workflow runs as a standalone Python script with synchronous execution and file-based output, making it incompatible with LibreChat's real-time chat interface that expects OpenAI-compatible streaming responses.

### Solution Approach
Create a FastAPI-based API wrapper that:
1. Exposes OpenAI-compatible `/v1/chat/completions` endpoint
2. Wraps the existing 3-stage Haystack agent pipeline
3. Provides stage-by-stage streaming with progress feedback
4. Maintains conversation context for follow-up questions
5. Integrates with LibreChat via custom endpoint configuration

The wrapper will run each pipeline stage synchronously using `asyncio.to_thread()`, streaming complete stage outputs as they finish with simulated word-by-word chunking to maintain natural UX.

### Expected Outcomes
- Users can select "Research Agent" from LibreChat model dropdown
- Research queries stream responses with stage progress indicators
- Each stage completion (Curator, Analyst, Deep-Dive) displays immediately
- Full integration requires only librechat.yaml configuration changes
- API wrapper deploys independently (Railway.com or similar)
- Multi-turn conversations work naturally with maintained context

## Success Criteria

### Functional Requirements

**REQ-001: OpenAI-Compatible Streaming Endpoint**
- Implements POST `/v1/chat/completions` endpoint
- Accepts OpenAI chat completions format requests
- Returns SSE-formatted streaming responses matching OpenAI specification
- Supports `stream: true` parameter
- Includes required fields: `id`, `object`, `created`, `model`, `choices`, `delta`, `finish_reason`
- Sends `data: [DONE]` completion signal

**REQ-002: Multi-Stage Pipeline Execution**
- Executes 3-stage Haystack agent pipeline sequentially:
  1. Curator stage: News gathering via FireCrawl web search
  2. Analyst stage: Strategic analysis from curated news
  3. Deep-Dive stage: Comprehensive analysis of selected topic
- Each stage runs to completion before next stage starts
- Stage outputs preserved for conversation context

**REQ-003: Real-Time Progress Feedback**
- Streams stage progress markers before each stage execution:
  - "🔍 Stage 1: News Curator - Searching for relevant articles..."
  - "📊 Stage 2: Strategic Analyst - Analyzing trends..."
  - "🔬 Stage 3: Deep-Dive Specialist - Generating comprehensive report..."
- Streams complete stage output when each stage finishes
- Implements word-by-word chunking with 25ms default rate (configurable)

**REQ-004: Bearer Token Authentication**
- Validates `Authorization: Bearer {token}` header on all requests
- Returns 401 Unauthorized for missing/invalid tokens
- Supports environment variable configuration for API key

**REQ-005: LibreChat Configuration Integration**
- Works with librechat.yaml custom endpoint configuration
- Supports standard custom endpoint parameters (apiKey, baseURL, models)
- Compatible with LibreChat's OpenAIClient HTTP implementation
- Handles custom headers if configured

**REQ-006: Error Handling and Recovery**
- Gracefully handles Together AI API failures
- Gracefully handles FireCrawl API failures
- Returns descriptive error messages via streaming chunks
- Implements timeout protection (300+ seconds for long requests)
- Detects and handles client disconnections

**REQ-007: Conversation Context Support**
- Accepts `messages` array with conversation history
- Extracts most recent user message for pipeline input
- Maintains context for follow-up questions (optional enhancement)

### Non-Functional Requirements

**PERF-001: Response Time Targets**
- Stage 1 (Curator): 30-60 seconds
- Stage 2 (Analyst): 60-120 seconds
- Stage 3 (Deep-Dive): 120-180 seconds
- Total execution: 3.5-5 minutes maximum
- First chunk streaming within 2 seconds of request

**PERF-002: Concurrent Request Handling**
- Supports minimum 10 concurrent research requests
- Default thread pool: 40 threads for typical load
- Implements resource cleanup for abandoned requests
- No memory leaks during long-running operations

**SEC-001: API Security**
- API keys never exposed in logs or error messages
- Rate limiting: 10 requests/minute per user (configurable)
- Input validation for message content (max length enforcement)
- CORS headers properly configured for LibreChat origin

**SEC-002: Data Privacy**
- User queries logged only as metadata (length, timestamp, user_id)
- Full query content not persisted unless explicitly configured
- API keys for Together AI and FireCrawl stored in environment variables
- No third-party analytics on user research queries

**UX-001: Streaming User Experience**
- Smooth streaming appearance (no "wall of text" dumps)
- Clear stage transitions with visual markers
- Natural word-by-word appearance simulating real-time generation
- Proper handling of markdown formatting in streamed content

**MAINT-001: Code Maintainability**
- Minimal modifications to existing agent workflow code
- Clear separation between API wrapper and agent logic
- Comprehensive logging for debugging
- Docker containerization for consistent deployment

## Edge Cases (Research-Backed)

### Known Production Scenarios

**EDGE-001: FireCrawl API Failure During Curator Stage**
- **Research reference**: RESEARCH-001 "Production Edge Cases" section
- **Current behavior**: Curator stage fails, entire pipeline aborts
- **Desired behavior**:
  - Stream error message: "⚠️ Stage 1 failed: Unable to retrieve news articles. Please try again."
  - Return HTTP 500 with error chunk in SSE format
  - Log detailed error for debugging
- **Test approach**: Mock FireCrawl API to return 500 error

**EDGE-002: Together AI Timeout During Analysis Stages**
- **Research reference**: RESEARCH-001 "Production Edge Cases" section
- **Current behavior**: Stage hangs indefinitely or raises timeout exception
- **Desired behavior**:
  - Implement 180-second timeout per stage
  - Stream error message: "⚠️ Stage [N] timeout: Analysis took too long. Please try again with a simpler query."
  - Return partial results if any stages completed successfully (optional enhancement)
- **Test approach**: Mock Together AI to delay response beyond timeout

**EDGE-003: Missing API Keys at Startup**
- **Research reference**: RESEARCH-001 "Production Edge Cases" section
- **Current behavior**: Application fails to start with unclear error
- **Desired behavior**:
  - Validate required env vars (TOGETHER_API_KEY, FIRECRAWL_API_KEY, API_KEY) at startup
  - Fail fast with clear error message listing missing variables
  - Health check endpoint reports degraded status
- **Test approach**: Start application with missing env vars

**EDGE-004: Very Long User Queries (Token Limits)**
- **Research reference**: RESEARCH-001 "Input Validation" section
- **Current behavior**: Together AI may reject or truncate request
- **Desired behavior**:
  - Validate message content length before pipeline execution
  - Maximum 2000 characters per message
  - Return validation error: "Query too long. Please limit to 2000 characters."
- **Test approach**: Send request with 5000+ character message

**EDGE-005: Client Disconnects During Long Execution**
- **Research reference**: RESEARCH-001 "Production Edge Cases" section
- **Current behavior**: Pipeline continues executing, wasting resources
- **Desired behavior**:
  - Check `request.is_disconnected()` every 50 chunks or 10 seconds
  - Abort pipeline execution if client disconnected
  - Log disconnection for monitoring
  - Clean up resources immediately
- **Test approach**: Close client connection mid-stream, verify pipeline stops

**EDGE-006: Concurrent Requests Exceeding Thread Pool**
- **Research reference**: FastAPI SSE best practices research
- **Current behavior**: Requests may queue indefinitely or fail
- **Desired behavior**:
  - Monitor thread pool utilization
  - Return 503 Service Unavailable when pool saturated
  - Error message: "Server is busy. Please try again in a moment."
  - Implement request queuing with timeout
- **Test approach**: Send 50+ concurrent requests, verify graceful degradation

**EDGE-007: Analyst or Deep-Dive Stage Tool Warnings**
- **Research reference**: RESEARCH-001 "Production Edge Cases" - "Tool Usage"
- **Current behavior**: Stages 2 and 3 log warnings about missing tools (expected behavior)
- **Desired behavior**:
  - Suppress expected tool warnings in logs
  - Only Stage 1 (Curator) uses web_search tool
  - Ensure warnings don't affect response streaming
- **Test approach**: Verify clean logs for Stages 2-3 execution

**EDGE-008: Reverse Proxy Buffering Breaks Streaming**
- **Research reference**: RESEARCH-001 "LibreChat Integration Issues"
- **Current behavior**: SSE stream buffered by nginx/proxy, no real-time updates
- **Desired behavior**:
  - Send `X-Accel-Buffering: no` header in response
  - Include deployment documentation for proxy configuration
  - Verify streaming works through nginx with proper headers
- **Test approach**: Deploy behind nginx, verify immediate chunk delivery

**EDGE-009: LibreChat Timeout Too Short**
- **Research reference**: RESEARCH-001 "LibreChat Integration Issues"
- **Current behavior**: LibreChat may timeout before pipeline completes
- **Desired behavior**:
  - Document required LibreChat timeout configuration
  - API wrapper continues execution even if LibreChat times out
  - Recommend 360-second (6 minute) timeout in librechat.yaml
- **Test approach**: Configure short timeout, verify error handling

## Failure Scenarios

### Graceful Degradation

**FAIL-001: Complete Pipeline Failure**
- **Trigger condition**: All stages fail due to API unavailability or critical errors
- **Expected behavior**:
  - Stream error message with actionable guidance
  - Log full error details with stack trace
  - Return HTTP 500 with SSE error chunk
  - Clean up resources (close HTTP clients, release threads)
- **User communication**: "❌ Research agent is currently unavailable. Please try again later. [Error ID: {uuid}]"
- **Recovery approach**:
  - Automatic retry after 5 minutes (optional)
  - Health check endpoint reports degraded status
  - Alert monitoring system for manual intervention

**FAIL-002: Stage 1 Success, Stage 2+ Fails**
- **Trigger condition**: Curator completes successfully, but Analyst or Deep-Dive fails
- **Expected behavior**:
  - Stream Stage 1 results successfully
  - Stream Stage 2 progress marker
  - Stream error message when Stage 2 fails
  - Return partial results (Stage 1 output only)
- **User communication**: "✅ Stage 1 complete. ⚠️ Stage 2 failed: {error reason}. Showing curated news only."
- **Recovery approach**:
  - Suggest user retry with different query
  - Log failure for pattern analysis
  - Consider implementing Stage 2/3 retry logic

**FAIL-003: Rate Limit Exceeded**
- **Trigger condition**: User exceeds 10 requests/minute limit
- **Expected behavior**:
  - Return HTTP 429 Too Many Requests
  - Include Retry-After header with seconds to wait
  - Do not execute pipeline
- **User communication**: "⏳ Rate limit exceeded. Please wait {N} seconds before retrying."
- **Recovery approach**:
  - Automatic retry after cooldown period
  - Consider tiered rate limits for premium users

**FAIL-004: Invalid Authentication**
- **Trigger condition**: Missing or incorrect Bearer token
- **Expected behavior**:
  - Return HTTP 401 Unauthorized immediately
  - Do not execute pipeline or log query
  - Include WWW-Authenticate header
- **User communication**: "🔒 Authentication failed. Please check API key configuration."
- **Recovery approach**:
  - User updates API key in LibreChat .env
  - Restart LibreChat to reload configuration

**FAIL-005: Deployment Health Check Failure**
- **Trigger condition**: Required services (Together AI, FireCrawl) unreachable at startup
- **Expected behavior**:
  - Health check endpoint returns 503 Service Unavailable
  - Application starts but refuses requests
  - Logs detail which services are unavailable
- **User communication**: "🔧 Service is starting up. Please wait a moment."
- **Recovery approach**:
  - Automatic retry of health checks every 30 seconds
  - When healthy, automatically accept requests
  - Alert if unhealthy for >5 minutes

## Implementation Constraints

### Context Requirements
- **Maximum context utilization**: <40% during implementation phase
- **Essential files for implementation**:
  - RESEARCH-001-agent-workflow-api.md - Complete research findings
  - SPEC-001-agent-workflow-api.md (this file) - Specification and requirements
  - `/Users/pablooliva/Dev/AI dev/news agent/ta_three_agents.py:main()` - Agent pipeline entry point
  - `librechat.yaml` - For testing custom endpoint configuration
  - `SDD/OpenAI_Compatible_SSE_Streaming_FastAPI.md` - FastAPI implementation guide
  - `SDD/FastAPI_SSE_Code_Templates.md` - Ready-to-use code templates

- **Files that can be delegated to subagents**:
  - Reviewing LibreChat's OpenAIClient implementation details (already documented)
  - Researching Haystack framework documentation (if needed for modifications)
  - Docker deployment configuration research
  - Railway.com platform-specific deployment guides

### Technical Constraints

**Framework Constraints**:
- Must use FastAPI (Python 3.9+ required for asyncio.to_thread())
- Must maintain Haystack agent framework compatibility
- Must use existing Together AI and FireCrawl integrations without changes
- LibreChat expects exact OpenAI SSE format (no custom extensions in core format)

**API Compatibility Requirements**:
- OpenAI chat completions API format for requests
- OpenAI SSE streaming format for responses
- Bearer token authentication (no OAuth or other schemes)
- Support for `model`, `messages`, `stream`, `temperature`, `max_tokens` parameters

**Performance Requirements**:
- Must handle 3-5 minute long-running requests without timeout
- Must support minimum 10 concurrent requests
- Thread pool must not exceed system resources (40 threads default)
- Memory usage must remain stable during extended operation

**Security Requirements**:
- All API keys stored in environment variables only
- No logging of sensitive user queries or API keys
- Rate limiting to prevent abuse
- Input validation to prevent injection attacks

**Deployment Constraints**:
- Must be containerizable with Docker
- Must support deployment to Railway.com or similar PaaS
- Must co-locate API wrapper with agent scripts (shared file system for prompts)
- Must expose health check endpoint for monitoring

**Integration Constraints**:
- Minimal or zero changes to LibreChat codebase
- Configuration via librechat.yaml only
- No database required for API wrapper (stateless)
- Must work with LibreChat's existing authentication and session management

## Validation Strategy

### Automated Testing

**Unit Tests**:
- [ ] Request model validation (Pydantic schemas)
- [ ] Response model validation (OpenAI SSE format)
- [ ] Bearer token authentication logic
- [ ] API key validation with various invalid inputs
- [ ] Error handling for each exception type
- [ ] Chunking logic (word-by-word splitting)
- [ ] Stage progress marker generation
- [ ] Rate limiting logic (slowapi)
- [ ] Environment variable validation at startup

**Integration Tests**:
- [ ] End-to-end flow with mock agent pipeline (fast execution)
- [ ] SSE streaming format correctness (validate each chunk)
- [ ] Authentication flow (valid and invalid tokens)
- [ ] Stage-by-stage streaming with progress markers
- [ ] Client disconnection handling (abort pipeline)
- [ ] Concurrent request handling (10+ parallel requests)
- [ ] Error responses during streaming (after headers sent)
- [ ] Timeout handling (mock long-running stages)

**Edge Case Tests**:
- [ ] Empty query string
- [ ] Very long query (>2000 characters)
- [ ] Missing API keys (Together AI, FireCrawl)
- [ ] Invalid authentication token
- [ ] Together AI timeout simulation
- [ ] FireCrawl API failure simulation
- [ ] Rate limit exceeded scenario
- [ ] Client disconnect mid-stream
- [ ] Concurrent request saturation (50+ requests)
- [ ] Reverse proxy buffering test (nginx)

**API Compatibility Tests**:
- [ ] Test with curl commands matching LibreChat format
- [ ] Test with Python OpenAI client library
- [ ] Test with LibreChat in local development environment
- [ ] Verify SSE format matches OpenAI specification exactly
- [ ] Test streaming rate control (25ms, 40ms, 100ms)

### Manual Verification

**User Flow Tests**:
- [ ] Configure custom endpoint in librechat.yaml
- [ ] Start API wrapper and LibreChat
- [ ] Select "Research Agent" from model dropdown
- [ ] Send research query, observe stage-by-stage streaming
- [ ] Verify all three stages complete successfully
- [ ] Verify markdown formatting renders correctly
- [ ] Send follow-up question, verify context maintained
- [ ] Test with various query types (different topics, complexities)

**Error Handling Tests**:
- [ ] Stop Together AI service, send query, verify error message
- [ ] Stop FireCrawl service, send query, verify Stage 1 error
- [ ] Send request with invalid auth, verify 401 response
- [ ] Exceed rate limit, verify 429 response with retry guidance
- [ ] Send very long query, verify validation error
- [ ] Kill API wrapper mid-stream, verify LibreChat error handling

**Performance Tests**:
- [ ] Send 10 concurrent requests, verify all complete successfully
- [ ] Monitor memory usage during extended operation (30+ minutes)
- [ ] Monitor thread pool utilization under load
- [ ] Verify response times meet targets (first chunk <2s)
- [ ] Test with slow network connection, verify streaming works
- [ ] Deploy behind nginx proxy, verify streaming not buffered

### Performance Validation

**Metrics to Measure**:
- [ ] Time to first chunk: <2 seconds (target)
- [ ] Stage 1 completion: 30-60 seconds (expected)
- [ ] Stage 2 completion: 60-120 seconds (expected)
- [ ] Stage 3 completion: 120-180 seconds (expected)
- [ ] Total execution time: 3.5-5 minutes maximum
- [ ] Streaming rate: 40 tokens/second (25ms delay = target)
- [ ] Concurrent request capacity: 10+ successful (minimum)
- [ ] Memory usage: Stable over time, no leaks
- [ ] Thread pool utilization: <80% under normal load

**Benchmarks**:
- [ ] Baseline single request performance (establish targets)
- [ ] Load test with 20 concurrent users (identify bottlenecks)
- [ ] Stress test with 50+ concurrent users (verify graceful degradation)
- [ ] Long-running stability test (100+ requests over 6 hours)
- [ ] Memory leak test (monitor over 24 hours)

### Stakeholder Sign-off

- [ ] **Product Team**: Review UX flow with actual demo
  - Verify streaming appearance meets expectations
  - Confirm stage progress markers are clear and helpful
  - Test multi-turn conversation flows
  - Approve error messages and user guidance

- [ ] **Engineering Team**: Code review and architecture approval
  - Review API wrapper implementation for maintainability
  - Verify minimal LibreChat changes (config only)
  - Approve deployment architecture and monitoring plan
  - Validate test coverage is adequate

- [ ] **Support Team**: Operational readiness review
  - Review error messages and troubleshooting guides
  - Approve logging and monitoring approach
  - Test health check endpoints and alerting
  - Validate documentation for common issues

- [ ] **Security Team**: Security review (if applicable)
  - Validate API key management approach
  - Review rate limiting implementation
  - Approve data privacy handling (query logging)
  - Check for injection vulnerabilities

## Dependencies and Risks

### External Dependencies

**Required Services**:
- **Together AI API** (`https://api.together.xyz/v1`)
  - Model: `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8`
  - Requirement: `TOGETHER_API_KEY` environment variable
  - Risk: Service downtime or rate limits affect all queries
  - Mitigation: Monitor API status, implement retry logic, consider fallback models

- **FireCrawl API** (Web search service)
  - Requirement: `FIRECRAWL_API_KEY` environment variable
  - Used only in Stage 1 (Curator)
  - Risk: Service downtime prevents news gathering
  - Mitigation: Implement timeout and fallback error messages, consider alternative search APIs

**Infrastructure Dependencies**:
- **MongoDB**: LibreChat's database (conversation storage)
  - Not directly used by API wrapper
  - Managed by LibreChat instance

- **Redis** (optional): LibreChat's caching layer
  - Not directly used by API wrapper
  - Managed by LibreChat instance

**Python Libraries**:
- FastAPI (web framework)
- Haystack Agents (AI pipeline framework)
- Pydantic (data validation)
- uvicorn (ASGI server)
- slowapi (rate limiting)
- python-dotenv (env var management)

**External Files**:
- `/Users/pablooliva/Dev/AI dev/news agent/ta_three_agents.py` - Agent workflow script
- `recruiting-prompts/*.md` - Agent prompt templates (3 files)
  - Risk: Prompts must be available at runtime
  - Mitigation: Include in Docker container build, verify in health check

### Identified Risks

**RISK-001: Long Execution Times Exceed User Patience**
- **Description**: Even with streaming, 3-5 minutes may be too long for some users
- **Likelihood**: Medium
- **Impact**: High (user abandons query, poor UX perception)
- **Mitigation**:
  - Provide clear upfront expectation ("Research takes 3-5 minutes")
  - Implement stage progress bars or percentage indicators
  - Consider partial result delivery (return Stage 1 immediately, continue with 2-3)
  - Add query complexity estimation to set expectations

**RISK-002: Together AI Rate Limits or Quota Exhaustion**
- **Description**: Heavy usage may hit Together AI rate limits or exhaust quota
- **Likelihood**: Medium (depends on user adoption)
- **Impact**: High (service unavailable for all users)
- **Mitigation**:
  - Monitor Together AI usage and quotas
  - Implement user-level rate limiting (10 req/min)
  - Set up billing alerts on Together AI account
  - Consider tiered access (free/premium with higher limits)

**RISK-003: Cost Escalation from FireCrawl Web Search**
- **Description**: Each query triggers web search API calls with associated costs
- **Likelihood**: Medium (depends on usage volume)
- **Impact**: Medium (budget overruns)
- **Mitigation**:
  - Monitor FireCrawl usage and costs daily
  - Cache search results for identical queries (optional)
  - Set monthly budget caps with automatic disabling
  - Document cost per query for capacity planning

**RISK-004: Thread Pool Exhaustion Under Load**
- **Description**: 40-thread default pool may be insufficient for peak load
- **Likelihood**: Low to Medium (depends on adoption)
- **Impact**: High (new requests fail or queue indefinitely)
- **Mitigation**:
  - Implement custom ThreadPoolExecutor with 100+ threads for high load
  - Monitor thread pool utilization metrics
  - Return 503 Service Unavailable when saturated
  - Scale horizontally (multiple API wrapper instances)

**RISK-005: Deployment Platform Limitations**
- **Description**: Railway.com or chosen PaaS may have timeout limits or resource constraints
- **Likelihood**: Medium
- **Impact**: High (service cannot run on platform)
- **Mitigation**:
  - Verify platform supports 300+ second request timeouts
  - Test long-running requests in staging environment
  - Have backup deployment options (AWS ECS, DigitalOcean, self-hosted)
  - Document platform requirements clearly

**RISK-006: Haystack Framework Changes Break Integration**
- **Description**: Updates to Haystack library may change agent execution model
- **Likelihood**: Low (but possible with major versions)
- **Impact**: High (requires refactoring)
- **Mitigation**:
  - Pin Haystack version in requirements.txt
  - Test major version updates in isolated environment
  - Subscribe to Haystack release notes and changelog
  - Maintain comprehensive integration tests

**RISK-007: LibreChat Custom Endpoint Changes**
- **Description**: LibreChat updates may change custom endpoint behavior or requirements
- **Likelihood**: Low (custom endpoint feature is stable)
- **Impact**: Medium (may require API wrapper updates)
- **Mitigation**:
  - Pin LibreChat version or track updates
  - Maintain automated integration tests against LibreChat
  - Subscribe to LibreChat releases and changelog
  - Participate in LibreChat community for early warning

**RISK-008: Security Vulnerability in API Wrapper**
- **Description**: Authentication bypass, injection attacks, or other vulnerabilities
- **Likelihood**: Low to Medium (depends on code quality)
- **Impact**: High (unauthorized access, data leaks)
- **Mitigation**:
  - Implement comprehensive input validation
  - Use Pydantic models for all inputs
  - Regular security audits and dependency updates
  - Rate limiting and monitoring for abuse patterns
  - Follow OWASP best practices

## Implementation Notes

### Suggested Approach

**Phase 1: Minimal Viable API Wrapper (Week 1)**
1. Create FastAPI project structure with basic health check endpoint
2. Implement OpenAI-compatible `/v1/chat/completions` endpoint skeleton
3. Add Bearer token authentication with dependency injection
4. Implement basic SSE streaming with static test content
5. Test integration with LibreChat using mock responses

**Phase 2: Pipeline Integration (Week 1-2)**
1. Import and wrap `ta_three_agents.py` functions
2. Implement `asyncio.to_thread()` wrapper for synchronous pipeline
3. Create stage-by-stage streaming generator:
   - Yield progress markers before each stage
   - Execute stage synchronously
   - Yield complete stage output
   - Implement word-by-word chunking with configurable rate
4. Test full pipeline execution with logging

**Phase 3: Error Handling & Edge Cases (Week 2)**
1. Implement comprehensive error handling for each failure scenario
2. Add client disconnection detection (check every 50 chunks)
3. Implement timeout protection (180s per stage, 360s total)
4. Add input validation (query length, message format)
5. Create graceful degradation for API failures

**Phase 4: Production Readiness (Week 2-3)**
1. Add rate limiting (slowapi) - 10 req/min default
2. Implement comprehensive logging (structured JSON logs)
3. Add monitoring endpoints (metrics, health checks)
4. Create Dockerfile and docker-compose.yml
5. Add environment variable validation at startup
6. Write comprehensive tests (unit, integration, edge cases)

**Phase 5: Deployment & Optimization (Week 3)**
1. Deploy to staging environment (Railway.com or similar)
2. Configure LibreChat with staging API wrapper URL
3. Perform end-to-end testing with real queries
4. Load test with 20+ concurrent users
5. Optimize thread pool and streaming rate based on metrics
6. Deploy to production with monitoring

### Critical FastAPI + SSE Implementation Patterns

**Async/Sync Integration** (from FastAPI research):
```
Recommended Pattern: asyncio.to_thread()
- Standard library (Python 3.9+)
- Context-aware (preserves contextvars)
- Clean syntax: result = await asyncio.to_thread(sync_function, *args)

Thread Pool Management:
- Default 40 threads adequate for <20 concurrent users
- Custom ThreadPoolExecutor for 50+ concurrent (100+ threads)
- Always use try-finally for resource cleanup
```

**OpenAI SSE Format Requirements**:
```
Critical Fields:
- id: Unique identifier (e.g., "chatcmpl-" + uuid)
- object: "chat.completion.chunk"
- created: Unix timestamp (int)
- model: Model name from request
- choices[0].delta: {"content": "text"} or {"role": "assistant"}
- choices[0].finish_reason: null (streaming) or "stop" (complete)

Completion Sequence:
1. First chunk: delta with role
2. Content chunks: delta with content, finish_reason=null
3. Final chunk: empty delta, finish_reason="stop"
4. Stream terminator: "data: [DONE]\n\n"

Critical Headers:
- Content-Type: text/event-stream
- Cache-Control: no-cache
- X-Accel-Buffering: no (for nginx proxies)
```

**Rate Limiting and Chunking**:
```
Recommended Streaming Rate: 25ms delay = ~40 tokens/second
- Provides smooth UX without overwhelming client
- Configurable per client requirements
- Implement with asyncio.sleep(0.025) between chunks

Chunking Strategy:
- Word-based splitting with sentence boundaries preferred
- Preserve markdown formatting (don't split mid-code-block)
- Typical chunk size: 1-5 words per chunk
- Detect client disconnection every 50 chunks or 10 seconds
```

**Error Handling in Streams**:
```
Before Headers Sent: Raise HTTPException (500, 401, 429, etc.)
After Headers Sent: Send error as SSE chunk

Error Chunk Format:
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion.chunk",
  "choices": [{
    "delta": {"content": "⚠️ Error message here"},
    "finish_reason": "error"
  }]
}

Always end with [DONE] even after errors
Always use try-finally for resource cleanup
```

**Resource Management**:
```
Critical Patterns:
1. Check request.is_disconnected() regularly during long operations
2. Abort expensive operations immediately on disconnect
3. Use generators to avoid accumulating full response in memory
4. Clean up HTTP clients and file handles in finally blocks
5. Monitor thread pool utilization (log when >80%)
```

### Areas for Subagent Delegation

**During Implementation Phase**:
- **Docker configuration research**: Optimal Dockerfile for FastAPI + Python dependencies
- **Railway.com deployment guides**: Platform-specific configuration and deployment steps
- **Haystack framework documentation**: If modifications to agent pipeline are needed
- **LibreChat testing**: Detailed testing of custom endpoint edge cases in LibreChat UI
- **Load testing setup**: Creating realistic load test scenarios with multiple concurrent users
- **Monitoring stack**: Researching Prometheus/Grafana setup for metrics dashboard

**Research Tasks Suitable for Subagents**:
- Investigating alternative search APIs as FireCrawl backup
- Researching token-aware chunking strategies for better streaming
- Finding optimal thread pool sizing for specific deployment platforms
- Comparing PaaS platforms for long-running request support
- Researching conversation context management patterns for follow-up questions

### Critical Implementation Considerations

**1. OpenAI Format Compliance**:
- Test SSE format with Python OpenAI client library before integrating with LibreChat
- Validate every field in response chunks matches OpenAI specification
- Include `X-Accel-Buffering: no` header for deployment behind reverse proxies
- Ensure proper `[DONE]` termination to avoid client hanging

**2. Pipeline Execution Strategy**:
- Each stage runs in separate `asyncio.to_thread()` call for potential cancellation
- Stream complete stage output immediately when stage finishes (don't wait for all stages)
- Implement word-chunking of stage outputs to simulate real-time generation
- Consider caching Stage 1 results for identical queries (optional optimization)

**3. Error Boundaries**:
- Wrap each stage execution in try-except block
- Decide whether to return partial results or fail completely (recommend partial for better UX)
- Always stream descriptive error messages to user, never generic "Internal Server Error"
- Log full stack traces but mask sensitive data (API keys, query content if configured)

**4. Performance Monitoring**:
- Log execution time for each stage separately
- Track thread pool utilization (warn if >80%)
- Monitor API call costs (Together AI, FireCrawl) daily
- Set up alerts for error rate >5% or response time >6 minutes

**5. Deployment Configuration**:
- Verify deployment platform supports request timeouts ≥360 seconds
- Test streaming behavior through platform's load balancer/proxy
- Configure health check endpoint with proper grace period (startup can take 30s+)
- Set appropriate resource limits (CPU, memory) based on load testing

**6. LibreChat Integration Testing**:
- Always test with actual LibreChat instance, not just curl or OpenAI client
- Verify markdown formatting renders correctly in LibreChat UI
- Test conversation history and follow-up questions
- Confirm model selection dropdown shows "Research Agent" correctly

**7. Security Hardening**:
- Never log full query content unless explicitly required for debugging
- Mask API keys in all logs (show only first/last 4 characters)
- Implement rate limiting before authentication check to prevent brute force
- Add request size limits (max message length, max history length)
- Consider adding request signing or additional auth layer for production

---

## Appendices

### Appendix A: Reference Documents
- **RESEARCH-001-agent-workflow-api.md**: Complete research findings
- **SDD/OpenAI_Compatible_SSE_Streaming_FastAPI.md**: FastAPI SSE implementation guide (12,000+ words)
- **SDD/FastAPI_SSE_Code_Templates.md**: Ready-to-use code templates
- **SDD/FastAPI_SSE_Decision_Guide.md**: Architecture decision trees
- **SDD/IMPLEMENTATION_SUMMARY.md**: Quick-start implementation guide

### Appendix B: Example librechat.yaml Configuration
```yaml
version: 1.2.1
cache: true
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
      streamRate: 25  # 25ms between chunks = ~40 tokens/second
      directEndpoint: false  # LibreChat appends /v1/chat/completions
      # Optional: increase timeout for long-running requests
      # timeout: 360000  # 6 minutes in milliseconds
```

### Appendix C: Environment Variables Required

**API Wrapper (.env)**:
```bash
# Authentication
API_KEY=your-generated-api-key-here  # Generate with: openssl rand -hex 32

# Together AI
TOGETHER_API_KEY=your-together-api-key

# FireCrawl
FIRECRAWL_API_KEY=your-firecrawl-api-key

# Optional: Configuration
STREAM_RATE_MS=25  # Milliseconds between chunks
RATE_LIMIT_PER_MINUTE=10  # Requests per minute per user
MAX_QUERY_LENGTH=2000  # Maximum characters per message
LOG_LEVEL=INFO  # DEBUG, INFO, WARNING, ERROR
```

**LibreChat (.env addition)**:
```bash
# Add to existing LibreChat .env file
RESEARCH_AGENT_API_KEY=your-generated-api-key-here  # Same as API_KEY above
```

### Appendix D: Success Metrics Dashboard

**KPIs to Monitor**:
1. **Availability**: Uptime % (target: 99%+)
2. **Performance**: Avg response time (target: <5 minutes)
3. **Reliability**: Error rate % (target: <5%)
4. **Usage**: Requests per day/week/month
5. **Cost**: API costs per request (Together AI + FireCrawl)
6. **User Experience**: Completion rate (queries that finish vs. abandoned)

**Operational Metrics**:
- Thread pool utilization %
- Memory usage (MB)
- Stage 1/2/3 execution times (p50, p95, p99)
- API call failure rates (Together AI, FireCrawl)
- Rate limit hit rate (requests rejected per hour)
- Client disconnection rate (abandoned requests)

---

**Specification Status**: Draft - Ready for stakeholder review
**Next Steps**:
1. Product team review of success criteria and UX requirements
2. Engineering team review of implementation approach
3. Security team review of authentication and privacy measures
4. Approval to proceed with Phase 1 implementation

**Last Updated**: 2025-11-19
