import type {
  ExportFile,
  ExportAgent,
  ExportSkill,
  ExportMemory,
  ExportPrompt,
  ExportModels,
  ExportPreset,
  ExportMessage,
  CollectedData,
  ExportProject,
  ExportSkillFile,
  ExportPromptGroup,
  ExportConversation,
} from './types';

/**
 * Loads everything one user owns with owner-scoped queries (SPEC-020 REQ-004/REQ-005).
 * Ownership is enforced in every filter; Mongoose casts `userId` to each path's type
 * (string on conversations/messages/projects/presets, ObjectId everywhere else).
 * Child collections (skill files, prompts) are scoped by their parent ids only.
 */
export async function collectUserData(
  models: ExportModels,
  userId: string,
): Promise<CollectedData> {
  const [
    conversations,
    messages,
    files,
    memories,
    agents,
    skills,
    promptGroups,
    projects,
    presets,
  ] = await Promise.all([
    models.Conversation.find({ user: userId, isTemporary: { $ne: true } })
      .select('conversationId title isArchived tags chatProjectId createdAt updatedAt')
      .sort({ createdAt: 1 })
      .lean<ExportConversation[]>(),
    models.Message.find({ user: userId })
      .select(
        'messageId conversationId parentMessageId sender text isCreatedByUser error quotes content files attachments createdAt',
      )
      .sort({ createdAt: 1 })
      .lean<ExportMessage[]>(),
    models.File.find({ user: userId, context: { $ne: 'avatar' } })
      .select('file_id filename filepath storageKey source createdAt')
      .sort({ createdAt: 1 })
      .lean<ExportFile[]>(),
    models.MemoryEntry.find({ userId })
      .select('value updated_at')
      .sort({ updated_at: 1 })
      .lean<ExportMemory[]>(),
    models.Agent.find({ author: userId })
      .select('id name description instructions model conversation_starters tool_resources')
      .lean<ExportAgent[]>(),
    models.Skill.find({ author: userId })
      .select('name description body frontmatter')
      .lean<ExportSkill[]>(),
    models.PromptGroup.find({ author: userId })
      .select('name oneliner category command productionId')
      .lean<ExportPromptGroup[]>(),
    models.ChatProject.find({ user: userId }).select('name').lean<ExportProject[]>(),
    models.Preset.find({ user: userId })
      .select('title model endpoint promptPrefix instructions')
      .lean<ExportPreset[]>(),
  ]);

  const [skillFiles, prompts] = await Promise.all([
    skills.length === 0
      ? Promise.resolve<ExportSkillFile[]>([])
      : models.SkillFile.find({ skillId: { $in: skills.map((s) => s._id) } })
          .select('skillId relativePath file_id filename filepath storageKey source')
          .lean<ExportSkillFile[]>(),
    promptGroups.length === 0
      ? Promise.resolve<ExportPrompt[]>([])
      : models.Prompt.find({ groupId: { $in: promptGroups.map((g) => g._id) } })
          .select('groupId prompt createdAt')
          .sort({ createdAt: 1 })
          .lean<ExportPrompt[]>(),
  ]);

  const messagesByConversation = new Map<string, ExportMessage[]>();
  for (const message of messages) {
    const list = messagesByConversation.get(message.conversationId);
    if (list) {
      list.push(message);
    } else {
      messagesByConversation.set(message.conversationId, [message]);
    }
  }

  return {
    conversations,
    messagesByConversation,
    files,
    memories,
    agents,
    skills,
    skillFiles,
    promptGroups,
    prompts,
    projects,
    presets,
  };
}
