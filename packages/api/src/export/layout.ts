import type { ConversationLinks } from './markdown';
import type {
  ExportFile,
  MissingFile,
  ExportCounts,
  ArchiveEntry,
  CollectedData,
  MissingReason,
} from './types';
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

  const place = (file: ExportFile, dir: string): void => {
    if (placed.has(file.file_id)) {
      return;
    }
    const { stem, ext } = splitFilename(file.filename);
    const path = paths.claim(dir, stem, ext);
    const reason = missing.get(file.file_id);
    if (reason) {
      missingFiles.push({ filename: file.filename, location: path, reason });
      placed.set(file.file_id, { name: file.filename, path: null });
      return;
    }
    placed.set(file.file_id, { name: file.filename, path });
    entries.push({ kind: 'object', path, object: file });
  };

  const agents = data.agents.map((agent) => {
    const dir = paths.claim('agents', slug(agent.name || agent.id));
    const fileIds = Object.values(agent.tool_resources ?? {}).flatMap(
      (resource) => resource?.file_ids ?? [],
    );
    for (const id of fileIds) {
      const file = owned.get(id);
      if (file) {
        place(file, `${dir}/files`);
      }
    }
    return { agent, dir, fileIds };
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

  for (const { agent, dir, fileIds } of agents) {
    const instructionsPath = paths.claim(dir, 'instructions', '.md');
    const files = [...new Set(fileIds)].flatMap((id) => {
      const file = placed.get(id);
      return file?.path ? [{ name: file.name, path: file.path }] : [];
    });
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
