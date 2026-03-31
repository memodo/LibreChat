const axios = require('axios');
const { createDetectPII, resetCircuitBreaker, extractTextForPII, sanitizeRequestBody } = require('../detectPII');

// Mock axios
jest.mock('axios');

// Mock dependencies
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn((val) => {
    if (val === undefined || val === null || val === '' || val === 'false') {
      return false;
    }
    return val === true || val === 'true' || !!val;
  }),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  ErrorTypes: {
    PII_DETECTION: 'pii_detection',
    MODERATION: 'moderation',
  },
}));

const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

function createReq(body = {}, overrides = {}) {
  return {
    body,
    user: overrides.user || { id: 'user1', role: 'user' },
    baseUrl: overrides.baseUrl || '/api/agents/chat',
    originalUrl: overrides.originalUrl || '/api/agents/chat/',
    ...overrides,
  };
}

function createRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    writeHead: jest.fn(),
    headersSent: false,
  };
  return res;
}

describe('detectPII middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCircuitBreaker();
    process.env = { ...originalEnv };
    // Default: feature enabled
    process.env.PII_DETECTION = 'true';
    process.env.PII_DETECTION_API_URL = 'http://localhost:8000';
    process.env.PII_DETECTION_TIMEOUT = '2000';
    delete process.env.PII_DETECTION_FAIL_OPEN;
    delete process.env.PII_DETECTION_SCORE_THRESHOLD;
    delete process.env.PII_DETECTION_ALLOW_LIST;
    delete process.env.PII_DETECTION_EXEMPT_ROLES;
    delete process.env.PII_DETECTION_LANGUAGE;
    delete process.env.PII_DETECTION_API_ROUTES;
    delete process.env.PII_DETECTION_MODE;

    // Mock health check to succeed by default
    axios.get = jest.fn().mockResolvedValue({ data: { status: 'ok' } });
    axios.post = jest.fn().mockResolvedValue({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // Test 1: Feature disabled (PII_DETECTION unset/false)
  test('1. calls next() when PII_DETECTION is unset/false, no axios call', async () => {
    process.env.PII_DETECTION = 'false';
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 2: Feature disabled (PII_DETECTION empty string)
  test('2. calls next() when PII_DETECTION is empty string, no axios call', async () => {
    process.env.PII_DETECTION = '';
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 3: Empty text (undefined)
  test('3. calls next() when req.body.text is undefined, no axios call', async () => {
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({});
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 4: Empty text (empty string)
  test('4. calls next() when req.body.text is empty string, no axios call', async () => {
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: '' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 5: Empty text (whitespace only)
  test('5. calls next() when req.body.text is whitespace-only, no axios call', async () => {
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: '   \n\t  ' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 6: No PII found
  test('6. calls next() when redakt returns has_pii: false', async () => {
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello, how are you?' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // Test 7: PII found
  test('7. returns 400 JSON error when redakt returns has_pii: true with PERSON', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'My name is John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 8: Human-readable entity labels
  test('8. error message includes human-readable entity types for PERSON and EMAIL_ADDRESS', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON', 'EMAIL_ADDRESS'], entity_count: 2 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith john@example.com' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.error.message).toContain('names');
    expect(jsonArg.error.message).toContain('email addresses');
  });

  // Test 9: PII text sanitization (standard chat)
  test('9. sanitizes req.body.text before returning JSON error when PII found', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'My name is John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(req.body.text).toBe('[Message blocked: PII detected - PERSON]');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 9a: PII text sanitization (OpenAI format)
  test('9a. sanitizes req.body.messages user content when PII found on API route', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['EMAIL_ADDRESS'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'My email is john@example.com' },
      ],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(req.body.messages[0].content).toBe('You are a helper'); // system unchanged
    expect(req.body.messages[1].content).toBe('[Message blocked: PII detected - EMAIL_ADDRESS]');
  });

  // Test 9b: PII text sanitization (Open Responses format)
  test('9b. sanitizes req.body.input when PII found on API route (string input)', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PHONE_NUMBER'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      input: 'Call me at 555-1234',
    }, { baseUrl: '/api/agents/v1/responses' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(req.body.input).toBe('[Message blocked: PII detected - PHONE_NUMBER]');
  });

  // Test 10: Custom API URL
  test('10. uses PII_DETECTION_API_URL value for axios call', async () => {
    process.env.PII_DETECTION_API_URL = 'https://redakt.example.com';
    resetCircuitBreaker(); // reset to pick up new URL
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(axios.post).toHaveBeenCalledWith(
      'https://redakt.example.com/api/detect',
      expect.any(Object),
      expect.any(Object),
    );
  });

  // Test 11: Score threshold
  test('11. includes score_threshold in redakt request when PII_DETECTION_SCORE_THRESHOLD is set', async () => {
    process.env.PII_DETECTION_SCORE_THRESHOLD = '0.7';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.score_threshold).toBe(0.7);
  });

  // Test 12: Allow list
  test('12. includes allow_list in redakt request when PII_DETECTION_ALLOW_LIST is set', async () => {
    process.env.PII_DETECTION_ALLOW_LIST = 'John, jane_doe, test@example.com';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.allow_list).toEqual(['John', 'jane_doe', 'test@example.com']);
  });

  // Test 13: Timeout configuration
  test('13. uses PII_DETECTION_TIMEOUT for axios timeout', async () => {
    process.env.PII_DETECTION_TIMEOUT = '5000';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const axiosConfig = axios.post.mock.calls[0][2];
    expect(axiosConfig.timeout).toBe(5000);
  });

  // Test 14: API timeout (fail-closed)
  test('14. returns 503 JSON error on timeout when fail-closed (default)', async () => {
    const timeoutError = new Error('timeout');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValueOnce(timeoutError);
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 15: API timeout (fail-open)
  test('15. calls next() on timeout when fail-open', async () => {
    process.env.PII_DETECTION_FAIL_OPEN = 'true';
    const timeoutError = new Error('timeout');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValueOnce(timeoutError);
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // Test 16: API connection error (fail-closed)
  test('16. returns 503 JSON error on ECONNREFUSED when fail-closed', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValueOnce(connError);
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 17: API connection error (fail-open)
  test('17. calls next() on ECONNREFUSED when fail-open', async () => {
    process.env.PII_DETECTION_FAIL_OPEN = 'true';
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValueOnce(connError);
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // Test 18: API 503 error (fail-closed)
  test('18. returns 503 JSON error on 503 response when fail-closed', async () => {
    const serverError = new Error('Service Unavailable');
    serverError.response = { status: 503 };
    axios.post.mockRejectedValueOnce(serverError);
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 19: Invalid response (missing has_pii)
  test('19. handles invalid response (missing has_pii) per fail config', async () => {
    axios.post.mockResolvedValueOnce({ data: { some_other_field: true } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // fail-closed by default
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 20: OpenAI-compatible format extraction
  test('20. extracts text from req.body.messages (OpenAI-compatible format)', async () => {
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am fine!' },
        { role: 'user', content: 'Tell me about Paris' },
      ],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text).toBe('Hello, how are you?\nTell me about Paris');
    expect(next).toHaveBeenCalled();
  });

  // Test 21: OpenAI-compatible format with array content
  test('21. extracts .text field from array content parts with type: "text" (not .content)', async () => {
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
            { type: 'text', text: 'in detail please' },
          ],
        },
      ],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text).toBe('Describe this image\nin detail please');
  });

  // Test 22: Open Responses format (string input)
  test('22. extracts text from req.body.input as string', async () => {
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      input: 'Hello from Responses API',
    }, { baseUrl: '/api/agents/v1/responses' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text).toBe('Hello from Responses API');
  });

  // Test 23: Open Responses format (array input)
  test('23. extracts user content from req.body.input as array', async () => {
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      input: [
        { type: 'message', role: 'user', content: 'First message' },
        { type: 'message', role: 'assistant', content: 'Response' },
        { type: 'message', role: 'user', content: 'Second message' },
      ],
    }, { baseUrl: '/api/agents/v1/responses' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text).toBe('First message\nSecond message');
  });

  // Test 24: Exempt roles
  test('24. calls next() without redakt call when user role is exempt', async () => {
    process.env.PII_DETECTION_EXEMPT_ROLES = 'admin';
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith john@example.com' }, { user: { id: 'admin1', role: 'admin' } });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 25: Non-exempt role
  test('25. performs PII check when user role is not exempt', async () => {
    process.env.PII_DETECTION_EXEMPT_ROLES = 'admin';
    axios.post.mockResolvedValueOnce({ data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' }, { user: { id: 'user1', role: 'user' } });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(axios.post).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 26: Circuit breaker opens after 5 consecutive errors
  test('26. circuit breaker opens after 5 consecutive errors, 6th request bypasses redakt', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(connError);

    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Send 5 requests to trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      const req = createReq({ text: 'Hello' });
      const res = createRes();
      const next = jest.fn();
      await middleware(req, res, next);
    }

    // 6th request should not call axios.post (circuit open)
    axios.post.mockClear();
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    // In fail-closed (default), message is blocked without calling redakt
    expect(axios.post).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 27: Circuit breaker closes after cooldown (uses Date.now mocking)
  test('27. after cooldown expires, circuit transitions to half-open and closes on success', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(connError);

    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Trigger circuit breaker (5 failures to open)
    for (let i = 0; i < 5; i++) {
      const req = createReq({ text: 'Hello' });
      const res = createRes();
      await middleware(req, res, jest.fn());
    }

    // Simulate cooldown elapsed via Date.now mock (31s later)
    const realDateNow = Date.now;
    Date.now = jest.fn(() => realDateNow() + 31000);

    // Next request should probe redakt (half-open) and succeed
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    expect(axios.post).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    // Verify circuit closed after successful probe
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Circuit breaker closed'),
      expect.any(Object),
    );

    Date.now = realDateNow;
  });

  // Test 28: JSON error response for API routes
  test('28. returns JSON error (not denyRequest) for API routes when PII found', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [{ role: 'user', content: 'John Smith' }],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: 'pii_detected',
          message: expect.stringContaining('names'),
        }),
      }),
    );
  });

  // Test 29: No PII in logs
  test('29. logger calls never include req.body.text or PII values', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const piiText = 'My name is John Smith and my email is john@example.com';
    const req = createReq({ text: piiText });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // Check all logger calls for PII leakage
    const allLogCalls = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
    ];

    for (const call of allLogCalls) {
      const logStr = JSON.stringify(call);
      expect(logStr).not.toContain('John Smith');
      expect(logStr).not.toContain('john@example.com');
      expect(logStr).not.toContain(piiText);
    }
  });

  // Test 30: Circuit breaker half-open probe success
  test('30. half-open probe success closes the circuit', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(connError);

    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Trigger circuit breaker (5 failures)
    for (let i = 0; i < 5; i++) {
      await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());
    }

    // Manually simulate cooldown by resetting the circuitOpenUntil via module internals
    // We'll use a workaround: reset and manually set state to half-open
    // Since we can't directly access module state, we reset and re-create the failure pattern
    // with time manipulation. Instead, we'll test the extractTextForPII and circuit logic separately.
    // For a realistic test, we'll verify that after reset and 5 failures, the state transitions work.

    // Alternative: just test from fresh with controlled timing
    resetCircuitBreaker();

    // Simulate 5 errors to open circuit
    axios.post.mockRejectedValue(connError);
    for (let i = 0; i < 5; i++) {
      await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());
    }

    // The circuit is now open. To test half-open, we need the cooldown to expire.
    // Since the cooldown is module-level, we'll use Date.now mock.
    const realDateNow = Date.now;
    Date.now = jest.fn(() => realDateNow() + 31000); // 31 seconds later

    // Next request should be a probe (half-open)
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    expect(axios.post).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    // Circuit should be closed now
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Circuit breaker closed'),
      expect.any(Object),
    );

    Date.now = realDateNow;
  });

  // Test 31: Circuit breaker half-open probe failure
  test('31. half-open probe failure re-opens the circuit', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';

    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Trigger circuit breaker (5 failures)
    axios.post.mockRejectedValue(connError);
    for (let i = 0; i < 5; i++) {
      await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());
    }

    // Simulate cooldown elapsed
    const realDateNow = Date.now;
    Date.now = jest.fn(() => realDateNow() + 31000);

    // Probe request - also fails
    axios.post.mockRejectedValueOnce(connError);
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    // Circuit should re-open
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('re-opened'),
      expect.any(Object),
    );

    Date.now = realDateNow;
  });

  // Test 32: Language hint
  test('32. passes PII_DETECTION_LANGUAGE value as language field in request body', async () => {
    process.env.PII_DETECTION_LANGUAGE = 'de';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Mein Name ist Hans Mueller' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.language).toBe('de');
  });

  // Test 33: API route toggle disabled
  test('33. calls next() on API route without redakt call when PII_DETECTION_API_ROUTES=false', async () => {
    process.env.PII_DETECTION_API_ROUTES = 'false';
    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [{ role: 'user', content: 'John Smith john@example.com' }],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Test 34: Detection mode validation
  test('34. disables feature with error log when PII_DETECTION_MODE=anonymize', async () => {
    process.env.PII_DETECTION_MODE = 'anonymize';
    resetCircuitBreaker(); // reset mode validation state
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('anonymize'),
      expect.any(Object),
    );
  });

  // Test 35: Startup health check
  test('35. calls GET /api/health on first middleware load when feature enabled', async () => {
    process.env.PII_DETECTION = 'true';
    resetCircuitBreaker(); // reset health check state
    axios.get.mockResolvedValueOnce({ data: { status: 'ok' } });

    createDetectPII({ responseFormat: 'sse' });

    // Wait for async health check
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(axios.get).toHaveBeenCalledWith(
      'http://localhost:8000/api/health',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  // Test 36: Structured log fields
  test('36. PII detection log entries include all structured fields from REQ-030', async () => {
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const warnCalls = logger.warn.mock.calls;
    const blockCall = warnCalls.find((call) => call[0].includes('PII detected'));
    expect(blockCall).toBeDefined();
    const logData = blockCall[1];
    expect(logData).toHaveProperty('event', 'pii_detection');
    expect(logData).toHaveProperty('action', 'block');
    expect(logData).toHaveProperty('entityTypes');
    expect(logData).toHaveProperty('entityCount');
    expect(logData).toHaveProperty('latencyMs');
    expect(logData).toHaveProperty('circuitState');
    expect(logData).toHaveProperty('route');
  });

  // Test 37: Exempt role with undefined req.user
  test('37. proceeds with PII detection when req.user is undefined (non-exempt default)', async () => {
    process.env.PII_DETECTION_EXEMPT_ROLES = 'admin';
    axios.post.mockResolvedValueOnce({ data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'John Smith' }, { user: undefined });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(axios.post).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  // Test 38: FAIL-005 — 422 response does NOT increment circuit breaker counter
  test('38. 422 response from redakt does not increment circuit breaker counter', async () => {
    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Send 4 normal errors (circuit breaker at 4)
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    for (let i = 0; i < 4; i++) {
      axios.post.mockRejectedValueOnce(connError);
      await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());
    }

    // Send a 422 error — should NOT push circuit breaker to 5
    const validationError = new Error('Validation Error');
    validationError.response = { status: 422 };
    axios.post.mockRejectedValueOnce(validationError);
    await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());

    // Send another request — circuit should still be closed (counter stayed at 4, not 5)
    // so redakt should still be called
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    // If circuit had opened, axios.post would NOT have been called
    expect(axios.post).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  // Test 39: JSON 503 response on API routes when redakt is unavailable (fail-closed)
  test('39. returns JSON 503 response on API route when redakt is unavailable (fail-closed)', async () => {
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValueOnce(connError);

    const middleware = createDetectPII({ responseFormat: 'json', isApiRoute: true });
    const req = createReq({
      messages: [{ role: 'user', content: 'Hello' }],
    }, { baseUrl: '/api/agents/v1/chat/completions' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: 'pii_service_unavailable',
          message: expect.stringContaining('content safety check unavailable'),
        }),
      }),
    );
  });

  // Test 40: EDGE-002 — Very long text (512K characters)
  test('40. handles very long text (512K characters) — passes to redakt or handles 422', async () => {
    const longText = 'a'.repeat(512000);
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });

    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: longText });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // Verify the long text was sent to redakt
    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text.length).toBe(512000);
    expect(next).toHaveBeenCalled();
  });

  // Test 41: EDGE-002 — Text exceeding 512K triggers 422 and is handled gracefully
  test('41. handles 422 from redakt for oversized text without opening circuit breaker', async () => {
    const oversizedText = 'a'.repeat(600000);
    const validationError = new Error('Validation Error');
    validationError.response = { status: 422 };
    axios.post.mockRejectedValueOnce(validationError);

    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: oversizedText });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // Default is fail-closed, so request should be blocked with 503
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    // Verify circuit breaker was NOT incremented by checking a subsequent request works
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const req2 = createReq({ text: 'Short text' });
    const res2 = createRes();
    const next2 = jest.fn();
    await middleware(req2, res2, next2);

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(next2).toHaveBeenCalled();
  });

  // Test 42: EDGE-008 — Concurrent requests do not cross-contaminate
  test('42. concurrent requests do not cross-contaminate results', async () => {
    // First request has PII, second does not
    axios.post
      .mockResolvedValueOnce({ data: { has_pii: true, entities_found: ['PERSON'], entity_count: 1 } })
      .mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });

    const middleware = createDetectPII({ responseFormat: 'sse' });

    const req1 = createReq({ text: 'My name is John Smith' });
    const res1 = createRes();
    const next1 = jest.fn();

    const req2 = createReq({ text: 'What is the weather?' });
    const res2 = createRes();
    const next2 = jest.fn();

    // Run concurrently
    await Promise.all([
      middleware(req1, res1, next1),
      middleware(req2, res2, next2),
    ]);

    // First request blocked, second allowed
    expect(next1).not.toHaveBeenCalled();
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(res1.json).toHaveBeenCalled();
    expect(next2).toHaveBeenCalled();
  });

  // Test 43: Fail-open with circuit breaker open — requests allowed through
  test('43. circuit breaker open with fail-open allows requests through without calling redakt', async () => {
    process.env.PII_DETECTION_FAIL_OPEN = 'true';
    const connError = new Error('connect ECONNREFUSED');
    connError.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(connError);

    const middleware = createDetectPII({ responseFormat: 'sse' });

    // Trigger circuit breaker (5 failures)
    for (let i = 0; i < 5; i++) {
      await middleware(createReq({ text: 'Hello' }), createRes(), jest.fn());
    }

    // 6th request — circuit open, fail-open mode
    axios.post.mockClear();
    const req = createReq({ text: 'Hello again' });
    const res = createRes();
    const next = jest.fn();
    await middleware(req, res, next);

    // Should allow through without calling redakt
    expect(axios.post).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  // Test 44: Multi-field extraction — PII in messages detected even when text is also present
  test('44. extracts and checks text from all body fields, not just the first match', async () => {
    // PII is in messages, not in text — both should be checked
    axios.post.mockResolvedValueOnce({
      data: { has_pii: true, entities_found: ['EMAIL_ADDRESS'], entity_count: 1 },
    });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({
      text: 'Hello world',
      messages: [{ role: 'user', content: 'john@example.com' }],
    });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // The concatenated text sent to redakt should contain both fields
    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.text).toContain('Hello world');
    expect(requestBody.text).toContain('john@example.com');
  });

  // Test 45: Invalid score threshold is ignored with warning
  test('45. invalid PII_DETECTION_SCORE_THRESHOLD is ignored and logs a warning', async () => {
    process.env.PII_DETECTION_SCORE_THRESHOLD = 'abc';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    // score_threshold should NOT be in the request body
    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.score_threshold).toBeUndefined();
    // Warning should have been logged
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid PII_DETECTION_SCORE_THRESHOLD'),
      expect.any(Object),
    );
  });

  // Test 46: Score threshold out of range (>1) is ignored
  test('46. out-of-range PII_DETECTION_SCORE_THRESHOLD (>1) is ignored', async () => {
    process.env.PII_DETECTION_SCORE_THRESHOLD = '5.0';
    axios.post.mockResolvedValueOnce({ data: { has_pii: false, entities_found: [], entity_count: 0 } });
    const middleware = createDetectPII({ responseFormat: 'sse' });
    const req = createReq({ text: 'Hello world' });
    const res = createRes();
    const next = jest.fn();

    await middleware(req, res, next);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.score_threshold).toBeUndefined();
  });

  // Additional: extractTextForPII unit tests
  describe('extractTextForPII', () => {
    test('returns string from req.body.text', () => {
      const req = { body: { text: 'Hello world' } };
      expect(extractTextForPII(req)).toBe('Hello world');
    });

    test('returns null when body is empty', () => {
      const req = { body: {} };
      expect(extractTextForPII(req)).toBeNull();
    });

    test('filters non-user messages in OpenAI format', () => {
      const req = {
        body: {
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'User message' },
            { role: 'assistant', content: 'Assistant reply' },
          ],
        },
      };
      expect(extractTextForPII(req)).toBe('User message');
    });

    test('handles Open Responses array input', () => {
      const req = {
        body: {
          input: [
            { role: 'user', content: 'Message 1' },
            { role: 'assistant', content: 'Reply' },
            { role: 'user', content: 'Message 2' },
          ],
        },
      };
      expect(extractTextForPII(req)).toBe('Message 1\nMessage 2');
    });

    test('concatenates text from multiple body fields when present', () => {
      const req = {
        body: {
          text: 'Standard field',
          messages: [{ role: 'user', content: 'OpenAI field' }],
        },
      };
      expect(extractTextForPII(req)).toBe('Standard field\nOpenAI field');
    });
  });

  // Additional: sanitizeRequestBody unit tests
  describe('sanitizeRequestBody', () => {
    test('sanitizes req.body.text', () => {
      const req = { body: { text: 'Original PII text' } };
      sanitizeRequestBody(req, '[SANITIZED]');
      expect(req.body.text).toBe('[SANITIZED]');
    });

    test('sanitizes user messages in OpenAI format', () => {
      const req = {
        body: {
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'PII text' },
          ],
        },
      };
      sanitizeRequestBody(req, '[SANITIZED]');
      expect(req.body.messages[0].content).toBe('System prompt');
      expect(req.body.messages[1].content).toBe('[SANITIZED]');
    });

    test('sanitizes string input in Open Responses format', () => {
      const req = { body: { input: 'PII text' } };
      sanitizeRequestBody(req, '[SANITIZED]');
      expect(req.body.input).toBe('[SANITIZED]');
    });

    test('sanitizes array input in Open Responses format', () => {
      const req = {
        body: {
          input: [
            { role: 'user', content: 'PII text' },
            { role: 'assistant', content: 'Reply' },
          ],
        },
      };
      sanitizeRequestBody(req, '[SANITIZED]');
      expect(req.body.input[0].content).toBe('[SANITIZED]');
      expect(req.body.input[1].content).toBe('Reply');
    });
  });
});
