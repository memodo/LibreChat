# Claude Code - Project Handoff

## Task Summary
Implement an OpenAI-compatible API endpoint that wraps a multi-agent research workflow for integration with LibreChat, enabling natural chat interaction with research results including streaming support.

## Background
I'm working at Memodo with LibreChat deployed and have a multi-agent workflow system that performs research on current news, analysis, and deep thinking. I want users to be able to chat with the results naturally in LibreChat's interface with real-time streaming updates.

## What You Need to Build

A FastAPI server that:
1. **Accepts OpenAI-compatible requests** from LibreChat (`POST /v1/chat/completions`)
2. **Wraps my agent workflow** (placeholder implementation provided - needs your integration)
3. **Streams results back** using Server-Sent Events (SSE)
4. **Handles both streaming and non-streaming** responses
5. **Includes proper API authentication**

## Deliverables

1. Working FastAPI server with:
   - OpenAI-compatible endpoints
   - SSE streaming implementation
   - API key authentication
   - Integration point for my agent workflow

2. LibreChat configuration files:
   - librechat.yaml
   - docker-compose.override.yml
   - .env updates

3. Documentation for:
   - Running the API locally and in production
   - Testing the integration
   - Deploying to hosting platform

## Complete Specification

**See the full implementation guide:** `librechat-agent-workflow-integration.md`

This document contains:
- Detailed API specifications
- Complete code examples for all files
- LibreChat configuration
- Testing procedures
- Deployment instructions
- Troubleshooting guide

## Key Integration Point

The main integration point is in `agent_workflow.py` - the `execute_agent_workflow()` function. This is where my actual multi-agent research workflow needs to be connected. The placeholder shows the expected interface:

```python
async def execute_agent_workflow(
    messages: List[ChatMessage],
    temperature: float = 0.7
) -> AsyncGenerator[str, None]:
    # Your workflow integration goes here
    # Should stream results as they become available
```

## Technical Stack
- **FastAPI** for the API server
- **Pydantic** for request/response models
- **Uvicorn** as ASGI server
- **LibreChat** as the frontend (already deployed)
- **Docker** for deployment (optional)

## My Preferences
- Clean, well-documented code
- Production-ready with proper error handling
- Deployment guidance for Railway.com or similar platforms
- Environment-based configuration (no hardcoded secrets)

## Questions for You

Before you start implementing, I'll need to tell you about:
1. My agent workflow's current architecture (is it Python/async-compatible?)
2. Whether it already supports streaming or needs chunking
3. My preferred deployment platform
4. Any specific authentication requirements beyond API keys

## Getting Started

1. Read the full specification in `librechat-agent-workflow-integration.md`
2. Set up the project structure as outlined
3. Implement the FastAPI server with placeholder workflow
4. Ask me about integrating my actual agent workflow
5. Test with LibreChat
6. Deploy to production

## Success Criteria

✅ Users can select "Research Agent" in LibreChat
✅ Queries are sent to the custom API endpoint
✅ Responses stream back in real-time
✅ Conversation history is maintained
✅ Follow-up questions work naturally
✅ Production-ready with proper error handling

## Let's Build This!

I have the complete specification ready. Let me know what additional information you need about my agent workflow, and we can start implementing.

---

**Ready to hand off to Claude Code**
**Reference Document:** librechat-agent-workflow-integration.md
**Date:** 2025-11-18
