/**
 * Integration tests for PII detection middleware chain.
 *
 * These tests verify that detectPII middleware is correctly wired into each
 * route that handles user messages. They catch regressions where:
 *   - detectPII is removed from a route during a merge
 *   - detectPII is moved to the wrong position in the chain
 *   - The middleware's response format changes
 *   - Environment-variable toggles stop working
 *
 * Strategy: mock every dependency *except* detectPII itself (and axios, which
 * we control). The downstream controller is a no-op that returns 200. We then
 * drive requests through supertest and assert the middleware's behaviour.
 *
 * Important: routers are required once (after all jest.mock calls) rather than
 * inside jest.isolateModules, because isolateModules does not inherit jest.mock
 * declarations and triggers deep transitive-dependency failures. The detectPII
 * middleware reads PII_DETECTION, PII_DETECTION_MODE, PII_DETECTION_FAIL_OPEN,
 * and PII_DETECTION_EXEMPT_ROLES from process.env on every request, so changing
 * env vars between tests is sufficient to exercise all code paths.
 */

// ── Mocks (must be declared before any require) ─────────────────────────────

// Auth / permission middleware — passthrough
jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware/moderateText', () => (req, res, next) => next());

jest.mock('~/server/middleware/validate/convoAccess', () => (req, res, next) => next());

jest.mock('~/server/middleware/buildEndpointOption', () => (req, res, next) => next());

jest.mock('~/server/middleware/validateModel', () => (req, res, next) => next());

jest.mock('~/server/middleware/setHeaders', () => (req, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  next();
});

jest.mock('~/server/middleware/assistants/validate', () => (req, res, next) => next());

jest.mock('~/server/middleware/config/app', () => (req, res, next) => next());

jest.mock('~/server/middleware/checkBan', () => (req, res, next) => next());

jest.mock('~/server/middleware/checkDomainAllowed', () => (req, res, next) => next());

jest.mock('~/server/middleware/validatePasswordReset', () => (req, res, next) => next());

jest.mock('~/server/middleware/validateRegistration', () => (req, res, next) => next());

jest.mock('~/server/middleware/validateMessageReq', () => (req, res, next) => next());

jest.mock('~/server/middleware/requireLocalAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware/canDeleteAccount', () => (req, res, next) => next());

jest.mock('~/server/middleware/requireLdapAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware/checkInviteUser', () => (req, res, next) => next());

jest.mock('~/server/middleware/logHeaders', () => (req, res, next) => next());

jest.mock('~/server/middleware/uaParser', () => (req, res, next) => next());

jest.mock('~/server/middleware/noIndex', () => (req, res, next) => next());

jest.mock('~/server/middleware/limiters', () => ({
  createImportLimiters: jest.fn(() => ({
    importIpLimiter: (req, res, next) => next(),
    importUserLimiter: (req, res, next) => next(),
  })),
  createForkLimiters: jest.fn(() => ({
    forkIpLimiter: (req, res, next) => next(),
    forkUserLimiter: (req, res, next) => next(),
  })),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  resetPasswordLimiter: (req, res, next) => next(),
  messageLimiter: (req, res, next) => next(),
  uploadLimiter: (req, res, next) => next(),
  sttLimiter: (req, res, next) => next(),
  ttsLimiter: (req, res, next) => next(),
}));

jest.mock('~/server/middleware/abortMiddleware', () => ({
  handleAbort: () => (req, res, next) => next(),
  handleAbortError: (req, res, next) => next(),
  setHeaders: (req, res, next) => next(),
}));

jest.mock('~/server/middleware/validate', () => ({
  validateConvoAccess: (req, res, next) => next(),
}));

jest.mock('~/server/middleware/roles', () => ({
  requireCapability: () => (req, res, next) => next(),
  requireAccessControl: () => (req, res, next) => next(),
}));

jest.mock('~/server/middleware/accessResources', () => ({
  canAccessAgentFromBody: () => (req, res, next) => next(),
}));

// Package-level mocks
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn((val) => val === true || val === 'true'),
  createMessageFilterPii: () => (req, res, next) => next(),
  generateCheckAccess: () => (req, res, next) => next(),
  skipAgentCheck: jest.fn(),
  createRequireApiKeyAuth: () => (req, res, next) => next(),
  createCheckRemoteAgentAccess: () => (req, res, next) => next(),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  ErrorTypes: { PII_DETECTION: 'pii_detection' },
  PermissionTypes: { AGENTS: 'AGENTS', REMOTE_AGENTS: 'REMOTE_AGENTS' },
  Permissions: { USE: 'USE' },
  PermissionBits: { VIEW: 'VIEW' },
}));

// Mongoose — stub model() so GuardrailEvent.create works
const mongoose = require('mongoose');
jest.spyOn(mongoose, 'model').mockImplementation(() => ({
  create: jest.fn().mockResolvedValue({}),
}));

// Axios — controlled per-test
jest.mock('axios');
const axios = require('axios');

// Mock downstream controllers — they just return 200 JSON
jest.mock('~/server/controllers/agents/request', () =>
  jest.fn((req, res) => res.status(200).json({ streamId: 'mock-stream-id' })),
);

jest.mock('~/server/services/Endpoints/agents', () => ({
  initializeClient: jest.fn(),
}));

jest.mock('~/server/services/Endpoints/agents/title', () => jest.fn());

jest.mock('~/server/controllers/assistants/chatV1', () =>
  jest.fn((req, res) => {
    // Assistant routes use SSE — headers may already be set by setHeaders middleware.
    // Use res.end() to cleanly close the stream rather than res.json() which conflicts.
    if (res.getHeader('Content-Type') === 'text/event-stream') {
      res.write(`event: done\ndata: ${JSON.stringify({ streamId: 'mock-stream-id' })}\n\n`);
      return res.end();
    }
    return res.status(200).json({ streamId: 'mock-stream-id' });
  }),
);

jest.mock('~/server/controllers/assistants/chatV2', () =>
  jest.fn((req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') {
      res.write(`event: done\ndata: ${JSON.stringify({ streamId: 'mock-stream-id' })}\n\n`);
      return res.end();
    }
    return res.status(200).json({ streamId: 'mock-stream-id' });
  }),
);

jest.mock('~/server/controllers/agents/openai', () => ({
  OpenAIChatCompletionController: jest.fn((req, res) =>
    res.status(200).json({ id: 'chatcmpl-mock', choices: [] }),
  ),
  ListModelsController: jest.fn((req, res) => res.status(200).json({ data: [] })),
  GetModelController: jest.fn((req, res) => res.status(200).json({})),
}));

jest.mock('~/server/controllers/agents/responses', () => ({
  createResponse: jest.fn((req, res) =>
    res.status(200).json({ id: 'resp-mock', object: 'response' }),
  ),
  getResponse: jest.fn((req, res) => res.status(200).json({})),
  listModels: jest.fn((req, res) => res.status(200).json({ data: [] })),
}));

jest.mock('~/server/services/PermissionService', () => ({
  getEffectivePermissions: jest.fn(),
}));

jest.mock('~/models', () => ({
  getRoleByName: jest.fn(),
  validateAgentApiKey: jest.fn(),
  findUser: jest.fn(),
  getAgent: jest.fn(),
}));

jest.mock('~/server/routes/agents/middleware', () => ({
  checkAgentPermission: (req, res, next) => next(),
  preAuthTenantMiddleware: (req, res, next) => next(),
  requireRemoteAgentAuth: (req, res, next) => next(),
  checkRemoteAgentsFeature: (req, res, next) => next(),
}));

// ── Imports (after all jest.mock calls) ─────────────────────────────────────

const express = require('express');
const request = require('supertest');
const { resetCircuitBreaker } = require('~/server/middleware/detectPII');

// Require routers once — mocks are already in place
const agentChatRouter = require('~/server/routes/agents/chat');
const assistantChatV1Router = require('~/server/routes/assistants/chatV1');
const assistantChatV2Router = require('~/server/routes/assistants/chatV2');
const openaiRouter = require('~/server/routes/agents/openai');
const responsesRouter = require('~/server/routes/agents/responses');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app that injects req.user and mounts the given router
 * at the specified path prefix.
 */
function buildApp(mountPath, router, userOverrides = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'test-user-123', _id: 'test-user-123', role: 'user', ...userOverrides };
    next();
  });
  app.use(mountPath, router);
  return app;
}

/** Standard redakt response: PII found */
function piiDetectedResponse(entityTypes = ['PERSON'], entityCount = 1) {
  return {
    data: { has_pii: true, entities_found: entityTypes, entity_count: entityCount },
  };
}

/** Standard redakt response: no PII */
function noPiiResponse() {
  return { data: { has_pii: false, entities_found: [], entity_count: 0 } };
}

// ── Apps (built once per router) ────────────────────────────────────────────

const agentChatApp = buildApp('/api/agents/chat', agentChatRouter);
const assistantV1App = buildApp('/api/assistants/v1/chat', assistantChatV1Router);
const assistantV2App = buildApp('/api/assistants/v2/chat', assistantChatV2Router);
const openaiApp = buildApp('/v1', openaiRouter);
const responsesApp = buildApp('/v1/responses', responsesRouter);

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('PII middleware chain integration', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCircuitBreaker();

    // Set up a clean env slice for each test
    process.env = {
      ...ORIGINAL_ENV,
      PII_DETECTION: 'true',
      PII_DETECTION_API_URL: 'http://mock-redakt:8000',
      PII_DETECTION_MODE: 'detect',
      PII_DETECTION_FAIL_OPEN: 'true',
      PII_DETECTION_EXEMPT_ROLES: '',
      PII_DETECTION_API_ROUTES: 'true',
    };

    // Default: health check succeeds
    axios.get.mockResolvedValue({ data: { status: 'ok' } });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ────────────────────────────────────────────────────────────────────────
  // 1. Agent chat route — POST /api/agents/chat/
  // ────────────────────────────────────────────────────────────────────────
  describe('Agent chat route (POST /api/agents/chat/)', () => {
    it('blocks message with PII in detect mode (400)', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse());

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.type).toBe('pii_detection');
      expect(res.body.error.message).toContain('personal information');
    });

    it('allows message with PII in warn mode (200)', async () => {
      process.env.PII_DETECTION_MODE = 'warn';
      axios.post.mockResolvedValueOnce(piiDetectedResponse());

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(200);
      expect(res.body.streamId).toBe('mock-stream-id');
    });

    it('passes through when feature is disabled', async () => {
      process.env.PII_DETECTION = 'false';

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('fails open when redakt is unavailable', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(200);
      expect(res.body.streamId).toBe('mock-stream-id');
    });

    it('allows message with no PII detected', async () => {
      axios.post.mockResolvedValueOnce(noPiiResponse());

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'What is the weather today?' });

      expect(res.status).toBe(200);
      expect(res.body.streamId).toBe('mock-stream-id');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Assistant chat v1 — POST /api/assistants/v1/chat/
  // ────────────────────────────────────────────────────────────────────────
  describe('Assistant chat v1 (POST /api/assistants/v1/chat/)', () => {
    it('blocks message with PII in detect mode (400)', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['PHONE_NUMBER']));

      const res = await request(assistantV1App)
        .post('/api/assistants/v1/chat/')
        .send({ text: 'Call me at 555-123-4567' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('pii_detection');
    });

    it('allows message with PII in warn mode and reaches controller', async () => {
      process.env.PII_DETECTION_MODE = 'warn';
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['PHONE_NUMBER']));

      const chatV1Controller = require('~/server/controllers/assistants/chatV1');

      const res = await request(assistantV1App)
        .post('/api/assistants/v1/chat/')
        .send({ text: 'Call me at 555-123-4567' });

      // Response should complete (not 400-blocked) and the controller should have been called
      expect(res.status).toBe(200);
      expect(chatV1Controller).toHaveBeenCalled();
    });

    it('passes through when feature is disabled', async () => {
      process.env.PII_DETECTION = 'false';

      const res = await request(assistantV1App)
        .post('/api/assistants/v1/chat/')
        .send({ text: 'Call me at 555-123-4567' });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('fails open when redakt is unavailable', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(assistantV1App)
        .post('/api/assistants/v1/chat/')
        .send({ text: 'Call me at 555-123-4567' });

      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Assistant chat v2 — POST /api/assistants/v2/chat/
  // ────────────────────────────────────────────────────────────────────────
  describe('Assistant chat v2 (POST /api/assistants/v2/chat/)', () => {
    it('blocks message with PII in detect mode (400)', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['EMAIL_ADDRESS']));

      const res = await request(assistantV2App)
        .post('/api/assistants/v2/chat/')
        .send({ text: 'Email me at john@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('pii_detection');
    });

    it('passes through when feature is disabled', async () => {
      process.env.PII_DETECTION = 'false';

      const res = await request(assistantV2App)
        .post('/api/assistants/v2/chat/')
        .send({ text: 'Email me at john@example.com' });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('fails open when redakt is unavailable', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(assistantV2App)
        .post('/api/assistants/v2/chat/')
        .send({ text: 'Email me at john@example.com' });

      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. OpenAI-compatible — POST /v1/chat/completions
  // ────────────────────────────────────────────────────────────────────────
  describe('OpenAI-compatible (POST /v1/chat/completions)', () => {
    it('blocks message with PII in detect mode (400, JSON type)', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['US_SSN']));

      const res = await request(openaiApp)
        .post('/v1/chat/completions')
        .send({
          model: 'agent-123',
          messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('pii_detected');
      expect(res.body.error.message).toContain('personal information');
    });

    it('passes through when feature is disabled', async () => {
      process.env.PII_DETECTION = 'false';

      const res = await request(openaiApp)
        .post('/v1/chat/completions')
        .send({
          model: 'agent-123',
          messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
        });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('fails open when redakt is unavailable', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(openaiApp)
        .post('/v1/chat/completions')
        .send({
          model: 'agent-123',
          messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
        });

      expect(res.status).toBe(200);
    });

    it('allows message with no PII detected', async () => {
      axios.post.mockResolvedValueOnce(noPiiResponse());

      const res = await request(openaiApp)
        .post('/v1/chat/completions')
        .send({
          model: 'agent-123',
          messages: [{ role: 'user', content: 'What is the weather today?' }],
        });

      expect(res.status).toBe(200);
    });

    it('bypasses PII check when PII_DETECTION_API_ROUTES is false', async () => {
      process.env.PII_DETECTION_API_ROUTES = 'false';

      const res = await request(openaiApp)
        .post('/v1/chat/completions')
        .send({
          model: 'agent-123',
          messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
        });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Open Responses — POST /v1/responses/
  // ────────────────────────────────────────────────────────────────────────
  describe('Open Responses (POST /v1/responses/)', () => {
    it('blocks message with PII in detect mode (400, JSON type)', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['CREDIT_CARD']));

      const res = await request(responsesApp)
        .post('/v1/responses/')
        .send({
          model: 'agent-123',
          input: 'My credit card is 4111-1111-1111-1111',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('pii_detected');
      expect(res.body.error.message).toContain('personal information');
    });

    it('blocks PII in array input format', async () => {
      axios.post.mockResolvedValueOnce(piiDetectedResponse(['PERSON']));

      const res = await request(responsesApp)
        .post('/v1/responses/')
        .send({
          model: 'agent-123',
          input: [{ role: 'user', content: 'My name is John Smith' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('pii_detected');
    });

    it('passes through when feature is disabled', async () => {
      process.env.PII_DETECTION = 'false';

      const res = await request(responsesApp)
        .post('/v1/responses/')
        .send({
          model: 'agent-123',
          input: 'My credit card is 4111-1111-1111-1111',
        });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('fails open when redakt is unavailable', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(responsesApp)
        .post('/v1/responses/')
        .send({
          model: 'agent-123',
          input: 'My credit card is 4111-1111-1111-1111',
        });

      expect(res.status).toBe(200);
    });

    it('bypasses PII check when PII_DETECTION_API_ROUTES is false', async () => {
      process.env.PII_DETECTION_API_ROUTES = 'false';

      const res = await request(responsesApp)
        .post('/v1/responses/')
        .send({
          model: 'agent-123',
          input: 'My credit card is 4111-1111-1111-1111',
        });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Cross-cutting: fail-closed behaviour
  // ────────────────────────────────────────────────────────────────────────
  describe('Fail-closed behaviour', () => {
    it('returns 503 when redakt unavailable and fail-open is false', async () => {
      process.env.PII_DETECTION_FAIL_OPEN = 'false';
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(agentChatApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(503);
      expect(res.body.error.type).toBe('pii_service_unavailable');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 7. Cross-cutting: role exemption
  // ────────────────────────────────────────────────────────────────────────
  describe('Role exemption', () => {
    it('bypasses PII detection for exempt roles', async () => {
      process.env.PII_DETECTION_EXEMPT_ROLES = 'admin';

      // Build a separate app with admin user
      const adminApp = buildApp('/api/agents/chat', agentChatRouter, {
        id: 'admin-user',
        _id: 'admin-user',
        role: 'admin',
      });

      const res = await request(adminApp)
        .post('/api/agents/chat/')
        .send({ text: 'My name is John Smith' });

      expect(res.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
