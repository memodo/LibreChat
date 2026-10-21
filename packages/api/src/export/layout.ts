import type {
  ExportFile,
  MissingFile,
  ExportCounts,
  ArchiveEntry,
  CollectedData,
  MissingReason,
} from './types';
import type { ConversationLinks } from './markdown';
import {
  renderAgent,
  renderSkill,
  formatDate,
  renderPrompts,
  renderPresets,
  renderMemories,
  renderConversation,
} from './markdown';
import { slug, splitFilename, safeRelativePath, PathRegistry } from './paths';
import { splitMessage, chooseArtifacts, artifactExtension } from './artifacts';
import { renderReadme } from './readme';
import { buildThread } from './thread';

export interface Layout {
  entries: ArchiveEntry[];
  counts: ExportCounts;
  missingFiles: MissingFile[];
}

type Placement = ConversationLinks['files'] extends Map<string, infer P> ? P : never;

const conversationDir = (
  isArchived: boolean | undefined,
  projectName: string | undefined,
): string => {
  if (isArchived) {
    return 'conversations/archived';
  }
  return projectName ? `conversations/${slug(projectName)}` : 'conversations';
};

/**
 * Assigns every archive path and renders every text entry (SPEC-020 REQ-006–REQ-020).
 * Each owned file is placed once: first in the folder of an authored agent that lists it,
 * else with the earliest conversation that references it, else under `files/other/`.
 */
export function buildLayout(
  data: CollectedData,
  missing: Map<string, MissingReason>,
  exportedAt: Date,
): Layout {
  const paths = new PathRegistry();
  const stems = new PathRegistry();
  const entries: ArchiveEntry[] = [];
  const missingFiles: MissingFile[] = [];
  const owned = new Map(data.files.map((file) => [file.file_id, file]));
  const placed = new Map<string, Placement>();
  let hasOtherFiles = false;

  const write = (file: ExportFile, dir: string): { name: string; path: string } => {
    const { stem, ext } = splitFilename(file.filename);
    const path = paths.claim(dir, stem, ext);
    entries.push({ kind: 'object', path, object: file });
    return { name: file.filename, path };
  };

  /** The file's single home outside agent folders; missing files are recorded once here. */
  const place = (file: ExportFile, dir: string): Placement => {
    const existing = placed.get(file.file_id);
    if (existing) {
      return existing;
    }
    const reason = missing.get(file.file_id);
    if (reason) {
      const { stem, ext } = splitFilename(file.filename);
      const placement = { name: file.filename, path: null };
      missingFiles.push({ filename: file.filename, location: paths.claim(dir, stem, ext), reason });
      placed.set(file.file_id, placement);
      return placement;
    }
    const placement = write(file, dir);
    placed.set(file.file_id, placement);
    return placement;
  };

  /**
   * Every authored agent folder gets its own copy of each knowledge file it lists, so the
   * folder can be uploaded to a Claude Project as-is (stored, so copies cost no CPU).
   */
  const agents = data.agents.map((agent) => {
    const dir = paths.claim('agents', slug(agent.name || agent.id));
    const fileIds = new Set(
      Object.values(agent.tool_resources ?? {}).flatMap((resource) => resource?.file_ids ?? []),
    );
    const files: Array<{ name: string; path: string }> = [];
    for (const id of fileIds) {
      const file = owned.get(id);
      if (!file) {
        continue;
      }
      const placement = placed.has(id) ? placed.get(id) : place(file, `${dir}/files`);
      if (!placement?.path) {
        continue;
      }
      const inFolder = placement.path.startsWith(`${dir}/`);
      files.push(
        inFolder ? { name: placement.name, path: placement.path } : write(file, `${dir}/files`),
      );
    }
    return { agent, dir, files };
  });

  const conversations = data.conversations.flatMap((conversation) => {
    const messages = data.messagesByConversation.get(conversation.conversationId) ?? [];
    if (messages.length === 0) {
      return [];
    }
    const date = formatDate(conversation.createdAt);
    const title = slug(conversation.title);
    const stem = stems.claim('', date ? `${date}-${title}` : title);
    for (const message of messages) {
      for (const ref of [...(message.files ?? []), ...(message.attachments ?? [])]) {
        const file = ref?.file_id ? owned.get(ref.file_id) : undefined;
        if (file) {
          place(file, `files/${stem}`);
        }
      }
    }
    return [{ conversation, messages, stem }];
  });

  for (const file of data.files) {
    if (!placed.has(file.file_id)) {
      hasOtherFiles = true;
      place(file, 'files/other');
    }
  }

  const projectNames = new Map(data.projects.map((p) => [String(p._id), p.name]));
  const agentNames = new Map(data.agents.map((a) => [a.id, a.name || a.id]));
  let messageCount = 0;
  let artifactCount = 0;

  for (const { conversation, messages, stem } of conversations) {
    const versions = buildThread(messages);
    const mainThread = new Set(versions[0]?.turns.map((m) => m.messageId));
    const segmentsByMessage = new Map(messages.map((m) => [m.messageId, splitMessage(m)]));
    const artifacts = new Map<string, string>();
    for (const [key, artifact] of chooseArtifacts(messages, segmentsByMessage, mainThread)) {
      const path = paths.claim(
        `artifacts/${stem}`,
        slug(artifact.title),
        artifactExtension(artifact),
      );
      artifacts.set(key, path);
      entries.push({ kind: 'text', path, content: `${artifact.body.replace(/\n$/, '')}\n` });
    }

    const projectName = conversation.chatProjectId
      ? projectNames.get(String(conversation.chatProjectId))
      : undefined;
    const path = paths.claim(conversationDir(conversation.isArchived, projectName), stem, '.md');
    entries.push({
      kind: 'text',
      path,
      content: renderConversation({
        conversation,
        versions,
        projectName,
        agentName: conversation.agent_id ? agentNames.get(conversation.agent_id) : undefined,
        segmentsByMessage,
        links: { path, artifacts, files: placed },
      }),
    });
    messageCount += messages.length;
    artifactCount += artifacts.size;
  }

  if (data.memories.length > 0) {
    entries.push({ kind: 'text', path: 'memories.txt', content: renderMemories(data.memories) });
  }

  for (const { agent, dir, files } of agents) {
    const instructionsPath = paths.claim(dir, 'instructions', '.md');
    entries.push({
      kind: 'text',
      path: instructionsPath,
      content: renderAgent(agent, instructionsPath, files),
    });
  }

  for (const skill of data.skills) {
    const dir = paths.claim('skills', slug(skill.name));
    entries.push({
      kind: 'text',
      path: paths.claim(dir, 'SKILL', '.md'),
      content: renderSkill(skill),
    });
    for (const skillFile of data.skillFiles) {
      if (String(skillFile.skillId) !== String(skill._id)) {
        continue;
      }
      const relative = safeRelativePath(skillFile.relativePath).split('/');
      const { stem, ext } = splitFilename(relative[relative.length - 1]);
      const path = paths.claim([dir, ...relative.slice(0, -1)].join('/'), stem, ext);
      const reason = missing.get(skillFile.file_id);
      if (reason) {
        missingFiles.push({ filename: skillFile.relativePath, location: path, reason });
      } else {
        entries.push({ kind: 'object', path, object: skillFile });
      }
    }
  }

  if (data.promptGroups.length > 0) {
    entries.push({
      kind: 'text',
      path: 'prompts.md',
      content: renderPrompts(data.promptGroups, data.prompts),
    });
  }
  if (data.presets.length > 0) {
    entries.push({ kind: 'text', path: 'presets.md', content: renderPresets(data.presets) });
  }

  const counts: ExportCounts = {
    conversations: conversations.length,
    messages: messageCount,
    artifacts: artifactCount,
    files: [...placed.values()].filter((p) => p.path !== null).length,
    missingFiles: missingFiles.length,
    memories: data.memories.length,
    agents: data.agents.length,
    skills: data.skills.length,
    promptGroups: data.promptGroups.length,
    presets: data.presets.length,
  };

  const manifest = {
    exportedAt: exportedAt.toISOString(),
    formatVersion: 1,
    counts,
    missingFiles,
  };

  return {
    entries: [
      {
        kind: 'text',
        path: 'README.md',
        content: renderReadme(counts, hasOtherFiles, formatDate(exportedAt, true)),
      },
      { kind: 'text', path: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      ...entries,
    ],
    counts,
    missingFiles,
  };
}
