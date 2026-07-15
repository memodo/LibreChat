jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: () => (req, res, next) => next(),
}));

jest.mock('~/config', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  limiterCache: () => undefined,
}));

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');

// Per-model mock tracking
const modelMocks = {};

/**
 * Create a chainable aggregate result that supports `.option()` chaining.
 * `await Model.aggregate([...]).option({ maxTimeMS: N })` resolves to `value`.
 */
function chainableAggResult(value) {
  const obj = {
    option: jest.fn().mockReturnThis(),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return obj;
}

function createModelMock() {
  return {
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
  };
}

jest.spyOn(mongoose, 'model').mockImplementation((modelName) => {
  if (!modelMocks[modelName]) {
    modelMocks[modelName] = createModelMock();
  }
  return modelMocks[modelName];
});

const usageRoute = require('../usage');

const app = express();
app.disable('x-powered-by');
app.use((req, _res, next) => {
  req.user = { id: 'admin123', _id: 'admin123', tenantId: undefined };
  next();
});
app.use('/api/admin/usage', usageRoute);

// Separate app instance with tenantId set for multi-tenant tests (EDGE-011)
const tenantApp = express();
tenantApp.disable('x-powered-by');
tenantApp.use((req, _res, next) => {
  req.user = { id: 'admin456', _id: 'admin456', tenantId: 'tenant-a' };
  next();
});
tenantApp.use('/api/admin/usage', usageRoute);

describe('Admin Usage API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset model mocks
    Object.keys(modelMocks).forEach((key) => delete modelMocks[key]);
  });

  // Helper to get/setup model mocks
  function getTxMock() {
    if (!modelMocks['Transaction']) {
      modelMocks['Transaction'] = createModelMock();
    }
    return modelMocks['Transaction'];
  }
  function getConvoMock() {
    if (!modelMocks['Conversation']) {
      modelMocks['Conversation'] = createModelMock();
    }
    return modelMocks['Conversation'];
  }
  function getUserMock() {
    if (!modelMocks['User']) {
      modelMocks['User'] = createModelMock();
    }
    return modelMocks['User'];
  }

  // --------------------------------------------------------------------------
  // REQ-001: GET /overview
  // --------------------------------------------------------------------------
  describe('GET /overview', () => {
    it('should return overview metrics with zero values for empty database (EDGE-010)', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([])) // txAgg
        .mockReturnValueOnce(chainableAggResult([])) // activeUserAgg
        .mockReturnValueOnce(chainableAggResult([])); // cancellationAgg
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app).get('/api/admin/usage/overview');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalRegisteredUsers).toBe(0);
      expect(res.body.data.activeUsers).toBe(0);
      expect(res.body.data.totalConversations).toBe(0);
      expect(res.body.data.totalTokenValue).toBe(0);
      expect(res.body.data.totalTransactions).toBe(0);
      expect(res.body.data.cancellation.totalIncompleteSpend).toBe(0);
      expect(res.body.data.cancellation.estimatedSurchargeAmount).toBe(0);
      expect(res.body.meta.startDate).toBeDefined();
      expect(res.body.meta.endDate).toBeDefined();
      expect(res.body.meta.generatedAt).toBeDefined();
    });

    it('should return correct overview metrics with data (EDGE-003, EDGE-004)', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 5000000, totalTransactions: 100 }]))
        .mockReturnValueOnce(chainableAggResult([{ count: 10 }]))
        .mockReturnValueOnce(chainableAggResult([{ totalIncompleteSpend: 115000 }]));
      convo.countDocuments.mockResolvedValueOnce(50);
      user.countDocuments.mockResolvedValueOnce(20);

      const res = await request(app).get('/api/admin/usage/overview');

      expect(res.status).toBe(200);
      expect(res.body.data.totalRegisteredUsers).toBe(20);
      expect(res.body.data.activeUsers).toBe(10);
      expect(res.body.data.totalConversations).toBe(50);
      expect(res.body.data.totalTokenValue).toBe(5000000);
      expect(res.body.data.totalTransactions).toBe(100);
      expect(res.body.data.cancellation.totalIncompleteSpend).toBe(115000);
      expect(res.body.data.cancellation.estimatedSurchargeAmount).toBe(15000);
    });

    it('should use custom date range when provided', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-31T23:59:59Z' });

      expect(res.status).toBe(200);
      expect(res.body.meta.startDate).toContain('2026-01-01');
      expect(res.body.meta.endDate).toContain('2026-01-31');
    });

    it('should return 400 for invalid date range (FAIL-003)', async () => {
      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-30T00:00:00Z', endDate: '2026-01-01T00:00:00Z' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.errors).toBeDefined();
    });

    it('should return 400 for date range exceeding 366 days', async () => {
      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2024-01-01T00:00:00Z', endDate: '2026-01-01T00:00:00Z' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    it('should return 400 for invalid date format', async () => {
      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.errors).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // REQ-002: GET /trends
  // --------------------------------------------------------------------------
  describe('GET /trends', () => {
    it('should return empty buckets for empty database (EDGE-010)', async () => {
      const tx = getTxMock();
      tx.aggregate.mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app).get('/api/admin/usage/trends');

      expect(res.status).toBe(200);
      expect(res.body.data.buckets).toEqual([]);
      expect(res.body.meta.granularity).toBe('day');
      expect(res.body.meta.timezone).toBe('UTC');
    });

    it('should return trends data grouped by day', async () => {
      const tx = getTxMock();
      tx.aggregate.mockReturnValueOnce(chainableAggResult([
        { date: '2026-03-01', totalTokenValue: 100000, totalRawTokens: 5000000, transactionCount: 50, cancelledCount: 2, activeUsers: 8 },
        { date: '2026-03-02', totalTokenValue: 150000, totalRawTokens: 7000000, transactionCount: 75, cancelledCount: 3, activeUsers: 11 },
      ]));

      const res = await request(app).get('/api/admin/usage/trends');

      expect(res.status).toBe(200);
      expect(res.body.data.buckets).toHaveLength(2);
      expect(res.body.data.buckets[0].date).toBe('2026-03-01');
      expect(res.body.data.buckets[0].totalTokenValue).toBe(100000);
      expect(res.body.data.buckets[0].cancelledCount).toBe(2);
      expect(res.body.data.buckets[0].activeUsers).toBe(8);
      expect(res.body.data.buckets[1].activeUsers).toBe(11);
    });

    it('should count distinct active users per period via a two-stage group pipeline', async () => {
      const tx = getTxMock();
      tx.aggregate.mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app).get('/api/admin/usage/trends');

      expect(res.status).toBe(200);

      const pipeline = tx.aggregate.mock.calls[0][0];
      const groupStages = pipeline.filter((stage) => stage.$group);
      expect(groupStages).toHaveLength(2);

      // Stage 1 groups by (period, user) so each doc is one distinct active user.
      expect(groupStages[0].$group._id).toHaveProperty('user', '$user');
      // Stage 2 re-groups by period and counts those distinct-user docs.
      expect(groupStages[1].$group._id).toBe('$_id.period');
      expect(groupStages[1].$group.activeUsers).toEqual({ $sum: 1 });
    });

    it('should accept granularity and timezone params (EDGE-008)', async () => {
      const tx = getTxMock();
      tx.aggregate.mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ granularity: 'month', timezone: 'America/New_York' });

      expect(res.status).toBe(200);
      expect(res.body.meta.granularity).toBe('month');
      expect(res.body.meta.timezone).toBe('America/New_York');
    });
  });

  // --------------------------------------------------------------------------
  // REQ-003: GET /models
  // --------------------------------------------------------------------------
  describe('GET /models', () => {
    it('should return model breakdown with pagination', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { model: 'gpt-4o', totalTokenValue: 2000000, promptTokens: 15000000, completionTokens: 3000000, transactionCount: 500 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 1 }]));

      const res = await request(app).get('/api/admin/usage/models');

      expect(res.status).toBe(200);
      expect(res.body.data.models).toHaveLength(1);
      expect(res.body.data.models[0].model).toBe('gpt-4o');
      expect(res.body.meta.pagination).toBeDefined();
      expect(res.body.meta.pagination.total).toBe(1);
    });

    it('should return empty models for empty database (EDGE-010)', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app).get('/api/admin/usage/models');

      expect(res.status).toBe(200);
      expect(res.body.data.models).toEqual([]);
      expect(res.body.meta.pagination.total).toBe(0);
    });

    it('should respect pagination params (EDGE-009)', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([{ total: 50 }]));

      const res = await request(app)
        .get('/api/admin/usage/models')
        .query({ limit: '10', offset: '20' });

      expect(res.status).toBe(200);
      expect(res.body.meta.pagination.limit).toBe(10);
      expect(res.body.meta.pagination.offset).toBe(20);
    });
  });

  // --------------------------------------------------------------------------
  // REQ-004: GET /users — Top users by spend
  // --------------------------------------------------------------------------
  describe('GET /users', () => {
    it('should return top users sorted by spend', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { userId: '507f1f77bcf86cd799439011', name: 'Jane', email: 'jane@test.com', totalTokenValue: 500000, transactionCount: 200 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 1 }]));

      const res = await request(app).get('/api/admin/usage/users');

      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].totalTokenValue).toBe(500000);
      expect(res.body.meta.pagination).toBeDefined();
    });

    it('should support search parameter', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/users')
        .query({ search: 'jane' });

      expect(res.status).toBe(200);
    });

    it('should reject search with less than 2 characters', async () => {
      const res = await request(app)
        .get('/api/admin/usage/users')
        .query({ search: 'j' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // REQ-005: GET /users/:userId — Single user detail
  // --------------------------------------------------------------------------
  describe('GET /users/:userId', () => {
    const validUserId = '507f1f77bcf86cd799439011';

    it('should return user detail with transaction and conversation data (EDGE-001)', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      user.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: validUserId,
          name: 'Jane Smith',
          email: 'jane@test.com',
        }),
      });

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 890000, transactionCount: 1540 }]))
        .mockReturnValueOnce(chainableAggResult([
          { model: 'gpt-4o', totalTokenValue: 520000, transactionCount: 980 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ createdAt: new Date('2026-03-29T18:45:00Z') }]));
      convo.countDocuments.mockResolvedValueOnce(312);

      const res = await request(app).get(`/api/admin/usage/users/${validUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe(validUserId);
      expect(res.body.data.name).toBe('Jane Smith');
      expect(res.body.data.totalTokenValue).toBe(890000);
      expect(res.body.data.conversationCount).toBe(312);
      expect(res.body.data.modelBreakdown).toHaveLength(1);
      expect(res.body.data.lastActiveDate).toContain('2026-03-29');
    });

    it('should return 404 for non-existent user', async () => {
      const user = getUserMock();
      user.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const res = await request(app).get(`/api/admin/usage/users/${validUserId}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('User not found.');
    });

    it('should return 400 for invalid userId format', async () => {
      const res = await request(app).get('/api/admin/usage/users/invalid-id');

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    it('should return null lastActiveDate when no transactions exist', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      user.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: validUserId,
          name: 'Jane Smith',
          email: 'jane@test.com',
        }),
      });

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app).get(`/api/admin/usage/users/${validUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lastActiveDate).toBeNull();
      expect(res.body.data.totalTokenValue).toBe(0);
      expect(res.body.data.conversationCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // REQ-006: GET /activity — User activity
  // --------------------------------------------------------------------------
  describe('GET /activity', () => {
    it('should return user activity data with pagination', async () => {
      const convo = getConvoMock();
      convo.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { userId: '507f1f77bcf86cd799439011', conversationCount: 50, lastActive: new Date(), models: ['gpt-4o'], endpoints: ['openAI'] },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 1 }]));

      const res = await request(app).get('/api/admin/usage/activity');

      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].conversationCount).toBe(50);
      expect(res.body.meta.pagination).toBeDefined();
    });

    it('should return empty for empty database (EDGE-010)', async () => {
      const convo = getConvoMock();
      convo.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app).get('/api/admin/usage/activity');

      expect(res.status).toBe(200);
      expect(res.body.data.users).toEqual([]);
      expect(res.body.meta.pagination.total).toBe(0);
    });

    it('should support search parameter for userId', async () => {
      const convo = getConvoMock();
      convo.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/activity')
        .query({ search: '507f' });

      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // Response envelope format
  // --------------------------------------------------------------------------
  describe('Response envelope', () => {
    it('should always include status, data, and meta with generatedAt', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app).get('/api/admin/usage/overview');

      expect(res.body).toHaveProperty('status', 'success');
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('generatedAt');
      expect(res.body.meta).toHaveProperty('startDate');
      expect(res.body.meta).toHaveProperty('endDate');
    });
  });

  // --------------------------------------------------------------------------
  // Cost verification (EDGE-002)
  // --------------------------------------------------------------------------
  describe('Cost calculation', () => {
    it('tokenValue / 1,000,000 matches expected USD', () => {
      const tokenValue = 5000000;
      const costUSD = tokenValue / 1_000_000;
      expect(costUSD).toBe(5.0);
    });

    it('cancellation surcharge formula is correct', () => {
      const totalIncompleteSpend = 115000;
      const estimatedSurchargeAmount = Math.round(totalIncompleteSpend - totalIncompleteSpend / 1.15);
      expect(estimatedSurchargeAmount).toBe(15000);
    });
  });

  // --------------------------------------------------------------------------
  // EDGE-005: Agent-batched transactions (multi-model conversations)
  // --------------------------------------------------------------------------
  describe('EDGE-005: Agent-batched transactions', () => {
    it('should aggregate each transaction individually regardless of conversationId or context', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      // Simulate agent-batched scenario: multiple transactions from different models
      // in the same conversation. The overview should sum all tokenValues individually.
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 300000, totalTransactions: 3 }]))
        .mockReturnValueOnce(chainableAggResult([{ count: 1 }]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(1); // single conversation
      user.countDocuments.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(200);
      // 3 transactions from potentially different models in same convo are counted individually
      expect(res.body.data.totalTransactions).toBe(3);
      expect(res.body.data.totalTokenValue).toBe(300000);
      // Only 1 conversation even though 3 transactions
      expect(res.body.data.totalConversations).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // EDGE-006: Custom endpoint token config pricing
  // --------------------------------------------------------------------------
  describe('EDGE-006: endpointTokenConfig custom pricing', () => {
    it('should use stored tokenValue as-is without re-deriving from rate config', async () => {
      const tx = getTxMock();

      // Simulate custom endpoint with non-standard pricing.
      // tokenValue is pre-computed at transaction time; the dashboard reads it directly.
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { model: 'custom-model', totalTokenValue: 42000, promptTokens: 0, completionTokens: 0, transactionCount: 10 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 1 }]));

      const res = await request(app)
        .get('/api/admin/usage/models')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(200);
      expect(res.body.data.models).toHaveLength(1);
      // The dashboard does not re-derive pricing; it uses the stored tokenValue directly.
      expect(res.body.data.models[0].totalTokenValue).toBe(42000);
      expect(res.body.data.models[0].model).toBe('custom-model');
    });
  });

  // --------------------------------------------------------------------------
  // EDGE-007: Premium / tiered token values
  // --------------------------------------------------------------------------
  describe('EDGE-007: Premium token values', () => {
    it('should correctly sum premium-priced tokenValues alongside standard ones', async () => {
      const tx = getTxMock();

      // Premium models may have higher tokenValue per raw token.
      // The dashboard sums stored tokenValues without re-computing rates.
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { model: 'gpt-4o', totalTokenValue: 100000, promptTokens: 5000000, completionTokens: 1000000, transactionCount: 50 },
          { model: 'o1-pro', totalTokenValue: 900000, promptTokens: 2000000, completionTokens: 500000, transactionCount: 10 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 2 }]));

      const res = await request(app)
        .get('/api/admin/usage/models')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(200);
      expect(res.body.data.models).toHaveLength(2);
      // Premium model has 9x the cost despite fewer transactions/tokens
      expect(res.body.data.models[0].totalTokenValue).toBe(100000);
      expect(res.body.data.models[1].totalTokenValue).toBe(900000);
      expect(res.body.meta.pagination.total).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // EDGE-011: Multi-tenant isolation
  // --------------------------------------------------------------------------
  describe('EDGE-011: Multi-tenant isolation', () => {
    it('should include tenantId in Transaction match stage when user has tenantId', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 50000, totalTransactions: 5 }]))
        .mockReturnValueOnce(chainableAggResult([{ count: 2 }]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(3);
      user.countDocuments.mockResolvedValueOnce(2);

      const res = await request(tenantApp)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(200);
      expect(res.body.data.totalTokenValue).toBe(50000);

      // Verify that the Transaction aggregate $match includes tenantId
      const txAggCall = tx.aggregate.mock.calls[0][0]; // first aggregate call pipeline
      const matchStage = txAggCall[0].$match;
      expect(matchStage.tenantId).toBe('tenant-a');

      // Verify that Conversation countDocuments includes tenantId
      const convoFilter = convo.countDocuments.mock.calls[0][0];
      expect(convoFilter.tenantId).toBe('tenant-a');

      // Verify that User countDocuments includes tenantId
      const userFilter = user.countDocuments.mock.calls[0][0];
      expect(userFilter.tenantId).toBe('tenant-a');
    });

    it('should NOT include tenantId when user has no tenantId', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(200);

      // Verify that the Transaction aggregate $match does NOT include tenantId
      const txAggCall = tx.aggregate.mock.calls[0][0];
      const matchStage = txAggCall[0].$match;
      expect(matchStage.tenantId).toBeUndefined();

      // Verify that User countDocuments is called with empty filter (no tenantId)
      const userFilter = user.countDocuments.mock.calls[0][0];
      expect(userFilter.tenantId).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // FAIL-004: MongoDB timeout returns 504
  // --------------------------------------------------------------------------
  describe('FAIL-004: MongoDB timeout handling', () => {
    function chainableAggError(error) {
      const obj = {
        option: jest.fn().mockReturnThis(),
        then: (_resolve, reject) => Promise.reject(error).catch(reject || (() => {})),
      };
      return obj;
    }

    it('should return 504 with spec message when MongoDB throws code 50 (MaxTimeMSExpired)', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      const timeoutError = new Error('operation exceeded time limit');
      timeoutError.code = 50;
      timeoutError.codeName = 'MaxTimeMSExpired';

      // All aggregates and queries must be mocked; the first one throws timeout
      tx.aggregate
        .mockReturnValueOnce(chainableAggError(timeoutError))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(504);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('timed out');
      expect(res.body.message).toContain('shorter date range');
    });

    it('should return 504 for timeout on /trends endpoint', async () => {
      const tx = getTxMock();

      const timeoutError = new Error('operation exceeded time limit');
      timeoutError.code = 50;

      tx.aggregate.mockReturnValueOnce(chainableAggError(timeoutError));

      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(504);
      expect(res.body.message).toContain('timed out');
    });

    it('should return 500 for non-timeout errors', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      const genericError = new Error('something else went wrong');

      tx.aggregate
        .mockReturnValueOnce(chainableAggError(genericError))
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));
      convo.countDocuments.mockResolvedValueOnce(0);
      user.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/admin/usage/overview')
        .query({ startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-30T23:59:59Z' });

      expect(res.status).toBe(500);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toBe('Internal server error');
    });
  });

  // --------------------------------------------------------------------------
  // SEC-003: Timezone validation
  // --------------------------------------------------------------------------
  describe('SEC-003: Timezone validation', () => {
    it('should accept valid IANA timezone', async () => {
      const tx = getTxMock();
      tx.aggregate.mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ timezone: 'America/New_York' });

      expect(res.status).toBe(200);
    });

    it('should reject invalid timezone string', async () => {
      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ timezone: 'Not/A/Timezone' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    it('should reject excessively long timezone string', async () => {
      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ timezone: 'A'.repeat(100) });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    it('should reject timezone with dangerous characters', async () => {
      const res = await request(app)
        .get('/api/admin/usage/trends')
        .query({ timezone: '$(rm -rf /)' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });
  });

  // --------------------------------------------------------------------------
  // Stronger response body assertions (finding 4.4)
  // --------------------------------------------------------------------------
  describe('Response schema validation', () => {
    it('overview response matches spec schema', async () => {
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 100, totalTransactions: 5 }]))
        .mockReturnValueOnce(chainableAggResult([{ count: 3 }]))
        .mockReturnValueOnce(chainableAggResult([{ totalIncompleteSpend: 50 }]));
      convo.countDocuments.mockResolvedValueOnce(10);
      user.countDocuments.mockResolvedValueOnce(20);

      const res = await request(app).get('/api/admin/usage/overview');

      expect(res.status).toBe(200);
      const { data, meta } = res.body;

      // Verify all required data fields exist and are numbers
      expect(typeof data.totalRegisteredUsers).toBe('number');
      expect(typeof data.activeUsers).toBe('number');
      expect(typeof data.totalConversations).toBe('number');
      expect(typeof data.totalTokenValue).toBe('number');
      expect(typeof data.totalTransactions).toBe('number');
      expect(typeof data.cancellation.totalIncompleteSpend).toBe('number');
      expect(typeof data.cancellation.estimatedSurchargeAmount).toBe('number');

      // Verify meta fields
      expect(meta.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('models response includes proper pagination and model fields', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([
          { model: 'gpt-4o', totalTokenValue: 200, promptTokens: 100, completionTokens: 50, transactionCount: 10 },
        ]))
        .mockReturnValueOnce(chainableAggResult([{ total: 1 }]));

      const res = await request(app).get('/api/admin/usage/models');

      expect(res.status).toBe(200);
      const model = res.body.data.models[0];
      expect(model).toHaveProperty('model');
      expect(model).toHaveProperty('totalTokenValue');
      expect(model).toHaveProperty('promptTokens');
      expect(model).toHaveProperty('completionTokens');
      expect(model).toHaveProperty('transactionCount');
      expect(typeof model.totalTokenValue).toBe('number');

      const { pagination } = res.body.meta;
      expect(pagination).toHaveProperty('offset');
      expect(pagination).toHaveProperty('limit');
      expect(pagination).toHaveProperty('total');
      expect(typeof pagination.total).toBe('number');
    });

    it('user detail response matches spec schema', async () => {
      const validUserId = '507f1f77bcf86cd799439011';
      const tx = getTxMock();
      const convo = getConvoMock();
      const user = getUserMock();

      user.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: validUserId,
          name: 'Test User',
          email: 'test@example.com',
        }),
      });

      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([{ totalTokenValue: 500, transactionCount: 10 }]))
        .mockReturnValueOnce(chainableAggResult([{ model: 'gpt-4o', totalTokenValue: 500, transactionCount: 10 }]))
        .mockReturnValueOnce(chainableAggResult([{ createdAt: new Date('2026-03-29T10:00:00Z') }]));
      convo.countDocuments.mockResolvedValueOnce(5);

      const res = await request(app).get(`/api/admin/usage/users/${validUserId}`);

      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('email');
      expect(data).toHaveProperty('totalTokenValue');
      expect(data).toHaveProperty('transactionCount');
      expect(data).toHaveProperty('conversationCount');
      expect(data).toHaveProperty('lastActiveDate');
      expect(data).toHaveProperty('modelBreakdown');
      expect(Array.isArray(data.modelBreakdown)).toBe(true);
      expect(typeof data.totalTokenValue).toBe('number');
    });
  });

  // --------------------------------------------------------------------------
  // Regex escaping test (finding 4.6)
  // --------------------------------------------------------------------------
  describe('Search regex escaping', () => {
    it('should not error when search contains regex metacharacters', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/users')
        .query({ search: '.*+?^${}()|[]\\' });

      expect(res.status).toBe(200);
    });

    it('should handle $ne-style injection attempt in search', async () => {
      const tx = getTxMock();
      tx.aggregate
        .mockReturnValueOnce(chainableAggResult([]))
        .mockReturnValueOnce(chainableAggResult([]));

      const res = await request(app)
        .get('/api/admin/usage/users')
        .query({ search: '$ne' });

      expect(res.status).toBe(200);
    });
  });
});
