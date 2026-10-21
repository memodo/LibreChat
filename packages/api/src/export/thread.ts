import type { ExportMessage } from './types';

const ROOT = '\u0000root';

/** One linear reading of a conversation: version 1 is the main thread. */
export interface ThreadVersion {
  version: number;
  /** Where this version branches off: after `turn` of `version` (turn 0 = before the first turn). */
  from?: { version: number; turn: number };
  /** Number of this version's first turn; turns continue the numbering of the branch point. */
  firstTurn: number;
  turns: ExportMessage[];
}

/**
 * Linearizes a message tree (SPEC-020 REQ-006). Messages must be sorted by `createdAt`.
 * At every level, including the root level, the last sibling continues the current version,
 * mirroring the UI default (`MultiMessage.tsx`). Every other sibling starts a new version;
 * versions are emitted depth-first, so forks nested in a version follow it directly.
 * A message whose parent is not in the conversation is treated as a root. Messages no root
 * reaches (corrupt parent cycles) are emitted as extra versions, so nothing is dropped.
 */
export function buildThread(messages: ExportMessage[]): ThreadVersion[] {
  const ids = new Set(messages.map((m) => m.messageId));
  const children = new Map<string, ExportMessage[]>();
  for (const message of messages) {
    const parent = message.parentMessageId;
    const key = parent && ids.has(parent) ? parent : ROOT;
    const siblings = children.get(key);
    if (siblings) {
      siblings.push(message);
    } else {
      children.set(key, [message]);
    }
  }

  const versions: ThreadVersion[] = [];
  const visited = new Set<string>();

  const linearize = (siblings: ExportMessage[], from?: ThreadVersion['from']): void => {
    const current: ThreadVersion = {
      version: versions.length + 1,
      from,
      firstTurn: from ? from.turn + 1 : 1,
      turns: [],
    };
    versions.push(current);

    const forks: Array<{ roots: ExportMessage[]; turn: number }> = [];
    let level = siblings.filter((m) => !visited.has(m.messageId));
    while (level.length > 0) {
      const chosen = level[level.length - 1];
      visited.add(chosen.messageId);
      if (level.length > 1) {
        forks.push({
          roots: level.slice(0, -1),
          turn: current.firstTurn + current.turns.length - 1,
        });
      }
      current.turns.push(chosen);
      level = (children.get(chosen.messageId) ?? []).filter((m) => !visited.has(m.messageId));
    }

    for (const fork of forks) {
      for (const root of fork.roots) {
        if (!visited.has(root.messageId)) {
          linearize([root], { version: current.version, turn: fork.turn });
        }
      }
    }
  };

  const roots = children.get(ROOT) ?? [];
  if (roots.length > 0) {
    linearize(roots);
  }
  for (const message of messages) {
    if (!visited.has(message.messageId)) {
      linearize([message], { version: 1, turn: 0 });
    }
  }
  return versions;
}
