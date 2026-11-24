import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  pickFastComputerUseModel,
  type AccountQuota,
  type AgyStatus,
  type AgyStreamEvent,
  type AppSettings,
  type AttachedItem,
  type ChatMessage,
  type ComputerUseStatus,
  type Conversation,
  type ExecutionMode,
  type InteractionRequest,
  type InteractionResponse,
  type OAuthFlowEvent,
  type OpenedDocument,
  type ProjectWorkspace,
  type ReasoningEffort,
  type ScheduledTask,
  type SkillItem
} from '../../../shared/types'
import i18n from '../i18n'
import { buildReplayPrompt } from '../utils/conversationTools'

export type ActiveView = 'chat' | 'skills' | 'customizations' | 'settings'
export type AuxTab = 'doc' | 'files' | 'terminal' | 'tasks'

interface ComposerDraftRequest {
  attachment?: AttachedItem
  promptText?: string
  nonce: number
}

interface AppState {
  initialized: boolean
  agyStatus: AgyStatus | null
  checkingStatus: boolean
  quota: AccountQuota | null
  loadingQuota: boolean
  computerUseStatus: ComputerUseStatus | null
  projects: ProjectWorkspace[]
  activeProjectId: string | null
  conversations: Conversation[]
  activeConversationId: string | null
  streamingConversationIds: Record<string, boolean>
  skills: SkillItem[]
  selectedSkill: SkillItem | null
  settings: AppSettings
  scheduledTasks: ScheduledTask[]
  activeView: ActiveView
  sidebarOpen: boolean

  // Auxiliary Pane (Phase 4: Docs, Excel, Files/Diff, Terminal, Tasks)
  auxOpen: boolean
  auxTab: AuxTab
  auxWidth: number
  openedDocs: OpenedDocument[]
  activeDocPath: string | null
  docLoadingError: string | null
  composerDraftRequest: ComposerDraftRequest | null
  oauthModalOpen: boolean
  oauthEvent: OAuthFlowEvent | null
  pendingInteractions: InteractionRequest[]

  // Actions
  bootstrap: () => Promise<void>
  refreshAgyStatus: () => Promise<void>
  refreshQuota: () => Promise<void>
  refreshComputerUseStatus: () => Promise<void>
  startGoogleOAuth: () => Promise<void>
  closeOAuthModal: () => Promise<void>
  handleOAuthEvent: (evt: OAuthFlowEvent) => void
  enqueueInteraction: (req: InteractionRequest) => void
  respondToInteraction: (res: InteractionResponse) => Promise<void>
  setActiveView: (view: ActiveView) => void
  toggleSidebar: () => void
  toggleAuxPane: () => void
  setAuxOpen: (open: boolean) => void
  setAuxTab: (tab: AuxTab) => void
  setAuxWidth: (width: number) => void
  pickAndAddProject: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  createNewConversation: (skill?: SkillItem | null) => void
  /** Make `projectId` the active project (if it is not already) and open a blank conversation in it. */
  newConversationInProject: (projectId: string) => Promise<void>
  /** Open a conversation; switches the active project when it belongs to another one. */
  selectConversation: (conversationId: string) => void
  deleteConversation: (conversationId: string) => Promise<void>
  setSelectedSkill: (skill: SkillItem | null) => void
  refreshSkills: () => Promise<void>
  importGlobalSkills: () => Promise<{ importedCount?: number; error?: string; canceled?: boolean }>
  removeGlobalSkillSource: (sourceId: string) => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  setScheduledTasks: (tasks: ScheduledTask[]) => void
  openFileInStudio: (filePath: string) => Promise<void>
  openLoadedDocInStudio: (doc: OpenedDocument) => void
  setActiveDocPath: (filePath: string) => void
  setDocLoadingError: (error: string | null) => void
  closeDocTab: (filePath: string) => void
  refreshActiveDoc: () => Promise<void>
  sendFileToChatComposer: (attachment: AttachedItem, promptText?: string) => void
  clearComposerDraftRequest: () => void
  sendMessage: (params: {
    text: string
    attachments?: AttachedItem[]
    modelId?: string
    effort?: ReasoningEffort
    mode?: ExecutionMode
    overrideSkill?: SkillItem | null
  }) => Promise<void>
  abortCurrentConversation: () => Promise<void>
  /** Re-run the answer to the user message at or before `messageId` (Tạo lại / Thử lại). */
  regenerateMessage: (messageId: string) => Promise<void>
  /** Replace a user message's text, drop everything after it and resend (Sửa). */
  editAndResend: (messageId: string, newText: string) => Promise<void>
  renameConversation: (conversationId: string, title: string) => Promise<void>
  handleStreamEvent: (event: AgyStreamEvent) => void
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function deriveTitle(text: string, skill?: SkillItem | null): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (skill && skill.code && skill.code !== '★') {
    const shortText = cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned
    return `[${skill.code}] ${shortText || skill.title}`
  }
  if (!cleaned) return 'Hội thoại mới'
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned
}

/** Marks replies still flagged "streaming" as aborted; returns the same object for untouched conversations. */
export function settleInterruptedTurns(conversations: Conversation[]): Conversation[] {
  return conversations.map((conv) =>
    conv.messages.some((m) => m.status === 'streaming')
      ? {
          ...conv,
          messages: conv.messages.map((m) =>
            m.status === 'streaming' ? { ...m, status: 'aborted' as const } : m
          )
        }
      : conv
  )
}

type StoreSet = (
  partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)
) => void
type StoreGet = () => AppState

interface StartTurnParams {
  conversation: Conversation
  /** Messages kept before the new user turn */
  keptMessages: ChatMessage[]
  userMsg: ChatMessage
  /** What is actually sent to the AI core (may include replayed history) */
  promptText: string
  projectPath: string
  modelId?: string
  effort: ReasoningEffort
  mode: ExecutionMode
  activeSkill: SkillItem | null
  attachments?: AttachedItem[]
}

async function startTurn(set: StoreSet, get: StoreGet, p: StartTurnParams): Promise<void> {
  const state = get()
  const assistantMsgId = generateId()
  const assistantMsg: ChatMessage = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    createdAt: p.userMsg.createdAt + 1,
    toolCalls: [],
    status: 'streaming'
  }

  const updatedConversation: Conversation = {
    ...p.conversation,
    updatedAt: p.userMsg.createdAt,
    messages: [...p.keptMessages, p.userMsg, assistantMsg]
  }

  set((s) => {
    const exists = s.conversations.some((c) => c.id === updatedConversation.id)
    const nextConvs = exists
      ? s.conversations.map((c) => (c.id === updatedConversation.id ? updatedConversation : c))
      : [updatedConversation, ...s.conversations]
    return {
      conversations: nextConvs,
      activeConversationId: updatedConversation.id,
      streamingConversationIds: {
        ...s.streamingConversationIds,
        [updatedConversation.id]: true
      }
    }
  })

  await window.googleAI.saveConversation(updatedConversation)

  const effectiveTurnModelId =
    state.settings.computerUseEnabled && state.settings.fastModelForComputerUse
      ? (pickFastComputerUseModel(state.agyStatus?.models ?? [])?.id ?? p.modelId)
      : p.modelId

  await window.googleAI.sendPrompt({
    conversationId: updatedConversation.id,
    messageId: assistantMsgId,
    projectPath: p.projectPath,
    prompt: p.promptText,
    agyConversationId: updatedConversation.agyConversationId,
    modelId: effectiveTurnModelId,
    effort: p.effort,
    mode: p.mode,
    useSandbox: state.settings.useSandbox,
    computerUseEnabled: state.settings.computerUseEnabled,
    preferVietnameseReplies: state.settings.preferVietnameseReplies,
    agencyProfile: state.settings.agencyProfile,
    globalSkillDirs: (state.settings.globalSkillSources ?? []).map((src) => src.path),
    activeSkill: p.activeSkill,
    attachments: p.attachments
  })
}

/**
 * Drops the user message at `userIdx` and everything after it, then sends
 * `text` as a fresh turn. The AI core's own thread still holds the dropped
 * turns, so a new core thread is started and the kept history is replayed
 * inline in the prompt.
 */
async function rerunFromUserMessage(
  set: StoreSet,
  get: StoreGet,
  conv: Conversation,
  userIdx: number,
  text: string
): Promise<void> {
  const state = get()
  const project = state.projects.find((p) => p.id === conv.projectId)
  if (!project) return
  const original = conv.messages[userIdx]
  const kept = conv.messages.slice(0, userIdx)
  const skill = original.activeSkill
    ? (state.skills.find((s) => s.id === original.activeSkill!.id) ?? null)
    : null
  const now = Date.now()
  const userMsg: ChatMessage = {
    id: generateId(),
    role: 'user',
    content: text,
    createdAt: now,
    attachments: original.attachments,
    activeSkill: original.activeSkill
  }
  await startTurn(set, get, {
    conversation: { ...conv, agyConversationId: undefined },
    keptMessages: kept,
    userMsg,
    promptText: buildReplayPrompt(kept, text),
    projectPath: project.path,
    modelId: conv.modelId || state.settings.defaultModelId || undefined,
    effort: state.settings.effort,
    mode: state.settings.mode,
    activeSkill: skill,
    attachments: original.attachments
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  agyStatus: null,
  checkingStatus: true,
  quota: null,
  loadingQuota: false,
  computerUseStatus: null,
  projects: [],
  activeProjectId: null,
  conversations: [],
  activeConversationId: null,
  streamingConversationIds: {},
  skills: [],
  selectedSkill: null,
  settings: { ...DEFAULT_SETTINGS },
  scheduledTasks: [],
  activeView: 'chat',
  sidebarOpen: true,

  auxOpen: true,
  auxTab: 'doc',
  auxWidth: 500,
  openedDocs: [],
  activeDocPath: null,
  docLoadingError: null,
  composerDraftRequest: null,
  oauthModalOpen: false,
  oauthEvent: null,
  pendingInteractions: [],

  bootstrap: async () => {
    const loaded = await window.googleAI.loadState()
    // Nothing is streaming at startup: a reply left "streaming" means the app closed mid-turn.
    const persisted = { ...loaded, conversations: settleInterruptedTurns(loaded.conversations) }
    for (const conv of persisted.conversations) {
      if (conv !== loaded.conversations.find((c) => c.id === conv.id)) {
        void window.googleAI.saveConversation(conv)
      }
    }
    const activeProject = persisted.projects[0] ?? null
    const projectConversations = activeProject
      ? persisted.conversations.filter((c) => c.projectId === activeProject.id)
      : []

    void i18n.changeLanguage(persisted.settings.language)

    set({
      initialized: true,
      projects: persisted.projects,
      activeProjectId: activeProject?.id ?? null,
      conversations: persisted.conversations,
      activeConversationId: projectConversations[0]?.id ?? null,
      settings: persisted.settings,
      scheduledTasks: persisted.scheduledTasks ?? []
    })

    const skills = await window.googleAI.listSkills(activeProject?.path ?? null)
    set({ skills })

    await Promise.all([get().refreshAgyStatus(), get().refreshComputerUseStatus()])
  },

  refreshAgyStatus: async () => {
    set({ checkingStatus: true })
    try {
      const status = await window.googleAI.checkAgyStatus()
      set({ agyStatus: status, checkingStatus: false })
      if (status.authenticated) {
        void get().refreshQuota()
      } else {
        set({ quota: null })
      }
    } catch {
      set({ checkingStatus: false })
    }
  },

  refreshQuota: async () => {
    set({ loadingQuota: true })
    try {
      const quota = await window.googleAI.fetchQuota()
      set({ quota, loadingQuota: false })
    } catch {
      set({ loadingQuota: false })
    }
  },

  refreshComputerUseStatus: async () => {
    try {
      const computerUseStatus = await window.googleAI.checkComputerUseStatus()
      set({ computerUseStatus })
    } catch {
      // ignore
    }
  },

  startGoogleOAuth: async () => {
    set({
      oauthModalOpen: true,
      oauthEvent: {
        stage: 'started',
        message: 'Đang mở trang đăng nhập Google OAuth2...'
      }
    })
    const ok = await window.googleAI.loginAgy()
    if (!ok) {
      set({
        oauthEvent: {
          stage: 'error',
          message: 'Không tìm thấy lõi AI (agy.exe) trên máy.'
        }
      })
    }
  },

  closeOAuthModal: async () => {
    await window.googleAI.cancelOAuth()
    set({ oauthModalOpen: false, oauthEvent: null })
  },

  handleOAuthEvent: (evt) => {
    set({ oauthEvent: evt })
    if (evt.stage === 'success') {
      void get().refreshAgyStatus().then(() => {
        setTimeout(() => {
          set({ oauthModalOpen: false, oauthEvent: null })
        }, 1200)
      })
    }
  },

  enqueueInteraction: (req) => {
    set((s) => ({
      pendingInteractions: [...s.pendingInteractions, req]
    }))
  },

  respondToInteraction: async (res) => {
    await window.googleAI.respondToInteraction(res)
    set((s) => ({
      pendingInteractions: s.pendingInteractions.filter((item) => item.id !== res.id)
    }))
  },

  setActiveView: (view) => set({ activeView: view }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  toggleAuxPane: () => set((s) => ({ auxOpen: !s.auxOpen })),

  setAuxOpen: (open) => set({ auxOpen: open }),

  setAuxTab: (tab) => set({ auxTab: tab, auxOpen: true }),

  setAuxWidth: (width) => set({ auxWidth: Math.max(360, Math.min(900, width)) }),

  pickAndAddProject: async () => {
    const added = await window.googleAI.pickProject()
    if (!added) return
    const skills = await window.googleAI.listSkills(added.path)
    set((s) => {
      const exists = s.projects.some((p) => p.id === added.id)
      const nextProjects = exists
        ? s.projects.map((p) => (p.id === added.id ? added : p))
        : [added, ...s.projects]
      return {
        projects: nextProjects,
        activeProjectId: added.id,
        activeConversationId: null,
        skills,
        selectedSkill: null,
        activeView: 'chat'
      }
    })
  },

  selectProject: async (projectId) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return
    const skills = await window.googleAI.listSkills(project.path)
    if (!get().projects.some((p) => p.id === projectId)) return
    const projectConvs = get().conversations.filter((c) => c.projectId === projectId)
    set({
      activeProjectId: projectId,
      activeConversationId: projectConvs[0]?.id ?? null,
      skills,
      selectedSkill: null,
      activeView: 'chat'
    })
  },

  removeProject: async (projectId) => {
    await window.googleAI.removeProject(projectId)
    const prev = get()
    for (const conv of prev.conversations) {
      if (conv.projectId === projectId && prev.streamingConversationIds[conv.id]) {
        void window.googleAI.abortConversation(conv.id)
      }
    }
    const removingActive = prev.activeProjectId === projectId
    const remaining = prev.projects.filter((p) => p.id !== projectId)
    const nextActiveId = removingActive ? remaining[0]?.id ?? null : prev.activeProjectId
    set((s) => {
      const nextConvs = s.conversations.filter((c) => c.projectId !== projectId)
      const nextStreaming = { ...s.streamingConversationIds }
      for (const c of s.conversations) {
        if (c.projectId === projectId) delete nextStreaming[c.id]
      }
      const activeConvGone =
        s.activeConversationId !== null && !nextConvs.some((c) => c.id === s.activeConversationId)
      const nextActiveConvId =
        removingActive || activeConvGone
          ? (nextConvs.find((c) => c.projectId === nextActiveId)?.id ?? null)
          : s.activeConversationId
      return {
        projects: remaining,
        activeProjectId: nextActiveId,
        conversations: nextConvs,
        streamingConversationIds: nextStreaming,
        scheduledTasks: s.scheduledTasks.filter((t) => t.projectId !== projectId),
        activeConversationId: nextActiveConvId,
        skills: removingActive ? [] : s.skills,
        selectedSkill: removingActive ? null : s.selectedSkill
      }
    })
    if (removingActive) void get().refreshSkills().catch(console.error)
  },

  createNewConversation: (skill) => {
    set({
      activeConversationId: null,
      selectedSkill: skill ?? null,
      activeView: 'chat'
    })
  },

  newConversationInProject: async (projectId) => {
    if (!get().projects.some((p) => p.id === projectId)) return
    if (get().activeProjectId !== projectId) {
      await get().selectProject(projectId)
      // selectProject bails out if the project vanished while its skills were loading.
      if (get().activeProjectId !== projectId) return
    }
    get().createNewConversation(null)
  },

  selectConversation: (conversationId) => {
    const state = get()
    const conv = state.conversations.find((c) => c.id === conversationId)
    const switchProject =
      conv !== undefined &&
      conv.projectId !== state.activeProjectId &&
      state.projects.some((p) => p.id === conv.projectId)
    if (!conv || !switchProject) {
      set({ activeConversationId: conversationId, activeView: 'chat' })
      return
    }
    // A conversation belongs to one project: opening it makes that project active.
    set({
      activeProjectId: conv.projectId,
      activeConversationId: conversationId,
      skills: [],
      selectedSkill: null,
      activeView: 'chat'
    })
    void get().refreshSkills().catch(console.error)
  },

  deleteConversation: async (conversationId) => {
    await window.googleAI.deleteConversation(conversationId)
    set((s) => {
      const nextConvs = s.conversations.filter((c) => c.id !== conversationId)
      const nextActive =
        s.activeConversationId === conversationId
          ? (nextConvs.find((c) => c.projectId === s.activeProjectId)?.id ?? null)
          : s.activeConversationId
      return {
        conversations: nextConvs,
        activeConversationId: nextActive
      }
    })
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  refreshSkills: async () => {
    const state = get()
    const activeProject = state.projects.find((p) => p.id === state.activeProjectId)
    const skills = await window.googleAI.listSkills(activeProject?.path ?? null)
    if (get().activeProjectId === state.activeProjectId) set({ skills })
  },

  importGlobalSkills: async () => {
    const res = await window.googleAI.importGlobalSkillFolder()
    if (res.canceled || res.error) return res
    if (res.sources) {
      set((s) => ({
        settings: { ...s.settings, globalSkillSources: res.sources }
      }))
    }
    await get().refreshSkills()
    return res
  },

  removeGlobalSkillSource: async (sourceId) => {
    const nextSources = await window.googleAI.removeGlobalSkillSource(sourceId)
    set((s) => ({
      settings: { ...s.settings, globalSkillSources: nextSources }
    }))
    await get().refreshSkills()
  },

  updateSettings: async (partial) => {
    const updated = await window.googleAI.updateSettings(partial)
    if (partial.language) {
      void i18n.changeLanguage(partial.language)
    }
    set({ settings: updated })
  },

  setScheduledTasks: (tasks) => set({ scheduledTasks: tasks }),

  openFileInStudio: async (filePath) => {
    set({ docLoadingError: null, auxOpen: true, auxTab: 'doc' })
    try {
      const doc = await window.googleAI.openDocument(filePath)
      get().openLoadedDocInStudio(doc)
    } catch (err) {
      set({
        docLoadingError: err instanceof Error ? err.message : 'Không thể mở tệp.'
      })
    }
  },

  openLoadedDocInStudio: (doc) => {
    set((s) => {
      const idx = s.openedDocs.findIndex(
        (d) => d.path.toLowerCase() === doc.path.toLowerCase()
      )
      const nextDocs =
        idx >= 0
          ? s.openedDocs.map((d, i) => (i === idx ? doc : d))
          : [...s.openedDocs, doc]
      return {
        openedDocs: nextDocs,
        activeDocPath: doc.path,
        auxOpen: true,
        auxTab: 'doc',
        docLoadingError: null
      }
    })
  },

  setActiveDocPath: (filePath) => set({ activeDocPath: filePath, auxOpen: true, auxTab: 'doc' }),

  setDocLoadingError: (error) => set({ docLoadingError: error }),

  closeDocTab: (filePath) => {
    set((s) => {
      const nextDocs = s.openedDocs.filter((d) => d.path !== filePath)
      const nextActive =
        s.activeDocPath === filePath
          ? (nextDocs[nextDocs.length - 1]?.path ?? null)
          : s.activeDocPath
      return {
        openedDocs: nextDocs,
        activeDocPath: nextActive
      }
    })
  },

  refreshActiveDoc: async () => {
    const path = get().activeDocPath
    if (!path) return
    await get().openFileInStudio(path)
  },

  sendFileToChatComposer: (attachment, promptText) => {
    set({
      activeView: 'chat',
      composerDraftRequest: {
        attachment,
        promptText,
        nonce: Date.now()
      }
    })
  },

  clearComposerDraftRequest: () => set({ composerDraftRequest: null }),

  sendMessage: async ({ text, attachments, modelId, effort, mode, overrideSkill }) => {
    const state = get()
    const existing = state.conversations.find((c) => c.id === state.activeConversationId)
    // An existing conversation always runs in its own project's folder.
    const project = state.projects.find((p) => p.id === (existing?.projectId ?? state.activeProjectId))
    if (!project) return

    const trimmed = text.trim()
    if (!trimmed) return

    const activeSkill = overrideSkill !== undefined ? overrideSkill : state.selectedSkill
    const effectiveModel = modelId || state.settings.defaultModelId || undefined
    const effectiveEffort = effort || state.settings.effort
    const effectiveMode = mode || state.settings.mode

    let conversation = existing
    const now = Date.now()

    if (!conversation) {
      conversation = {
        id: generateId(),
        projectId: project.id,
        title: deriveTitle(trimmed, activeSkill),
        createdAt: now,
        updatedAt: now,
        modelId: effectiveModel,
        messages: []
      }
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      createdAt: now,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      activeSkill: activeSkill
        ? { id: activeSkill.id, code: activeSkill.code, title: activeSkill.title }
        : undefined
    }

    await startTurn(set, get, {
      conversation: {
        ...conversation,
        modelId: effectiveModel ?? conversation.modelId
      },
      keptMessages: conversation.messages,
      userMsg,
      promptText: trimmed,
      projectPath: project.path,
      modelId: effectiveModel,
      effort: effectiveEffort,
      mode: effectiveMode,
      activeSkill,
      attachments
    })
  },

  abortCurrentConversation: async () => {
    const convId = get().activeConversationId
    if (!convId) return
    await window.googleAI.abortConversation(convId)

    set((s) => {
      const nextConvs = s.conversations.map((conv) => {
        if (conv.id !== convId) return conv
        const messages = conv.messages.map((msg) =>
          msg.status === 'streaming'
            ? {
                ...msg,
                status: 'aborted' as const
              }
            : msg
        )
        const updated = { ...conv, messages, updatedAt: Date.now() }
        void window.googleAI.saveConversation(updated)
        return updated
      })

      const nextStreaming = { ...s.streamingConversationIds }
      delete nextStreaming[convId]

      return {
        conversations: nextConvs,
        streamingConversationIds: nextStreaming
      }
    })
  },

  regenerateMessage: async (messageId) => {
    const state = get()
    const conv = state.conversations.find((c) => c.id === state.activeConversationId)
    if (!conv || state.streamingConversationIds[conv.id]) return
    const idx = conv.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    // Walk back to the user message that produced this answer.
    let userIdx = idx
    while (userIdx >= 0 && conv.messages[userIdx].role !== 'user') userIdx--
    if (userIdx < 0) return
    await rerunFromUserMessage(set, get, conv, userIdx, conv.messages[userIdx].content)
  },

  editAndResend: async (messageId, newText) => {
    const state = get()
    const conv = state.conversations.find((c) => c.id === state.activeConversationId)
    if (!conv || state.streamingConversationIds[conv.id]) return
    const idx = conv.messages.findIndex((m) => m.id === messageId && m.role === 'user')
    if (idx === -1 || !newText.trim()) return
    await rerunFromUserMessage(set, get, conv, idx, newText.trim())
  },

  renameConversation: async (conversationId, title) => {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120)
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (!conv || !clean || clean === conv.title) return
    const updated: Conversation = { ...conv, title: clean }
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === conversationId ? updated : c))
    }))
    await window.googleAI.saveConversation(updated)
  },

  handleStreamEvent: (event) => {
    set((s) => {
      const convIndex = s.conversations.findIndex((c) => c.id === event.conversationId)
      if (convIndex === -1) return s

      const conv = s.conversations[convIndex]
      let updatedConv: Conversation = conv
      let finished = false

      if (event.type === 'init') {
        updatedConv = {
          ...conv,
          agyConversationId: event.agyConversationId || conv.agyConversationId
        }
      } else {
        const nextMessages = conv.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg

          switch (event.type) {
            case 'text_delta':
              return {
                ...msg,
                content: msg.content + event.delta
              }

            case 'thinking_done':
              return {
                ...msg,
                thinkingSeconds: (msg.thinkingSeconds ?? 0) + (event.durationSeconds ?? 0),
                thinkingTokens: (msg.thinkingTokens ?? 0) + (event.thinkingTokens ?? 0)
              }

            case 'tool_update': {
              const existing = msg.toolCalls ?? []
              const idx = existing.findIndex((t) => t.stepIndex === event.toolCall.stepIndex)
              const nextTools =
                idx >= 0
                  ? existing.map((t, i) => (i === idx ? { ...t, ...event.toolCall } : t))
                  : [...existing, event.toolCall]
              return {
                ...msg,
                toolCalls: nextTools
              }
            }

            case 'result': {
              finished = true
              const finalContent =
                msg.content.trim().length > 0 ? msg.content : (event.response ?? msg.content)
              return {
                ...msg,
                content: finalContent,
                usage: event.usage ?? msg.usage,
                status: 'done' as const
              }
            }

            case 'error':
              finished = true
              return {
                ...msg,
                status: 'error' as const,
                error: event.error
              }

            case 'aborted':
              finished = true
              return {
                ...msg,
                status: 'aborted' as const
              }

            default:
              return msg
          }
        })

        updatedConv = {
          ...conv,
          agyConversationId:
            event.type === 'result' && event.agyConversationId
              ? event.agyConversationId
              : conv.agyConversationId,
          updatedAt: Date.now(),
          messages: nextMessages
        }
      }

      const nextConvs = s.conversations.map((c, idx) => (idx === convIndex ? updatedConv : c))

      const nextStreaming = { ...s.streamingConversationIds }
      if (finished) {
        delete nextStreaming[event.conversationId]
        void window.googleAI.saveConversation(updatedConv)
      }

      return {
        conversations: nextConvs,
        streamingConversationIds: nextStreaming
      }
    })
  }
}))
