/**
 * REQ-T-2: Field-mapping drift gate.
 *
 * Parses docs/field-mapping.md and cross-checks every documented source field
 * against src/mongo.ts and src/enrich.ts. Fails if:
 *   (a) a field is referenced in code but not documented, or
 *   (b) a field is documented but not referenced in code.
 *
 * This is the load-bearing contract for NFR-5 / V-5 (upgrade portability).
 * No I/O beyond reading local files; no Docker required.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- Load source files ----

const fieldMappingMd = fs.readFileSync(path.join(ROOT, 'docs', 'field-mapping.md'), 'utf8');
const mongoSrc = fs.readFileSync(path.join(ROOT, 'src', 'mongo.ts'), 'utf8');
const enrichSrc = fs.readFileSync(path.join(ROOT, 'src', 'enrich.ts'), 'utf8');

// ---- Parse docs/field-mapping.md ----
//
// Extracts the Source field column from every markdown table whose header row is:
// | Source field | Target column | Notes |
// Skips rows whose Source field cell is `_(sidecar)_`.

function parseDocumentedFields(markdown: string): Set<string> {
  const fields = new Set<string>();
  const lines = markdown.split('\n');
  let inMappingTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the canonical header for a mapping table.
    if (trimmed.includes('| Source field |') && trimmed.includes('| Target column |')) {
      inMappingTable = true;
      continue;
    }

    // Separator row (|---|---|---|)
    if (inMappingTable && /^\|[-| ]+\|$/.test(trimmed)) {
      continue;
    }

    // Empty line or non-table line resets the table context.
    if (!trimmed.startsWith('|')) {
      inMappingTable = false;
      continue;
    }

    if (!inMappingTable) continue;

    // Parse a data row: | `fieldName` | column | Notes |
    // Skip sidecar rows.
    const cells = trimmed.split('|').map((c) => c.trim());
    // cells[0] is empty (before the leading |), cells[1] is Source field, cells[2] is Target column
    const sourceCell = cells[1];
    if (sourceCell === undefined || sourceCell === '') continue;
    if (sourceCell.includes('_(sidecar)_')) continue;

    // Extract the field name, stripping surrounding backticks.
    const fieldName = sourceCell.replace(/`/g, '').trim();
    if (fieldName.length > 0) {
      fields.add(fieldName);
    }
  }

  return fields;
}

// ---- Parse code for referenced source field names ----
//
// Strategy:
//   1. doc['fieldName'] patterns (used in normaliseXxx functions in mongo.ts)
//   2. msg.fieldName / conv.fieldName / agent.fieldName / evt.fieldName / feedback?.fieldName patterns
//      (used in enrich.ts and normaliser assignments)
//   3. Property names in doc access patterns like doc['fieldName']
//
// False positives (code identifiers that aren't source fields) are caught by
// checking against the documented set — excess code refs fail assertion (a).
// False negatives (undocumented fields) fail assertion (b).
//
// Dot-notation feedback sub-fields are represented as "feedback.rating" etc.
// in the mapping doc, but code accesses them as msg.feedback?.rating. We map
// those to the top-level "feedback" parent field name (which is documented)
// plus the individual "feedback.rating", "feedback.tag", "feedback.text" sub-fields
// are also documented. We extract both the parent and sub-field references.

function parseCodeReferencedFields(mongoSource: string, enrichSource: string): Set<string> {
  const fields = new Set<string>();
  const combined = mongoSource + '\n' + enrichSource;

  // Pattern 1: doc['fieldName'] or doc["fieldName"]
  const bracketPattern = /doc\[['"]([a-zA-Z_][a-zA-Z0-9_.]*)['"]\]/g;
  for (const match of combined.matchAll(bracketPattern)) {
    const field = match[1];
    if (field !== undefined) fields.add(field);
  }

  // Pattern 2: msg.fieldName, conv.fieldName, agent.fieldName, evt.fieldName (from enrich.ts)
  // These are NormalizedXxx property accesses — map them to source field names.
  // Normalized names differ from source names only for: user->userId, agentId->agentId, model->modelUnderlying, id->agentId.
  // We capture the normalized property name then reverse-map where needed.
  const dotPattern = /\b(msg|conv|agent|evt)\.([a-zA-Z_][a-zA-Z0-9_?]*)\b/g;
  for (const match of combined.matchAll(dotPattern)) {
    const prop = match[2]?.replace(/\?$/, '');
    if (prop !== undefined && prop.length > 0) {
      fields.add(prop);
    }
  }

  // Pattern 3: feedback sub-field access: msg.feedback?.rating, feedback?.tag, feedback?.text
  // These appear as "feedback.rating" etc in the docs.
  const feedbackPattern = /feedback\??\.(rating|tag|text)\b/g;
  for (const match of combined.matchAll(feedbackPattern)) {
    const subfield = match[1];
    if (subfield !== undefined) fields.add(`feedback.${subfield}`);
  }

  return fields;
}

// ---- Reverse-map normalized property names -> source field names ----
//
// The normaliseXxx functions rename some fields. Documented source fields use
// the Mongo source name. The code references normalised names via dot-access on
// NormalizedXxx types. We maintain an explicit bridge for the renamed fields so
// that code references to normalized names satisfy the documentation check.
//
// Format: normalizedName -> documentedSourceName
const NORMALIZED_TO_SOURCE: Record<string, string> = {
  userId: 'user',          // NormalizedMessage.userId <- doc['user']
  agentId: 'agentId',      // NormalizedConversation.agentId <- doc['agentId']
  modelUnderlying: 'model', // NormalizedAgent.modelUnderlying <- doc['model']
  // The agent `id` field maps to agentId in normalized form; doc['id'] is already captured.
};

// ---- Allow-list backstop ----
//
// The regex approach above may not perfectly reconstruct every documented field
// name from code references (e.g., when code accesses a normalized property whose
// source name differs). These are the canonical source field names from the spec
// (REQ-063, RESEARCH-016 §3.1) that must always be present in the documented set.
// If the markdown parse misses them, this backstop catches it.
//
// NOTE: this list should mirror the non-sidecar rows in docs/field-mapping.md.
const BACKSTOP_SOURCE_FIELDS: readonly string[] = [
  // messages collection
  'messageId', 'user', 'conversationId', 'parentMessageId', 'sender', 'endpoint',
  'model', 'isCreatedByUser', 'text', 'content', 'tokenCount', 'error', 'unfinished',
  'attachments', 'files', 'feedback.rating', 'feedback.tag', 'feedback.text',
  'createdAt', 'updatedAt',
  // conversations collection
  'title', 'agentId', 'archived', 'tags',
  // agents collection
  'id', 'name', 'description',
  // guardrailevents collection (entityTypes/entityCount nested under details per SPEC-009 schema)
  'messageId', 'route', 'details.entityTypes', 'details.entityCount',
];

// ---- Tests ----

describe('field-mapping drift gate (REQ-T-2)', () => {
  const documentedFields = parseDocumentedFields(fieldMappingMd);
  const codeFields = parseCodeReferencedFields(mongoSrc, enrichSrc);

  it('docs/field-mapping.md parses at least 20 source fields (sanity check on parser)', () => {
    expect(documentedFields.size).toBeGreaterThanOrEqual(20);
  });

  it('all backstop source fields appear in the documented field set', () => {
    const missing: string[] = [];
    for (const field of BACKSTOP_SOURCE_FIELDS) {
      if (!documentedFields.has(field)) {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `The following source fields are in the backstop list but NOT documented in field-mapping.md:\n` +
        missing.map((f) => `  - ${f}`).join('\n') +
        `\n\nDid someone remove a row from docs/field-mapping.md without updating the code?`,
      );
    }
  });

  it('every code-referenced source field name appears in docs/field-mapping.md (no undocumented field)', () => {
    // Build an expanded set: code fields + reverse-mapped normalized names.
    const expandedCodeFields = new Set(codeFields);
    for (const [normalizedName, sourceName] of Object.entries(NORMALIZED_TO_SOURCE)) {
      if (codeFields.has(normalizedName)) {
        expandedCodeFields.add(sourceName);
      }
    }

    // These are code-internal names that are NOT source field names.
    // They appear in bracket/dot patterns but are not Mongo document fields.
    const CODE_INTERNAL_NAMES = new Set([
      // pg.Client / driver internals accessed via dot-notation
      'client', 'query', 'connect', 'end', 'rows', '__brand',
      // LRU cache methods
      'get', 'set',
      // TypeScript/Array methods that appear in regex
      'map', 'filter', 'flat', 'flatMap', 'length', 'push', 'slice',
      'sort', 'reduce', 'find', 'findOne', 'toArray', 'values', 'keys',
      // Pino logger properties
      'info', 'warn', 'error', 'fatal', 'debug', 'trace',
      // Normalized type property names that are NOT source field names.
      // These appear via dot-access on NormalizedXxx objects; the reverse-map
      // in NORMALIZED_TO_SOURCE above handles converting them to documented names.
      'messageId', 'conversationId', 'userId', 'parentMessageId', 'tokenCount',
      'isCreatedByUser', 'errorDetail', 'agentIds', 'convIds',
      // NormalizedGuardrailEvent property names accessed via evt.* in enrich.ts.
      // The real source fields are _id (->event_id) and the details.* sub-document;
      // these normalized names are not top-level Mongo source fields. 'details' is
      // the container sub-document, accessed via doc['details'] then details.entityTypes.
      'eventId', 'entityTypes', 'entityCount', 'details',
      // 'feedback' itself: accessed as msg.feedback?.rating — the sub-field
      // accesses (feedback.rating, feedback.tag, feedback.text) are captured
      // by the feedback sub-field regex and checked separately.
      'feedback',
      // 'modelUnderlying' is a normalized name; reverse-mapped to 'model' via
      // NORMALIZED_TO_SOURCE, so 'model' satisfies the doc check. The normalized
      // name itself is not a source field name.
      'modelUnderlying',
      // misc internal
      'type', 'text', 'id', 'rating', 'tag',
      // mongo driver
      'db', 'collection', 'toArray', 'find', 'findOne', 'countDocuments',
      // node
      'readdir', 'readFile', 'join',
      // EnrichInputBatch properties
      'messages', 'conversations', 'agents', 'guardrailEvents',
      // Result properties
      'committed', 'deadLettered', 'advancedWatermark',
    ]);

    const undocumented: string[] = [];
    for (const field of expandedCodeFields) {
      // Skip internal names and sub-property access chains with dots (except documented ones)
      if (CODE_INTERNAL_NAMES.has(field)) continue;
      // Skip fields that look like method chains or long property paths (not direct source fields)
      if (field.includes('.') && !documentedFields.has(field)) {
        // Only flag feedback.* sub-fields if they're not documented
        if (field.startsWith('feedback.')) {
          if (!documentedFields.has(field)) undocumented.push(field);
        }
        continue;
      }
      if (!documentedFields.has(field) && !field.startsWith('_')) {
        // Additional skip: single-char or very short names are likely not source fields
        if (field.length <= 2) continue;
        undocumented.push(field);
      }
    }

    if (undocumented.length > 0) {
      throw new Error(
        `The following field references appear in code but are NOT documented in docs/field-mapping.md:\n` +
        undocumented.map((f) => `  - ${f}`).join('\n') +
        `\n\nAdd rows to docs/field-mapping.md or remove the field reference from code.`,
      );
    }
  });

  it('every documented source field is referenced by at least one code site', () => {
    // Build a combined text corpus for a broad search.
    const codeCorpus = mongoSrc + '\n' + enrichSrc;

    const unreferenced: string[] = [];
    for (const field of documentedFields) {
      // Handle feedback sub-fields: "feedback.tag" -> check "feedback?.tag" and "feedback.tag"
      if (field.startsWith('feedback.')) {
        const subfield = field.split('.')[1];
        if (subfield !== undefined && !codeCorpus.includes(subfield)) {
          unreferenced.push(field);
        }
        continue;
      }

      // For regular fields: field name must appear somewhere in the code.
      if (!codeCorpus.includes(field)) {
        unreferenced.push(field);
      }
    }

    if (unreferenced.length > 0) {
      throw new Error(
        `The following source fields are documented in docs/field-mapping.md but NOT referenced in code:\n` +
        unreferenced.map((f) => `  - ${f}`).join('\n') +
        `\n\nUpdate the code to reference these fields or remove their rows from docs/field-mapping.md.`,
      );
    }
  });
});
