export interface AgyModel {
  id: string
  name: string
}

/** Chọn mô hình nhanh (loại Flash) nếu tài khoản có hỗ trợ; ưu tiên flash-medium / flash-low. */
export function pickFastComputerUseModel(models: AgyModel[]): AgyModel | null {
  const flashModels = models.filter(
    (m) => /flash/i.test(m.id) || /flash/i.test(m.name)
  )
  if (flashModels.length === 0) return null
  return (
    flashModels.find((m) => /medium/i.test(m.id)) ??
    flashModels.find((m) => /low/i.test(m.id)) ??
    flashModels[0]
  )
}

export interface AccountProfile {
  displayName: string
  email: string
  source: 'oauth' | 'custom' | 'system'
}

export interface QuotaBucket {
  id: string
  name: string
  window: string
  remainingFraction: number
  resetTime?: string
  description?: string
}

export interface QuotaGroup {
  name: string
  description?: string
  buckets: QuotaBucket[]
}

export interface AccountQuota {
  description?: string
  groups: QuotaGroup[]
  fetchedAt: number
}

export interface ComputerUseStatus {
  installed: boolean
  binaryPath: string | null
  binDir: string | null
  version: string | null
  platform: string | null
  accessibilityGranted: boolean
  supportedSurfaces: string[]
  browserAvailable?: boolean
  browserName?: string | null
  error?: string
}

export interface DesktopWindowItem {
  id: string
  app: string
  title: string
}

export interface InteractionRequest {
  id: string
  kind: 'approval' | 'question'
  title: string
  message: string
  toolName?: string
  details?: Record<string, unknown>
  options?: string[]
  allowMultiple?: boolean
  allowAttachments?: boolean
  createdAt: number
}

export interface InteractionResponse {
  id: string
  approved: boolean
  alwaysAllowSession?: boolean
  selectedOptions?: string[]
  contextNote?: string
  attachedFiles?: string[]
}

export interface AgyStatus {
  installed: boolean
  binaryPath: string | null
  version: string | null
  authenticated: boolean
  models: AgyModel[]
  account?: AccountProfile | null
  error?: string
}

export interface OAuthFlowEvent {
  stage: 'started' | 'url' | 'needs_input' | 'success' | 'error' | 'cancelled'
  message?: string
  url?: string
  email?: string
  logLine?: string
}

export type SkillScope = 'global' | 'project'

export interface SkillItem {
  id: string
  code?: string
  name: string
  title: string
  description: string
  category: string
  folder: string
  sopPath: string
  sopFullPath?: string
  rootPath?: string
  scope: SkillScope
  packName?: string
  source: 'router' | 'agents' | 'global'
}

export interface GlobalSkillSource {
  id: string
  name: string
  path: string
  addedAt: number
  skillCount: number
}

export interface ProjectWorkspace {
  id: string
  name: string
  path: string
  lastOpenedAt: number
  hasIndexRouter?: boolean
  hasAgentsSkills?: boolean
  skillCount?: number
}

export interface AttachedItem {
  type: 'file' | 'folder' | 'image'
  path: string
  name: string
}

export interface ToolCallBlock {
  stepIndex: number
  toolName: string
  parameters?: Record<string, unknown>
  output?: string
  state: 'ACTIVE' | 'DONE' | 'ERROR'
  durationSeconds?: number
}

export interface UsageStats {
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cacheReadTokens: number
  totalTokens: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  attachments?: AttachedItem[]
  activeSkill?: {
    id: string
    code?: string
    title: string
  }
  toolCalls?: ToolCallBlock[]
  thinkingSeconds?: number
  thinkingTokens?: number
  usage?: UsageStats
  status?: 'streaming' | 'done' | 'error' | 'aborted'
  error?: string
}

export interface Conversation {
  id: string
  projectId: string
  title: string
  agyConversationId?: string
  createdAt: number
  updatedAt: number
  modelId?: string
  pinned?: boolean
  messages: ChatMessage[]
}

export type ExecutionMode = 'default' | 'plan' | 'accept-edits'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WritingTone = 'formal_admin' | 'concise_executive' | 'detailed_legal'

export interface AgencyRulesProfile {
  enabled: boolean
  parentAgency: string
  agencyName: string
  departmentName: string
  locationName: string
  defaultSignerRole: string
  defaultSignerName: string
  staffName: string
  staffRole: string
  enforceDecree30: boolean
  supportPartyDocs: boolean
  writingTone: WritingTone
  verifyLegalStatus: boolean
  noFabricatedData: boolean
  askBeforeCritical: boolean
  commonLegalRefs: string
  customRules: string
}

export const DEFAULT_AGENCY_PROFILE: AgencyRulesProfile = {
  enabled: true,
  parentAgency: '',
  agencyName: '',
  departmentName: '',
  locationName: '',
  defaultSignerRole: 'CHỦ TỊCH',
  defaultSignerName: '',
  staffName: '',
  staffRole: '',
  enforceDecree30: true,
  supportPartyDocs: true,
  writingTone: 'formal_admin',
  verifyLegalStatus: true,
  noFabricatedData: true,
  askBeforeCritical: true,
  commonLegalRefs: 'Nghị định 30/2020/NĐ-CP',
  customRules: ''
}

export interface AppSettings {
  language: 'vi' | 'en'
  theme: 'dark' | 'light'
  preferVietnameseReplies: boolean
  defaultModelId: string
  effort: ReasoningEffort
  mode: ExecutionMode
  useSandbox: boolean
  computerUseEnabled: boolean
  fastModelForComputerUse?: boolean
  agyPathOverride: string
  accountDisplayName?: string
  accountEmail?: string
  agencyProfile?: AgencyRulesProfile
  globalSkillSources?: GlobalSkillSource[]
  /** Days to keep conversations (0 = keep forever). Pruned on app startup; pinned ones are kept. */
  historyRetentionDays: number
}

/** Data-protection status of the local history file (shown in Settings). */
export interface StorageSecurityStatus {
  encrypted: boolean
  encryptionAvailable: boolean
  /** Writes are suspended because the existing file could not be read/decrypted (file left untouched). */
  writesBlocked: boolean
  loadError?: string
  prunedOnStartup: number
  filePath: string
  auditLogPath: string
}

export interface WorkspaceEntry {
  name: string
  relativePath: string
  fullPath: string
  isDirectory: boolean
}

export interface SendPromptPayload {
  conversationId: string
  messageId: string
  projectPath: string
  prompt: string
  agyConversationId?: string
  modelId?: string
  effort?: ReasoningEffort
  mode?: ExecutionMode
  useSandbox?: boolean
  computerUseEnabled?: boolean
  preferVietnameseReplies?: boolean
  agencyProfile?: AgencyRulesProfile
  globalSkillDirs?: string[]
  activeSkill?: SkillItem | null
  attachments?: AttachedItem[]
}

export type AgyStreamEvent =
  | {
      type: 'init'
      conversationId: string
      messageId: string
      agyConversationId: string
      cwd?: string
      permissionMode?: string
      tools?: string[]
    }
  | {
      type: 'text_delta'
      conversationId: string
      messageId: string
      delta: string
      stepIndex: number
    }
  | {
      type: 'thinking_done'
      conversationId: string
      messageId: string
      stepIndex: number
      durationSeconds?: number
      thinkingTokens?: number
    }
  | {
      type: 'tool_update'
      conversationId: string
      messageId: string
      toolCall: ToolCallBlock
    }
  | {
      type: 'result'
      conversationId: string
      messageId: string
      agyConversationId?: string
      status: string
      response?: string
      durationSeconds?: number
      usage?: UsageStats
    }
  | {
      type: 'error'
      conversationId: string
      messageId: string
      error: string
    }
  | {
      type: 'aborted'
      conversationId: string
      messageId: string
    }

// ---- Phase 4: Document, Excel, Diff, AI WorkDir, Terminal, Scheduler & Customizations ----

export type DocKind = 'markdown' | 'text' | 'json' | 'docx' | 'excel' | 'pdf' | 'image' | 'unknown'

export interface ExcelSheetData {
  name: string
  rows: string[][]
}

export interface OpenedDocument {
  path: string
  name: string
  ext: string
  kind: DocKind
  mtimeMs: number
  sizeBytes: number
  textContent?: string
  htmlPreview?: string
  docxPlainText?: string
  sheets?: ExcelSheetData[]
  dataUrl?: string
  parseError?: string
  warnings?: string[]
}

export interface GitFileChange {
  status: string
  path: string
  fullPath: string
  label: string
}

export interface AiWorkSession {
  name: string
  fullPath: string
  files: WorkspaceEntry[]
}

export interface AiWorkDirInfo {
  configured: boolean
  folderPath: string | null
  rulesFiles: WorkspaceEntry[]
  knowledgeFiles: WorkspaceEntry[]
  sessions: AiWorkSession[]
  error?: string
}

export interface TerminalOutputEvent {
  commandId: string
  stream: 'stdout' | 'stderr' | 'meta'
  data: string
  exitCode?: number
}

export interface ScheduledTask {
  id: string
  name: string
  projectId: string
  projectPath: string
  prompt: string
  intervalMinutes: number
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastOutput?: string
  nextRunAt?: number
}

export interface RuleFileEntry {
  name: string
  path: string
  scope: 'workspace' | 'global'
  exists: boolean
  content: string
}

export interface AntigravityCustomizations {
  cliSettingsPath: string
  cliSettingsExists: boolean
  cliSettingsJson: string
  mcpConfigPath: string
  mcpConfigExists: boolean
  mcpConfigJson: string
  hooksConfigPath: string
  hooksConfigExists: boolean
  hooksConfigJson: string
  rulesFiles: RuleFileEntry[]
}

export interface PersistedState {
  projects: ProjectWorkspace[]
  conversations: Conversation[]
  settings: AppSettings
  scheduledTasks: ScheduledTask[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'vi',
  theme: 'light',
  preferVietnameseReplies: true,
  defaultModelId: '',
  effort: 'medium',
  mode: 'default',
  useSandbox: false,
  computerUseEnabled: false,
  fastModelForComputerUse: false,
  agyPathOverride: '',
  agencyProfile: { ...DEFAULT_AGENCY_PROFILE },
  historyRetentionDays: 90
}
