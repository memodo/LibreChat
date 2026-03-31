const axios = require('axios');
const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { ErrorTypes } = require('librechat-data-provider');
// Circuit breaker state (module-level, safe in single-threaded Node.js).
// Known limitation: state is per-process. In PM2 cluster mode or multi-replica deployments,
// each process maintains independent circuit breaker state. This matches the moderateText pattern.
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let circuitState = 'closed'; // 'closed' | 'open' | 'half-open'
let probeInFlight = false; // Guards half-open state so only one request probes redakt
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30000;

// Detection mode validation state
let modeValidated = false;
let modeDisabled = false;

// Startup health check state
let healthCheckDone = false;

// Entity type label mapping (REQ-012)
const ENTITY_LABELS = {
  PERSON: 'names',
  EMAIL_ADDRESS: 'email addresses',
  PHONE_NUMBER: 'phone numbers',
  CREDIT_CARD: 'credit card numbers',
  IBAN_CODE: 'bank account numbers',
  US_SSN: 'social security numbers',
  LOCATION: 'addresses',
  IP_ADDRESS: 'IP addresses',
};

/**
 * Maps Presidio entity type labels to human-readable labels.
 * @param {string[]} entityTypes - Array of Presidio entity type strings
 * @returns {string} Comma-separated human-readable labels
 */
function mapEntityLabels(entityTypes) {
  if (!entityTypes || !Array.isArray(entityTypes) || entityTypes.length === 0) {
    return 'personal information';
  }
  const unique = [...new Set(entityTypes)];
  return unique.map((type) => ENTITY_LABELS[type] || type).join(', ');
}

/**
 * Extracts user message text from request body, handling three formats.
 * @param {Object} req - Express request object
 * @returns {string|null} Extracted text or null if no text found
 */
function extractTextForPII(req) {
  const { body } = req;
  // Defense-in-depth: Concatenate text from ALL present body fields rather than
  // short-circuiting on the first match. Each route type normally uses only one format
  // (REQ-008: agent chat uses `text`, REQ-009: OpenAI uses `messages`, REQ-010: Responses
  // uses `input`), but a malformed or crafted request could contain multiple fields.
  // Concatenating all fields ensures PII in any field is checked by redakt.
  const parts = [];

  // Format 1: Standard chat routes (req.body.text)
  if (typeof body.text === 'string') {
    parts.push(body.text);
  }

  // Format 2: OpenAI-compatible (req.body.messages)
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== 'user') {
        continue;
      }
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        const contentParts = msg.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .filter(Boolean);
        if (contentParts.length > 0) {
          parts.push(contentParts.join('\n'));
        }
      }
    }
  }

  // Format 3: Open Responses (req.body.input)
  if (body.input !== undefined) {
    if (typeof body.input === 'string') {
      parts.push(body.input);
    } else if (Array.isArray(body.input)) {
      const inputTexts = body.input
        .filter((item) => item.role === 'user')
        .map((item) => item.content)
        .filter(Boolean);
      if (inputTexts.length > 0) {
        parts.push(inputTexts.join('\n'));
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Sanitizes all user text fields in the request body to prevent PII persistence (REQ-011).
 * @param {Object} req - Express request object
 * @param {string} sanitizedText - The replacement string
 */
function sanitizeRequestBody(req, sanitizedText) {
  const { body } = req;

  // Standard chat format
  if (typeof body.text === 'string') {
    body.text = sanitizedText;
  }

  // OpenAI-compatible format
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === 'user') {
        msg.content = sanitizedText;
      }
    }
  }

  // Open Responses format
  if (body.input !== undefined) {
    if (typeof body.input === 'string') {
      body.input = sanitizedText;
    } else if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (item.role === 'user') {
          item.content = sanitizedText;
        }
      }
    }
  }
}

/**
 * Determines the route type for structured logging.
 * @param {Object} req - Express request object
 * @returns {string} Route type identifier
 */
function getRouteType(req) {
  const path = req.baseUrl || req.originalUrl || '';
  if (path.includes('/agents/v1/chat/completions') || path.includes('/openai')) {
    return 'openai';
  }
  if (path.includes('/agents/v1/responses') || path.includes('/responses')) {
    return 'responses';
  }
  if (path.includes('/assistants/')) {
    return 'assistant';
  }
  return 'agent';
}

/**
 * Performs the startup health check against the redakt API (REQ-026).
 * @param {string} apiUrl - The redakt API base URL
 */
async function performHealthCheck(apiUrl) {
  if (healthCheckDone) {
    return;
  }
  healthCheckDone = true;

  const failOpen = isEnabled(process.env.PII_DETECTION_FAIL_OPEN);
  const behaviorDesc = failOpen ? 'allowed' : 'blocked';

  try {
    await axios.get(`${apiUrl}/api/health`, { timeout: 5000 });
    logger.info('[detectPII] PII detection enabled. redakt service is reachable.', {
      event: 'pii_detection',
      action: 'health_check',
      apiUrl,
    });
  } catch (error) {
    logger.warn(
      `[detectPII] PII detection is enabled but redakt service is unreachable at ${apiUrl}. Messages will be ${behaviorDesc} per PII_DETECTION_FAIL_OPEN config.`,
      {
        event: 'pii_detection',
        action: 'health_check_failed',
        apiUrl,
      },
    );
  }
}

/**
 * Factory function that creates a PII detection middleware configured for the given response format.
 * @param {Object} options
 * @param {'sse'|'json'} options.responseFormat - Response format for this route ('sse' or 'json')
 * @param {boolean} [options.isApiRoute=false] - Whether this is an API route (for PII_DETECTION_API_ROUTES toggle)
 * @returns {Function} Express middleware function
 */
function createDetectPII({ responseFormat = 'sse', isApiRoute = false } = {}) {
  const apiUrl = process.env.PII_DETECTION_API_URL || 'http://localhost:8000';
  const timeout = parseInt(process.env.PII_DETECTION_TIMEOUT, 10) || 2000;

  // REQ-029: Validate detection mode on first load
  if (!modeValidated) {
    modeValidated = true;
    const mode = process.env.PII_DETECTION_MODE || 'detect';
    if (mode !== 'detect') {
      logger.error(
        `[detectPII] PII_DETECTION_MODE='${mode}' is not supported in v1. Only 'detect' is supported. PII detection disabled.`,
        { event: 'pii_detection', action: 'error' },
      );
      modeDisabled = true;
    }
  }

  // REQ-026: Startup health check (non-blocking)
  if (isEnabled(process.env.PII_DETECTION) && !modeDisabled) {
    performHealthCheck(apiUrl);
  }

  return async function detectPII(req, res, next) {
    const startTime = Date.now();
    const route = getRouteType(req);

    // REQ-029: If mode is invalid, feature is disabled
    if (modeDisabled) {
      return next();
    }

    // REQ-001: Feature toggle
    if (!isEnabled(process.env.PII_DETECTION)) {
      return next();
    }

    // REQ-028: API route toggle
    if (isApiRoute && !isEnabled(process.env.PII_DETECTION_API_ROUTES ?? 'true')) {
      logger.debug('[detectPII] PII detection bypassed for API route (PII_DETECTION_API_ROUTES=false)', {
        event: 'pii_detection',
        action: 'bypass',
        route,
      });
      return next();
    }

    // REQ-018: Role-based exemptions
    const exemptRolesStr = process.env.PII_DETECTION_EXEMPT_ROLES || '';
    if (exemptRolesStr && req.user?.role) {
      const exemptRoles = exemptRolesStr.split(',').map((r) => r.trim().toLowerCase());
      if (exemptRoles.includes(req.user.role.toLowerCase())) {
        logger.debug('[detectPII] PII detection bypassed for exempt role', {
          event: 'pii_detection',
          action: 'bypass',
          route,
          circuitState,
        });
        return next();
      }
    }

    // REQ-008/009/010: Extract text
    const text = extractTextForPII(req);

    // REQ-019: Empty text passthrough
    if (!text || !text.trim()) {
      return next();
    }

    const failOpen = isEnabled(process.env.PII_DETECTION_FAIL_OPEN);

    // REQ-022: Circuit breaker check
    if (circuitState === 'open' || (circuitState === 'half-open' && probeInFlight)) {
      if (circuitState === 'open' && Date.now() >= circuitOpenUntil) {
        if (!probeInFlight) {
          // Transition to half-open; this request becomes the single probe
          circuitState = 'half-open';
          probeInFlight = true;
          logger.warn('[detectPII] Circuit breaker entering half-open state. Next request will probe redakt.', {
            event: 'pii_detection',
            action: 'circuit_halfopen',
            circuitState: 'half-open',
            route,
          });
          // Allow this request to proceed as probe (fall through to API call)
        } else {
          // Another probe is already in flight; treat like open circuit
          const latencyMs = Date.now() - startTime;
          if (failOpen) {
            logger.warn('[detectPII] Circuit half-open, probe in flight, allowing message (fail-open)', {
              event: 'pii_detection',
              action: 'bypass',
              circuitState,
              latencyMs,
              route,
            });
            return next();
          } else {
            logger.warn('[detectPII] Circuit half-open, probe in flight, blocking message (fail-closed)', {
              event: 'pii_detection',
              action: 'block',
              circuitState,
              latencyMs,
              route,
            });
            return handleServiceError(req, res, responseFormat, route, startTime);
          }
        }
      } else {
        // Circuit is still open (cooldown not expired) or half-open with probe in flight
        const latencyMs = Date.now() - startTime;
        if (failOpen) {
          logger.warn('[detectPII] Circuit open, allowing message (fail-open)', {
            event: 'pii_detection',
            action: 'bypass',
            circuitState,
            latencyMs,
            route,
          });
          return next();
        } else {
          logger.warn('[detectPII] Circuit open, blocking message (fail-closed)', {
            event: 'pii_detection',
            action: 'block',
            circuitState,
            latencyMs,
            route,
          });
          return handleServiceError(req, res, responseFormat, route, startTime);
        }
      }
    }

    // Build request body for redakt API
    const detectBody = { text };

    // REQ-016: Optional score threshold (validated as finite number between 0 and 1)
    const scoreThreshold = process.env.PII_DETECTION_SCORE_THRESHOLD;
    if (scoreThreshold !== undefined && scoreThreshold !== '') {
      const parsed = parseFloat(scoreThreshold);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        detectBody.score_threshold = parsed;
      } else {
        logger.warn(
          `[detectPII] Invalid PII_DETECTION_SCORE_THRESHOLD='${scoreThreshold}'. Must be a number between 0 and 1. Ignoring.`,
          { event: 'pii_detection', action: 'config_warning', route },
        );
      }
    }

    // REQ-017: Optional allow list
    const allowList = process.env.PII_DETECTION_ALLOW_LIST;
    if (allowList) {
      detectBody.allow_list = allowList.split(',').map((s) => s.trim());
    }

    // REQ-027: Language hint
    const language = process.env.PII_DETECTION_LANGUAGE || 'auto';
    if (language !== 'auto') {
      detectBody.language = language;
    }

    try {
      const response = await axios.post(`${apiUrl}/api/detect`, detectBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout,
      });

      const data = response.data;

      // FAIL-009: Validate response schema
      if (data === null || data === undefined || typeof data.has_pii !== 'boolean') {
        throw new Error('Invalid response from redakt: missing has_pii field');
      }

      if (data.has_pii) {
        // PII detected - block the message
        const entityTypes = data.entities_found || [];
        const humanLabels = mapEntityLabels(entityTypes);
        const latencyMs = Date.now() - startTime;

        logger.warn('[detectPII] PII detected in message, blocking', {
          event: 'pii_detection',
          action: 'block',
          entityTypes,
          entityCount: data.entity_count || entityTypes.length,
          latencyMs,
          circuitState,
          route,
        });

        // REQ-011: Sanitize ALL text fields before denial
        const sanitizedText = `[Message blocked: PII detected - ${entityTypes.join(', ')}]`;
        sanitizeRequestBody(req, sanitizedText);

        // Reset circuit breaker on successful API call
        if (consecutiveFailures > 0) {
          consecutiveFailures = 0;
        }
        if (circuitState === 'half-open') {
          circuitState = 'closed';
          probeInFlight = false;
          logger.warn('[detectPII] Circuit breaker closed after successful probe.', {
            event: 'pii_detection',
            action: 'circuit_close',
            circuitState: 'closed',
            route,
          });
        }

        // REQ-020/021: Route-specific error response
        if (responseFormat === 'json') {
          const errorMessage = `Your message was not sent because it appears to contain personal information (${humanLabels}). Please remove personal details and try again.`;
          return res.status(400).json({
            error: {
              message: errorMessage,
              type: 'pii_detected',
            },
          });
        } else {
          // Agent/assistant chat routes use a two-step flow: POST returns a streamId,
          // then the client subscribes to SSE via GET. Since this middleware runs during
          // the initial POST (before any SSE connection), we must return a JSON error
          // that the client's axios error handler can process.
          const errorMessage = `Your message was not sent because it appears to contain personal information (${humanLabels}). Please remove personal details and try again.`;
          return res.status(400).json({
            error: {
              message: errorMessage,
              type: ErrorTypes.PII_DETECTION,
            },
          });
        }
      } else {
        // No PII found - allow through
        const latencyMs = Date.now() - startTime;

        logger.debug('[detectPII] No PII detected, allowing message', {
          event: 'pii_detection',
          action: 'allow',
          entityTypes: null,
          entityCount: 0,
          latencyMs,
          circuitState,
          route,
        });

        // Reset circuit breaker on success
        if (consecutiveFailures > 0) {
          consecutiveFailures = 0;
        }
        if (circuitState === 'half-open') {
          circuitState = 'closed';
          probeInFlight = false;
          logger.warn('[detectPII] Circuit breaker closed after successful probe.', {
            event: 'pii_detection',
            action: 'circuit_close',
            circuitState: 'closed',
            route,
          });
        }

        return next();
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const status = error.response?.status;

      // FAIL-005: 422 is a client error, don't count toward circuit breaker
      const isClientError = status === 422;

      if (!isClientError) {
        consecutiveFailures++;

        if (circuitState === 'half-open') {
          // Probe failed, re-open circuit
          circuitState = 'open';
          probeInFlight = false;
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          logger.warn(
            `[detectPII] Half-open probe failed. Circuit breaker re-opened for ${CIRCUIT_COOLDOWN_MS / 1000}s.`,
            {
              event: 'pii_detection',
              action: 'circuit_open',
              circuitState: 'open',
              consecutiveFailures,
              route,
            },
          );
        } else if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
          circuitState = 'open';
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          logger.warn(
            `[detectPII] Circuit breaker opened after ${consecutiveFailures} consecutive failures. PII checking bypassed for ${CIRCUIT_COOLDOWN_MS / 1000}s.`,
            {
              event: 'pii_detection',
              action: 'circuit_open',
              circuitState: 'open',
              consecutiveFailures,
              route,
            },
          );
        }
      }

      logger.error('[detectPII] Error calling redakt API', {
        event: 'pii_detection',
        action: 'error',
        errorCode: error.code || null,
        httpStatus: status || null,
        latencyMs,
        circuitState,
        consecutiveFailures,
        route,
      });

      if (failOpen) {
        logger.warn('[detectPII] Allowing message through (fail-open)', {
          event: 'pii_detection',
          action: 'bypass',
          latencyMs,
          circuitState,
          route,
        });
        return next();
      } else {
        return handleServiceError(req, res, responseFormat, route, startTime);
      }
    }
  };
}

/**
 * Handles service error responses (fail-closed) for both SSE and JSON routes.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {'sse'|'json'} responseFormat - Response format
 * @param {string} route - Route type for logging
 * @param {number} startTime - Request start timestamp
 */
async function handleServiceError(req, res, responseFormat, route, startTime) {
  const errorMsg = 'Message could not be sent: content safety check unavailable. Please try again later.';
  const sanitizedText = '[Message blocked: content safety check unavailable]';
  sanitizeRequestBody(req, sanitizedText);

  if (responseFormat === 'json') {
    return res.status(503).json({
      error: {
        message: errorMsg,
        type: 'pii_service_unavailable',
      },
    });
  } else {
    // Same as PII detection block: return JSON since this runs during the initial POST
    return res.status(503).json({
      error: {
        message: errorMsg,
        type: 'pii_service_unavailable',
      },
    });
  }
}

/**
 * Resets the circuit breaker state. Exposed for testing only.
 */
function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  circuitState = 'closed';
  probeInFlight = false;
  modeValidated = false;
  modeDisabled = false;
  healthCheckDone = false;
}

module.exports = { createDetectPII, resetCircuitBreaker, extractTextForPII, sanitizeRequestBody };
