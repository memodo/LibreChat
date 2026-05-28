/**
 * REQ-T-1: enrich.ts pure-function tests.
 *
 * Table-driven unit tests covering all six required cases from SPEC-016 §Testing.
 * No I/O, no Docker, no mocks beyond a no-op logger (unused here).
 */
import { describe, it, expect } from 'vitest';
import { enrich } from '../src/enrich.js';
import type { EnrichedRow } from '../src/enrich.js';
import type { NormalizedMessage, NormalizedConversation, NormalizedAgent, EnrichInputBatch } from '../src/mongo.js';

// ---- Fixture factories ----

const BASE_DATE = new Date('2026-01-15T10:00:00.000Z');
const BASE_DATE2 = new Date('2026-01-15T10:01:00.000Z');
const NOW = new Date('2026-01-15T12:00:00.000Z');
const SCHEMA_VERSION = 1;

function makeRawMessage(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    messageId: 'msg-001',
    conversationId: 'conv-001',
    userId: 'user-001',
    parentMessageId: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE2,
    endpoint: 'openAI',
    sender: 'User',
    text: 'Hello world',
    tokenCount: null,
    isCreatedByUser: true,
    error: false,
    unfinished: false,
    model: null,
    content: null,
    attachments: null,
    files: null,
    feedback: null,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<NormalizedConversation> = {}): NormalizedConversation {
  return {
    conversationId: 'conv-001',
    title: 'Test conversation',
    agentId: null,
    endpoint: 'openAI',
    userId: 'user-001',
    archived: false,
    tags: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE2,
    ...overrides,
  };
}

function makeInputBatch(messages: NormalizedMessage[], conversationOverride?: Partial<NormalizedConversation>): EnrichInputBatch {
  const conv = makeConversation(conversationOverride);
  return {
    messages,
    conversations: new Map([[conv.conversationId, conv]]),
    agents: new Map(),
    guardrailEvents: [],
  };
}

function makeEnrichedRow(overrides: Partial<EnrichedRow>): EnrichedRow {
  return {
    message_id: 'msg-001',
    user_id: 'user-001',
    conversation_id: 'conv-001',
    parent_message_id: null,
    sender: 'User',
    endpoint: 'openAI',
    model_or_agent_id: null,
    is_user: true,
    text: 'Hello world',
    content: null,
    token_count: null,
    error: false,
    unfinished: false,
    has_attachments: false,
    has_files: false,
    feedback_rating: null,
    feedback_tag: null,
    feedback_text: null,
    source_created_at: BASE_DATE,
    source_updated_at: BASE_DATE2,
    schema_version: SCHEMA_VERSION,
    ...overrides,
  };
}

// ---- REQ-058 column set: every key expected in EnrichedRow ----

const EXPECTED_ENRICHED_ROW_KEYS: (keyof EnrichedRow)[] = [
  'message_id',
  'user_id',
  'conversation_id',
  'parent_message_id',
  'sender',
  'endpoint',
  'model_or_agent_id',
  'is_user',
  'text',
  'content',
  'token_count',
  'error',
  'unfinished',
  'has_attachments',
  'has_files',
  'feedback_rating',
  'feedback_tag',
  'feedback_text',
  'source_created_at',
  'source_updated_at',
  'schema_version',
];

function assertEnrichedRowShape(row: EnrichedRow): void {
  for (const key of EXPECTED_ENRICHED_ROW_KEYS) {
    expect(row).toHaveProperty(key);
  }
}

// ---- Test suite ----

describe('enrich() — pure function tests (REQ-T-1)', () => {

  describe('case 1: user message with text only', () => {
    it('produces is_user = true, text from source.text, model_or_agent_id = null, content = null', () => {
      const msg = makeRawMessage({
        isCreatedByUser: true,
        text: 'Hello from user',
        model: null,
        content: null,
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      expect(result.messages).toHaveLength(1);
      const row = result.messages[0]!;

      expect(row.is_user).toBe(true);
      expect(row.text).toBe('Hello from user');
      expect(row.model_or_agent_id).toBeNull();
      expect(row.content).toBeNull();
      assertEnrichedRowShape(row);
    });
  });

  describe('case 2: assistant message with content[] text-only parts', () => {
    it('flattens content[] text parts into messages_log.text joined by newline', () => {
      const contentParts = [
        { type: 'text', text: 'Part one' },
        { type: 'text', text: 'Part two' },
        { type: 'text', text: 'Part three' },
      ];
      const msg = makeRawMessage({
        isCreatedByUser: false,
        content: contentParts,
        model: 'gpt-4',
        sender: 'GPT-4',
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      expect(row.is_user).toBe(false);
      expect(row.text).toBe('Part one\nPart two\nPart three');
      expect(row.content).toEqual(contentParts);
      expect(row.model_or_agent_id).toBe('gpt-4');
      assertEnrichedRowShape(row);
    });
  });

  describe('case 3: assistant message with mixed content[] (text + tool_call + image_url)', () => {
    it('flattens only text parts into text but preserves all parts in content (lossless)', () => {
      const contentParts = [
        { type: 'text', text: 'I will search for you' },
        { type: 'tool_call', id: 'call-001', function: { name: 'search', arguments: '{}' } },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
        { type: 'text', text: 'Here are the results' },
      ];
      const msg = makeRawMessage({
        isCreatedByUser: false,
        content: contentParts,
        model: 'gpt-4',
        text: null,
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      // text excludes non-text parts
      expect(row.text).toBe('I will search for you\nHere are the results');

      // content preserves all parts losslessly
      expect(JSON.stringify(row.content)).toBe(JSON.stringify(contentParts));
      expect(row.content).toHaveLength(4);

      assertEnrichedRowShape(row);
    });
  });

  describe('case 4: user message with attachments and files', () => {
    it('sets has_attachments = true and has_files = true when arrays are non-empty', () => {
      const msg = makeRawMessage({
        isCreatedByUser: true,
        attachments: [{ name: 'doc.pdf', type: 'application/pdf' }],
        files: [{ file_id: 'file-001' }],
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      expect(row.has_attachments).toBe(true);
      expect(row.has_files).toBe(true);
      assertEnrichedRowShape(row);
    });

    it('sets has_attachments = false and has_files = false when arrays are empty', () => {
      const msg = makeRawMessage({
        isCreatedByUser: true,
        attachments: [],
        files: [],
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      expect(row.has_attachments).toBe(false);
      expect(row.has_files).toBe(false);
    });

    it('sets has_attachments = false when attachments is null', () => {
      const msg = makeRawMessage({
        isCreatedByUser: true,
        attachments: null,
        files: null,
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      expect(row.has_attachments).toBe(false);
      expect(row.has_files).toBe(false);
    });
  });

  describe('case 5: message with feedback.tag as string, array, or object', () => {
    it.each([
      ['string tag', { tag: 'helpful' }],
      ['array tag', { tag: ['helpful', 'accurate'] }],
      ['object tag', { tag: { label: 'helpful', confidence: 0.9 } }],
    ])('preserves feedback.tag as JSON-serializable value when tag is a %s', (_label, feedback) => {
      const msg = makeRawMessage({
        feedback: { rating: 'thumbsUp', tag: feedback.tag, text: 'Great response' },
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      // tag is passed through as-is (postgres.ts handles JSONB serialization)
      expect(row.feedback_tag).toEqual(feedback.tag);
      expect(row.feedback_rating).toBe('thumbsUp');
      expect(row.feedback_text).toBe('Great response');
      // Must be JSON-serializable (no circular refs, no undefined)
      expect(() => JSON.stringify(row.feedback_tag)).not.toThrow();
      assertEnrichedRowShape(row);
    });
  });

  describe('case 6: message with NULL model', () => {
    it('produces model_or_agent_id = null and does not throw', () => {
      const msg = makeRawMessage({
        isCreatedByUser: false,
        model: null,
        content: [{ type: 'text', text: 'Response text' }],
      });
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      const row = result.messages[0]!;

      expect(row.model_or_agent_id).toBeNull();
      expect(row.text).toBe('Response text');
      assertEnrichedRowShape(row);
    });
  });

  describe('purity and determinism', () => {
    it('produces deep-equal output when called twice with identical input and fixed opts.now', () => {
      const msg = makeRawMessage({
        isCreatedByUser: false,
        content: [{ type: 'text', text: 'Deterministic' }],
        model: 'gpt-4',
      });
      const conv = makeConversation();
      const batch: EnrichInputBatch = {
        messages: [msg],
        conversations: new Map([[conv.conversationId, conv]]),
        agents: new Map(),
        guardrailEvents: [],
      };

      const opts = { schemaVersion: SCHEMA_VERSION, now: NOW };
      const result1 = enrich(batch, opts);
      const result2 = enrich(batch, opts);

      expect(result1).toEqual(result2);
    });

    it('injects schema_version from opts into every message row', () => {
      const msg = makeRawMessage({});
      const batch = makeInputBatch([msg]);
      const result = enrich(batch, { schemaVersion: 42, now: NOW });

      expect(result.messages[0]!.schema_version).toBe(42);
    });

    it('injects opts.now as dim_updated_at for conversations', () => {
      const msg = makeRawMessage({});
      const batch = makeInputBatch([msg]);
      const fixedNow = new Date('2026-03-01T00:00:00.000Z');
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: fixedNow });

      expect(result.conversations[0]!.dim_updated_at).toEqual(fixedNow);
    });
  });

  describe('EnrichedRow shape completeness (REQ-058 column set)', () => {
    it('all expected column keys are present on every produced row', () => {
      const messages = [
        makeRawMessage({ isCreatedByUser: true }),
        makeRawMessage({ messageId: 'msg-002', isCreatedByUser: false, content: [{ type: 'text', text: 'Hi' }] }),
      ];
      const batch = makeInputBatch(messages);
      const result = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: NOW });

      for (const row of result.messages) {
        assertEnrichedRowShape(row);
      }
    });
  });
});
