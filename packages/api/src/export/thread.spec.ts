import { buildThread } from './thread';
import type { ExportMessage } from './types';

let clock = 0;
const msg = (messageId: string, parentMessageId: string | null): ExportMessage => ({
  messageId,
  parentMessageId,
  conversationId: 'c1',
  isCreatedByUser: false,
  text: messageId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)),
});

const ids = (messages: ExportMessage[]) => messages.map((m) => m.messageId);
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

describe('buildThread', () => {
  beforeEach(() => {
    clock = 0;
  });

  it('returns no versions for an empty conversation', () => {
    expect(buildThread([])).toEqual([]);
  });

  it('keeps a linear conversation as one version', () => {
    const versions = buildThread([msg('u1', NO_PARENT), msg('a1', 'u1'), msg('u2', 'a1')]);
    expect(versions).toHaveLength(1);
    expect(ids(versions[0].turns)).toEqual(['u1', 'a1', 'u2']);
    expect(versions[0].firstTurn).toBe(1);
  });

  it('follows the last sibling and lists the regenerated reply as another version', () => {
    const versions = buildThread([
      msg('u1', NO_PARENT),
      msg('a1-old', 'u1'),
      msg('a1-new', 'u1'),
      msg('u2', 'a1-new'),
    ]);
    expect(ids(versions[0].turns)).toEqual(['u1', 'a1-new', 'u2']);
    expect(versions[1]).toMatchObject({ version: 2, from: { version: 1, turn: 1 }, firstTurn: 2 });
    expect(ids(versions[1].turns)).toEqual(['a1-old']);
  });

  it('handles an edited first user turn at the root level', () => {
    const versions = buildThread([
      msg('u1-old', NO_PARENT),
      msg('a1-old', 'u1-old'),
      msg('u1-new', NO_PARENT),
      msg('a1-new', 'u1-new'),
    ]);
    expect(ids(versions[0].turns)).toEqual(['u1-new', 'a1-new']);
    expect(versions[1].from).toEqual({ version: 1, turn: 0 });
    expect(ids(versions[1].turns)).toEqual(['u1-old', 'a1-old']);
  });

  it('emits forks nested inside an alternative depth-first', () => {
    const versions = buildThread([
      msg('u1', NO_PARENT),
      msg('a1-old', 'u1'),
      msg('u2-x', 'a1-old'),
      msg('u2-y', 'a1-old'),
      msg('a1-new', 'u1'),
      msg('a1-third', 'u1'),
    ]);
    expect(versions.map((v) => ids(v.turns))).toEqual([
      ['u1', 'a1-third'],
      ['a1-old', 'u2-y'],
      ['u2-x'],
      ['a1-new'],
    ]);
    expect(versions[2].from).toEqual({ version: 2, turn: 2 });
    expect(versions[3].from).toEqual({ version: 1, turn: 1 });
  });

  it('keeps messages caught in a parent cycle instead of dropping or looping', () => {
    const versions = buildThread([
      msg('r', NO_PARENT),
      msg('x', 'y'),
      msg('y', 'x'),
      msg('self', 'self'),
    ]);
    expect(versions.flatMap((v) => ids(v.turns)).sort()).toEqual(['r', 'self', 'x', 'y']);
    expect(ids(versions[0].turns)).toEqual(['r']);
  });

  it('treats an orphan as a root, so an earlier orphan becomes another version', () => {
    const versions = buildThread([
      msg('orphan', 'missing-parent'),
      msg('u1', NO_PARENT),
      msg('a1', 'u1'),
    ]);
    expect(ids(versions[0].turns)).toEqual(['u1', 'a1']);
    expect(ids(versions[1].turns)).toEqual(['orphan']);
  });
});
