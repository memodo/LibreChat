const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { limiterCache } = require('@librechat/api');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { logger } = require('@librechat/data-schemas');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsage = requireCapability(SystemCapabilities.READ_USAGE);

// ---------------------------------------------------------------------------
// Aggregation safety (FAIL-004) & replica set configuration (RISK-004)
// ---------------------------------------------------------------------------
// All aggregation pipelines use maxTimeMS to prevent runaway queries from
// blocking the MongoDB connection pool. Adjust AGGREGATION_TIMEOUT_MS as needed.
//
// For replica set deployments, readPreference can be configured at the Mongoose
// query level to offload reporting reads to secondaries:
//   Transaction.aggregate([...]).read('secondaryPreferred')
// This is not enabled by default; configure per deployment topology.
// ---------------------------------------------------------------------------
const AGGREGATION_TIMEOUT_MS = 10000;
const SLOW_QUERY_THRESHOLD_MS = 2000;

// ---------------------------------------------------------------------------
// Rate Limiting (PERF-003): 60 requests per minute per admin user
// ---------------------------------------------------------------------------
const USAGE_RATE_WINDOW = 1; // minutes
const USAGE_RATE_MAX = 60;

const usageRateLimiter = rateLimit({
  windowMs: USAGE_RATE_WINDOW * 60 * 1000,
  max: USAGE_RATE_MAX,
  keyGenerator: (req) => req.user?.id || req.user?._id || 'anonymous',
  handler: (_req, res) => {
    return res.status(429).json({
      status: 'error',
      message: `Too many requests. Limit: ${USAGE_RATE_MAX} requests per ${USAGE_RATE_WINDOW} minute(s).`,
    });
  },
  store: limiterCache('usage_report_limiter'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Zod Validation Schemas (SEC-003)
// ---------------------------------------------------------------------------

const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const MAX_RANGE_DAYS = 366;

const dateRangeSchema = z
  .object({
    startDate: z
      .string()
      .regex(isoDateRegex, 'Must be a valid ISO 8601 date')
      .optional(),
    endDate: z
      .string()
      .regex(isoDateRegex, 'Must be a valid ISO 8601 date')
      .optional(),
  })
  .transform((val) => {
    const now = new Date();
    let end = val.endDate ? new Date(val.endDate) : now;
    // When endDate is a date-only string (no time component), set to end of day
    // so that events from that entire day are included in the results.
    if (val.endDate && !val.endDate.includes('T')) {
      end.setUTCHours(23, 59, 59, 999);
    }
    // Clamp future endDate to now
    if (end > now) {
      end = now;
    }
    let start = val.startDate ? new Date(val.startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { startDate: start, endDate: end };
  })
  .refine((val) => val.startDate <= val.endDate, {
    message: 'startDate must be before or equal to endDate',
    path: ['startDate'],
  })
  .refine(
    (val) => {
      const diffMs = val.endDate.getTime() - val.startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= MAX_RANGE_DAYS;
    },
    {
      message: 'Date range cannot exceed 366 days.',
      path: ['startDate'],
    },
  );

// Build set of valid IANA timezone names for validation (SEC-003)
const validTimezones = new Set(Intl.supportedValuesOf('timeZone'));
validTimezones.add('UTC'); // Ensure UTC is always valid

const trendsQuerySchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  timezone: z
    .string()
    .max(64, 'Timezone string too long')
    .refine((tz) => validTimezones.has(tz), {
      message: 'Invalid IANA timezone',
    })
    .default('UTC'),
});

const searchSchema = z.object({
  search: z.string().min(2).optional(),
});

const userIdParamSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid MongoDB ObjectId'),
});

// ---------------------------------------------------------------------------
// Pagination (mirrors packages/api/src/admin/pagination.ts)
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

function parsePagination(query) {
  const rawLimit = parseInt(query.limit ?? '', 10);
  const rawOffset = parseInt(query.offset ?? '', 10);
  return {
    limit: Math.min(
      Math.max(Number.isNaN(rawLimit) ? DEFAULT_PAGE_LIMIT : rawLimit, 1),
      MAX_PAGE_LIMIT,
    ),
    offset: Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate date range from query params.
 * Returns { startDate: Date, endDate: Date } or throws validation error.
 */
function parseDateRange(query) {
  return dateRangeSchema.parse({
    startDate: query.startDate,
    endDate: query.endDate,
  });
}

/**
 * Build the base $match stage for Transaction aggregation.
 * Filters by date range, excludes credits, and optionally filters by tenantId.
 */
function buildTxMatchStage(startDate, endDate, tenantId) {
  const match = {
    createdAt: { $gte: startDate, $lte: endDate },
    tokenType: { $ne: 'credits' },
  };
  if (tenantId) {
    match.tenantId = tenantId;
  }
  return match;
}

/**
 * Build the base $match stage for Conversation aggregation.
 */
function buildConvoMatchStage(startDate, endDate, tenantId) {
  const match = {
    createdAt: { $gte: startDate, $lte: endDate },
  };
  if (tenantId) {
    match.tenantId = tenantId;
  }
  return match;
}

/**
 * Build the response envelope.
 */
function envelope(data, meta) {
  return {
    status: 'success',
    data,
    meta: {
      ...meta,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Format Zod errors into the spec error format.
 */
function formatZodError(err) {
  return {
    status: 'error',
    message: 'Validation error',
    errors: err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  };
}

/**
 * Detect MongoDB maxTimeMS timeout errors (FAIL-004).
 * Returns true if the error is a timeout error and sends 504 response.
 */
function handleTimeoutError(err, res) {
  if (err.code === 50 || err.codeName === 'MaxTimeMSExpired') {
    return res.status(504).json({
      status: 'error',
      message:
        'Report generation timed out. Try a shorter date range or contact your administrator about database optimization.',
    });
  }
  return null;
}

/**
 * Set X-Query-Slow header if query took longer than threshold (FAIL-001).
 */
function setSlowQueryHeader(res, startTime) {
  const elapsed = Date.now() - startTime;
  if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
    res.set('X-Query-Slow', 'true');
    logger.warn(`[USAGE_REPORT] Slow query detected: ${elapsed}ms`);
  }
}

/**
 * Audit log for reporting access (SEC-002).
 */
function auditLog(req, endpoint) {
  logger.info(`[USAGE_REPORT] User ${req.user?.id || req.user?._id} accessed ${endpoint}`, {
    userId: req.user?.id || req.user?._id,
    endpoint,
    query: req.query,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

router.use(requireJwtAuth, requireAdminAccess, requireReadUsage, usageRateLimiter);

// ---------------------------------------------------------------------------
// REQ-001: GET /overview — Summary metrics
// ---------------------------------------------------------------------------

router.get('/overview', async (req, res) => {
  auditLog(req, '/api/admin/usage/overview');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const tenantId = req.user?.tenantId;

    const Transaction = mongoose.model('Transaction');
    const Conversation = mongoose.model('Conversation');
    const User = mongoose.model('User');

    const txMatch = buildTxMatchStage(startDate, endDate, tenantId);

    const queryStart = Date.now();

    // Run all queries in parallel
    const [
      txAgg,
      activeUserAgg,
      convoCount,
      registeredUserCount,
      cancellationAgg,
    ] = await Promise.all([
      // Total tokenValue and transaction count
      Transaction.aggregate([
        { $match: txMatch },
        {
          $group: {
            _id: null,
            totalTokenValue: { $sum: '$tokenValue' },
            totalTransactions: { $sum: 1 },
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      // Active users: distinct users with non-credit transactions (using $group + $count, not distinct())
      Transaction.aggregate([
        { $match: txMatch },
        { $group: { _id: '$user' } },
        { $count: 'count' },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      // Conversation count in period
      Conversation.countDocuments(buildConvoMatchStage(startDate, endDate, tenantId)),
      // Total registered users (regardless of date range)
      User.countDocuments(tenantId ? { tenantId } : {}),
      // Cancellation breakdown
      Transaction.aggregate([
        { $match: { ...txMatch, context: 'incomplete' } },
        {
          $group: {
            _id: null,
            totalIncompleteSpend: { $sum: '$tokenValue' },
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const totalTokenValue = txAgg[0]?.totalTokenValue || 0;
    const totalTransactions = txAgg[0]?.totalTransactions || 0;
    const activeUsers = activeUserAgg[0]?.count || 0;
    const totalIncompleteSpend = cancellationAgg[0]?.totalIncompleteSpend || 0;
    const estimatedSurchargeAmount = Math.round(
      totalIncompleteSpend - totalIncompleteSpend / 1.15,
    );

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        {
          totalRegisteredUsers: registeredUserCount,
          activeUsers,
          totalConversations: convoCount,
          totalTokenValue,
          totalTransactions,
          cancellation: {
            totalIncompleteSpend,
            estimatedSurchargeAmount,
          },
        },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Overview error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// REQ-002: GET /trends — Time-series data
// ---------------------------------------------------------------------------

router.get('/trends', async (req, res) => {
  auditLog(req, '/api/admin/usage/trends');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const { granularity, timezone } = trendsQuerySchema.parse(req.query);
    const tenantId = req.user?.tenantId;

    const Transaction = mongoose.model('Transaction');
    const txMatch = buildTxMatchStage(startDate, endDate, tenantId);

    const queryStart = Date.now();

    // Build date grouping expression based on granularity
    let dateGroupExpr;
    switch (granularity) {
    case 'week':
      dateGroupExpr = {
        $dateToString: { format: '%G-W%V', date: '$createdAt', timezone },
      };
      break;
    case 'month':
      dateGroupExpr = {
        $dateToString: { format: '%Y-%m', date: '$createdAt', timezone },
      };
      break;
    case 'day':
    default:
      dateGroupExpr = {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone },
      };
      break;
    }

    const buckets = await Transaction.aggregate([
      { $match: txMatch },
      {
        $group: {
          _id: dateGroupExpr,
          totalTokenValue: { $sum: '$tokenValue' },
          totalRawTokens: { $sum: { $abs: { $ifNull: ['$rawAmount', 0] } } },
          transactionCount: { $sum: 1 },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$context', 'incomplete'] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalTokenValue: 1,
          totalRawTokens: 1,
          transactionCount: 1,
          cancelledCount: 1,
        },
      },
    ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS });

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { buckets },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          granularity,
          timezone,
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Trends error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// REQ-003: GET /models — Per-model breakdown
// ---------------------------------------------------------------------------

router.get('/models', async (req, res) => {
  auditLog(req, '/api/admin/usage/models');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const { limit, offset } = parsePagination(req.query);
    const tenantId = req.user?.tenantId;

    const Transaction = mongoose.model('Transaction');
    const txMatch = buildTxMatchStage(startDate, endDate, tenantId);

    const queryStart = Date.now();

    // We need two pipelines: one for the paginated results and one for total count.
    // NOTE (finding 3.3): Count and data run as separate pipelines; concurrent inserts
    // could cause minor inconsistency. Using $facet is not viable here because
    // the count needs a separate $group stage. Accepted per RISK-007.
    const [modelsResult, countResult] = await Promise.all([
      Transaction.aggregate([
        { $match: txMatch },
        {
          $group: {
            _id: '$model',
            totalTokenValue: { $sum: '$tokenValue' },
            promptTokens: {
              $sum: {
                $cond: [
                  { $eq: ['$tokenType', 'prompt'] },
                  { $abs: { $ifNull: ['$rawAmount', 0] } },
                  0,
                ],
              },
            },
            completionTokens: {
              $sum: {
                $cond: [
                  { $eq: ['$tokenType', 'completion'] },
                  { $abs: { $ifNull: ['$rawAmount', 0] } },
                  0,
                ],
              },
            },
            transactionCount: { $sum: 1 },
          },
        },
        { $sort: { totalTokenValue: -1 } },
        { $skip: offset },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            model: '$_id',
            totalTokenValue: 1,
            promptTokens: 1,
            completionTokens: 1,
            transactionCount: 1,
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      Transaction.aggregate([
        { $match: txMatch },
        { $group: { _id: '$model' } },
        { $count: 'total' },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const total = countResult[0]?.total || 0;

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { models: modelsResult },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          pagination: { offset, limit, total },
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Models error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// REQ-004: GET /users — Top users by spend
// ---------------------------------------------------------------------------

router.get('/users', async (req, res) => {
  auditLog(req, '/api/admin/usage/users');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const { limit, offset } = parsePagination(req.query);
    const { search } = searchSchema.parse(req.query);
    const tenantId = req.user?.tenantId;

    const Transaction = mongoose.model('Transaction');
    const txMatch = buildTxMatchStage(startDate, endDate, tenantId);

    const queryStart = Date.now();

    const pipeline = [
      { $match: txMatch },
      {
        $group: {
          _id: '$user',
          totalTokenValue: { $sum: '$tokenValue' },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { totalTokenValue: -1 } },
      // Join to User collection to get name and email
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
    ];

    // Apply search filter after join
    if (search) {
      const searchRegex = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push({
        $match: {
          $or: [
            { 'userInfo.name': { $regex: searchRegex, $options: 'i' } },
            { 'userInfo.email': { $regex: searchRegex, $options: 'i' } },
          ],
        },
      });
    }

    // Count pipeline (same filters but just count)
    const countPipeline = [...pipeline, { $count: 'total' }];

    // Add pagination to the main pipeline
    pipeline.push(
      { $skip: offset },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          userId: { $toString: '$_id' },
          name: { $ifNull: ['$userInfo.name', 'Unknown'] },
          email: { $ifNull: ['$userInfo.email', ''] },
          totalTokenValue: 1,
          transactionCount: 1,
        },
      },
    );

    // NOTE (finding 3.3): Count and data run as separate pipelines.
    // Accepted per RISK-007.
    const [usersResult, countResult] = await Promise.all([
      Transaction.aggregate(pipeline).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      Transaction.aggregate(countPipeline).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const total = countResult[0]?.total || 0;

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { users: usersResult },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          pagination: { offset, limit, total },
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Users error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// REQ-005: GET /users/:userId — Single user detail
// ---------------------------------------------------------------------------

router.get('/users/:userId', async (req, res) => {
  auditLog(req, '/api/admin/usage/users/:userId');
  try {
    const { userId } = userIdParamSchema.parse(req.params);
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const tenantId = req.user?.tenantId;

    const Transaction = mongoose.model('Transaction');
    const Conversation = mongoose.model('Conversation');
    const User = mongoose.model('User');

    const userOid = new mongoose.Types.ObjectId(userId);

    // Check user exists
    const userDoc = await User.findById(userOid).lean();
    if (!userDoc) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    const txMatch = {
      ...buildTxMatchStage(startDate, endDate, tenantId),
      user: userOid,
    };

    const queryStart = Date.now();

    // Run Transaction and Conversation queries separately (EDGE-001)
    const [txAgg, modelBreakdown, convoCount, lastTxAgg] = await Promise.all([
      // Overall spend
      Transaction.aggregate([
        { $match: txMatch },
        {
          $group: {
            _id: null,
            totalTokenValue: { $sum: '$tokenValue' },
            transactionCount: { $sum: 1 },
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      // Per-model breakdown
      Transaction.aggregate([
        { $match: txMatch },
        {
          $group: {
            _id: '$model',
            totalTokenValue: { $sum: '$tokenValue' },
            transactionCount: { $sum: 1 },
          },
        },
        { $sort: { totalTokenValue: -1 } },
        {
          $project: {
            _id: 0,
            model: '$_id',
            totalTokenValue: 1,
            transactionCount: 1,
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      // Conversation count (user is String in Conversation collection)
      Conversation.countDocuments({
        ...buildConvoMatchStage(startDate, endDate, tenantId),
        user: userId.toString(),
      }),
      // Last active date from transactions
      Transaction.aggregate([
        { $match: txMatch },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        { $project: { _id: 0, createdAt: 1 } },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const totalTokenValue = txAgg[0]?.totalTokenValue || 0;
    const transactionCount = txAgg[0]?.transactionCount || 0;
    const lastActiveDate = lastTxAgg[0]?.createdAt
      ? lastTxAgg[0].createdAt.toISOString()
      : null;

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        {
          userId,
          name: userDoc.name || 'Unknown',
          email: userDoc.email || '',
          totalTokenValue,
          transactionCount,
          conversationCount: convoCount,
          lastActiveDate,
          modelBreakdown,
        },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] User detail error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// REQ-006: GET /activity — User activity from Conversation collection
// ---------------------------------------------------------------------------

router.get('/activity', async (req, res) => {
  auditLog(req, '/api/admin/usage/activity');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const { limit, offset } = parsePagination(req.query);
    const { search } = searchSchema.parse(req.query);
    const tenantId = req.user?.tenantId;

    const Conversation = mongoose.model('Conversation');
    const convoMatch = buildConvoMatchStage(startDate, endDate, tenantId);

    // Apply search filter on user ID string
    if (search) {
      const searchRegex = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      convoMatch.user = { $regex: searchRegex, $options: 'i' };
    }

    const queryStart = Date.now();

    const pipeline = [
      { $match: convoMatch },
      {
        $group: {
          _id: '$user',
          conversationCount: { $sum: 1 },
          lastActive: { $max: '$updatedAt' },
          models: { $addToSet: '$model' },
          endpoints: { $addToSet: '$endpoint' },
        },
      },
      { $sort: { conversationCount: -1 } },
    ];

    const countPipeline = [...pipeline, { $count: 'total' }];

    // Cap $addToSet arrays to prevent unbounded growth (finding 3.5)
    const MAX_SET_SIZE = 100;
    pipeline.push(
      { $skip: offset },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          conversationCount: 1,
          lastActive: 1,
          models: { $slice: ['$models', MAX_SET_SIZE] },
          endpoints: { $slice: ['$endpoints', MAX_SET_SIZE] },
        },
      },
    );

    // NOTE (finding 3.3): Count and data run as separate pipelines.
    // Accepted per RISK-007.
    const [usersResult, countResult] = await Promise.all([
      Conversation.aggregate(pipeline).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      Conversation.aggregate(countPipeline).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const total = countResult[0]?.total || 0;

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { users: usersResult },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          pagination: { offset, limit, total },
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Activity error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /guardrail-events — Paginated guardrail events with summary
// ---------------------------------------------------------------------------

router.get('/guardrail-events', async (req, res) => {
  auditLog(req, '/api/admin/usage/guardrail-events');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const { limit, offset } = parsePagination(req.query);
    const tenantId = req.user?.tenantId;

    const GuardrailEvent = mongoose.model('GuardrailEvent');

    // Build base match
    const match = { createdAt: { $gte: startDate, $lte: endDate } };
    if (tenantId) {
      match.tenantId = tenantId;
    }
    if (req.query.guardrailType) {
      match.guardrailType = req.query.guardrailType;
    }
    if (req.query.action) {
      match.action = req.query.action;
    }
    if (req.query.userId) {
      match.user = new mongoose.Types.ObjectId(req.query.userId);
    }

    const queryStart = Date.now();

    const [events, countResult, summaryResult] = await Promise.all([
      // Paginated events with user lookup
      GuardrailEvent.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $skip: offset },
        { $limit: limit },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userInfo',
          },
        },
        { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            user: { $toString: '$user' },
            userName: { $ifNull: ['$userInfo.name', 'Unknown'] },
            userEmail: { $ifNull: ['$userInfo.email', ''] },
            guardrailType: 1,
            action: 1,
            severity: 1,
            details: 1,
            route: 1,
            conversationId: 1,
            messageId: 1,
            createdAt: 1,
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
      // Total count
      GuardrailEvent.countDocuments(match),
      // Summary aggregation
      GuardrailEvent.aggregate([
        { $match: match },
        {
          $facet: {
            byType: [{ $group: { _id: '$guardrailType', count: { $sum: 1 } } }],
            byAction: [{ $group: { _id: '$action', count: { $sum: 1 } } }],
            uniqueUsers: [{ $group: { _id: '$user' } }, { $count: 'count' }],
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const summary = {
      totalEvents: countResult,
      byType: {},
      byAction: {},
      uniqueUsers: 0,
    };

    if (summaryResult[0]) {
      for (const entry of summaryResult[0].byType) {
        summary.byType[entry._id] = entry.count;
      }
      for (const entry of summaryResult[0].byAction) {
        summary.byAction[entry._id] = entry.count;
      }
      summary.uniqueUsers = summaryResult[0].uniqueUsers[0]?.count || 0;
    }

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { events, summary },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          pagination: { offset, limit, total: countResult },
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Guardrail events error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /guardrail-summary — Summary stats for guardrail events (dashboard overview)
// ---------------------------------------------------------------------------

router.get('/guardrail-summary', async (req, res) => {
  auditLog(req, '/api/admin/usage/guardrail-summary');
  try {
    const dateRange = parseDateRange(req.query);
    const { startDate, endDate } = dateRange;
    const tenantId = req.user?.tenantId;

    const GuardrailEvent = mongoose.model('GuardrailEvent');

    const match = { createdAt: { $gte: startDate, $lte: endDate } };
    if (tenantId) {
      match.tenantId = tenantId;
    }
    if (req.query.guardrailType) {
      match.guardrailType = req.query.guardrailType;
    }

    const queryStart = Date.now();

    const [totalCount, summaryResult] = await Promise.all([
      GuardrailEvent.countDocuments(match),
      GuardrailEvent.aggregate([
        { $match: match },
        {
          $facet: {
            byType: [{ $group: { _id: '$guardrailType', count: { $sum: 1 } } }],
            byAction: [{ $group: { _id: '$action', count: { $sum: 1 } } }],
            uniqueUsers: [{ $group: { _id: '$user' } }, { $count: 'count' }],
            bySeverity: [{ $group: { _id: '$severity', count: { $sum: 1 } } }],
          },
        },
      ]).option({ maxTimeMS: AGGREGATION_TIMEOUT_MS }),
    ]);

    const summary = {
      totalEvents: totalCount,
      byType: {},
      byAction: {},
      bySeverity: {},
      uniqueUsers: 0,
    };

    if (summaryResult[0]) {
      for (const entry of summaryResult[0].byType) {
        summary.byType[entry._id] = entry.count;
      }
      for (const entry of summaryResult[0].byAction) {
        summary.byAction[entry._id] = entry.count;
      }
      for (const entry of summaryResult[0].bySeverity) {
        summary.bySeverity[entry._id] = entry.count;
      }
      summary.uniqueUsers = summaryResult[0].uniqueUsers[0]?.count || 0;
    }

    setSlowQueryHeader(res, queryStart);

    return res.json(
      envelope(
        { summary },
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      ),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const timeoutRes = handleTimeoutError(err, res);
    if (timeoutRes) {
      return timeoutRes;
    }
    logger.error('[USAGE_REPORT] Guardrail summary error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /conversation/:conversationId — Admin read-only conversation viewer
// ---------------------------------------------------------------------------

router.get('/conversation/:conversationId', async (req, res) => {
  auditLog(req, '/api/admin/usage/conversation');
  try {
    const { conversationId } = req.params;
    const Conversation = mongoose.model('Conversation');
    const Message = mongoose.model('Message');
    const User = mongoose.model('User');

    // Fetch conversation
    const convo = await Conversation.findOne({ conversationId }).lean();
    if (!convo) {
      return res.status(404).json({ status: 'error', message: 'Conversation not found' });
    }

    // Fetch all messages for this conversation
    const messages = await Message.find({ conversationId })
      .select('-__v')
      .sort({ createdAt: 1 })
      .lean();

    // Fetch conversation owner info
    const owner = await User.findById(convo.user).select('name email username').lean();

    return res.json({
      title: convo.title || 'Untitled',
      conversationId,
      owner: owner
        ? { name: owner.name, email: owner.email, username: owner.username }
        : null,
      createdAt: convo.createdAt,
      updatedAt: convo.updatedAt,
      endpoint: convo.endpoint,
      model: convo.model,
      messages: messages.map((msg) => ({
        messageId: msg.messageId,
        parentMessageId: msg.parentMessageId,
        text: msg.text,
        content: msg.content,
        sender: msg.sender,
        isCreatedByUser: msg.isCreatedByUser,
        model: msg.model,
        endpoint: msg.endpoint,
        createdAt: msg.createdAt,
        error: msg.error,
        unfinished: msg.unfinished,
        attachments: msg.attachments,
        files: msg.files,
      })),
    });
  } catch (err) {
    logger.error('[USAGE_REPORT] Error fetching conversation:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
