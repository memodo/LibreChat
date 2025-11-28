# Research / News Agent Integration

In your news agent project (/Users/pablooliva/Dev/AI dev/news agent/):

1. Implement the FastAPI wrapper with OpenAI-compatible /v1/chat/completions endpoint
2. Generate an API key for authentication
3. Set that same API key in both:
   - News agent project .env as API_KEY=...
   - LibreChat .env as RESEARCH_AGENT_API_KEY=...

Once your endpoint is running:

1. Start your research agent: python your_fastapi_app.py
2. Start LibreChat
3. Select "Research Agent" from the model dropdown
4. Ask research questions!
