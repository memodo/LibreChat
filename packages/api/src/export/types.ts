import type { Types } from 'mongoose';
import type { TMessageContentParts, TPreset } from 'librechat-data-provider';
import type {
  ISkill,
  IAgent,
  IPrompt,
  IMessage,
  ISkillFile,
  IMongoFile,
  IPromptGroup,
  IChatProject,
  createModels,
  IConversation,
  IMemoryEntryLean,
} from '@librechat/data-schemas';

export type MissingReason = 'not_found' | 'unreadable' | 'unsupported_source';

/** The fields needed to locate an object in storage (shared by files and skill files). */
export type StoredObject = Pick<IMongoFile, 'file_id' | 'filepath' | 'storageKey' | 'source'>;

export type ExportModels = Pick<
  ReturnType<typeof createModels>,
  | 'Conversation'
  | 'Message'
  | 'File'
  | 'MemoryEntry'
  | 'Agent'
  | 'Skill'
  | 'SkillFile'
  | 'PromptGroup'
  | 'Prompt'
  | 'ChatProject'
  | 'Preset'
>;

type FileReference = { file_id?: string };

export type ExportMessage = Pick<
  IMessage,
  | 'messageId'
  | 'conversationId'
  | 'parentMessageId'
  | 'sender'
  | 'text'
  | 'isCreatedByUser'
  | 'error'
  | 'quotes'
  | 'createdAt'
> & {
  content?: TMessageContentParts[];
  files?: FileReference[];
  attachments?: FileReference[];
};

export type ExportConversation = Pick<
  IConversation,
  'conversationId' | 'title' | 'isArchived' | 'tags' | 'chatProjectId' | 'createdAt' | 'updatedAt'
>;

export type ExportFile = Pick<
  IMongoFile,
  'file_id' | 'filename' | 'filepath' | 'storageKey' | 'source' | 'createdAt'
>;

export type ExportAgent = Pick<
  IAgent,
  | 'id'
  | 'name'
  | 'description'
  | 'instructions'
  | 'model'
  | 'conversation_starters'
  | 'tool_resources'
>;

export type ExportSkill = Pick<ISkill, 'name' | 'description' | 'body' | 'frontmatter'> & {
  _id: Types.ObjectId;
};

export type ExportSkillFile = Pick<
  ISkillFile,
  'skillId' | 'relativePath' | 'file_id' | 'filename' | 'filepath' | 'storageKey' | 'source'
>;

export type ExportPromptGroup = Pick<
  IPromptGroup,
  'name' | 'oneliner' | 'category' | 'command' | 'productionId'
> & { _id: Types.ObjectId };

export type ExportPrompt = Pick<IPrompt, 'groupId' | 'prompt' | 'createdAt'> & {
  _id: Types.ObjectId;
};

export type ExportProject = Pick<IChatProject, 'name'> & { _id: Types.ObjectId };

export type ExportPreset = Pick<
  TPreset,
  'title' | 'model' | 'endpoint' | 'promptPrefix' | 'instructions'
>;

export type ExportMemory = Pick<IMemoryEntryLean, 'value' | 'updated_at'>;

export interface CollectedData {
  conversations: ExportConversation[];
  messagesByConversation: Map<string, ExportMessage[]>;
  files: ExportFile[];
  memories: ExportMemory[];
  agents: ExportAgent[];
  skills: ExportSkill[];
  skillFiles: ExportSkillFile[];
  promptGroups: ExportPromptGroup[];
  prompts: ExportPrompt[];
  projects: ExportProject[];
  presets: ExportPreset[];
}

export interface ExportCounts {
  conversations: number;
  messages: number;
  artifacts: number;
  files: number;
  missingFiles: number;
  memories: number;
  agents: number;
  skills: number;
  promptGroups: number;
  presets: number;
}

export interface MissingFile {
  filename: string;
  location: string;
  reason: MissingReason;
}

/** One entry of the archive: generated text, or a stored object streamed at zip time. */
export type ArchiveEntry =
  | { kind: 'text'; path: string; content: string }
  | { kind: 'object'; path: string; object: StoredObject };
