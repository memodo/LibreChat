/**
 * Tests for backlinkGuardrailEvent (ResumableAgentController).
 *
 * The PII middleware creates a GuardrailEvent keyed on the client placeholder
 * (req.body.messageId) before the controller mints the real persisted messageId.
 * backlinkGuardrailEvent must rewrite the event with the real messageId /
 * conversationId so conv-log's guardrail_events_log has a valid join key.
 *
 * Uses a real in-memory MongoDB and the real GuardrailEvent schema — only the
 * controller's unrelated heavy dependencies are mocked out.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  sendEvent: jest.fn(),
  getViolationInfo: jest.fn(),
  buildMessageFiles: jest.fn(),
  GenerationJobManager: {},
  decrementPendingRequest: jest.fn(),
  sanitizeMessageForTransmit: jest.fn((m) => m),
  checkAndIncrementPendingRequest: jest.fn(),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: null,
  requestDataMap: new WeakMap(),
}));

jest.mock('~/server/middleware', () => ({ handleAbortError: jest.fn() }));
jest.mock('~/cache', () => ({ logViolation: jest.fn() }));
jest.mock('~/models', () => ({ saveMessage: jest.fn() }));

const { createModels } = jest.requireActual('@librechat/data-schemas');
const { backlinkGuardrailEvent } = require('~/server/controllers/agents/request');

let mongoServer;
let GuardrailEvent;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  GuardrailEvent = mongoose.model('GuardrailEvent');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const createEvent = (overrides = {}) =>
  GuardrailEvent.create({
    user: new mongoose.Types.ObjectId(),
    guardrailType: 'pii',
    action: 'warn',
    severity: 'medium',
    route: 'agent',
    details: { entityTypes: ['PERSON'], entityCount: 1 },
    ...overrides,
  });

describe('backlinkGuardrailEvent', () => {
  it('rewrites placeholder messageId with the real messageId and conversationId', async () => {
    const placeholder = 'client-placeholder-uuid';
    const realId = 'server-persisted-uuid';
    await createEvent({ messageId: placeholder });

    await backlinkGuardrailEvent(placeholder, { messageId: realId, conversationId: 'conv-1' });

    const byReal = await GuardrailEvent.findOne({ messageId: realId }).lean();
    expect(byReal).not.toBeNull();
    expect(byReal.conversationId).toBe('conv-1');

    const byPlaceholder = await GuardrailEvent.findOne({ messageId: placeholder }).lean();
    expect(byPlaceholder).toBeNull();
  });

  it('sets only conversationId when that is the sole update (early back-link)', async () => {
    const placeholder = 'client-placeholder-2';
    await createEvent({ messageId: placeholder });

    await backlinkGuardrailEvent(placeholder, { conversationId: 'conv-2' });

    const doc = await GuardrailEvent.findOne({ messageId: placeholder }).lean();
    expect(doc.conversationId).toBe('conv-2');
    expect(doc.messageId).toBe(placeholder);
  });

  it('is a no-op when the placeholder messageId is missing', async () => {
    await createEvent({ messageId: 'untouched' });

    await expect(
      backlinkGuardrailEvent(undefined, { conversationId: 'x' }),
    ).resolves.toBeUndefined();

    const doc = await GuardrailEvent.findOne({ messageId: 'untouched' }).lean();
    expect(doc.conversationId).toBeUndefined();
  });

  it('does not throw and changes nothing when no event matches', async () => {
    // The returned promise resolves after the first attempt; any scheduled retries
    // are fire-and-forget no-ops against the empty match set.
    await expect(
      backlinkGuardrailEvent('no-such-placeholder', { messageId: 'r', conversationId: 'c' }),
    ).resolves.toBeUndefined();
    expect(await GuardrailEvent.countDocuments({})).toBe(0);
  });
});
