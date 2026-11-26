import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountQuota,
  AgyStatus,
  AgyStreamEvent,
  AiWorkDirInfo,
  AntigravityCustomizations,
  AppSettings,
  ComputerUseStatus,
  Conversation,
  DesktopWindowItem,
  ExcelSheetData,
  GitFileChange,
  GlobalSkillSource,
  InteractionRequest,
  InteractionResponse,
  OAuthFlowEvent,
  OpenedDocument,
  PersistedState,
  ProjectWorkspace,
  ScheduledTask,
  SendPromptPayload,
  SkillItem,
  StorageSecurityStatus,
  TerminalOutputEvent,
  UpdateState,
  WorkspaceEntry
} from '../shared/types'

const googleAIApi = {
  // Core Antigravity (agy)
  checkAgyStatus: (): Promise<AgyStatus> => ipcRenderer.invoke('agy:status'),
  fetchQuota: (): Promise<AccountQuota | null> => ipcRenderer.invoke('agy:quota'),
  checkComputerUseStatus: (): Promise<ComputerUseStatus> =>
    ipcRenderer.invoke('computerUse:status'),
  listDesktopWindows: (): Promise<DesktopWindowItem[]> =>
    ipcRenderer.invoke('computerUse:windows'),
  respondToInteraction: (response: InteractionResponse): Promise<boolean> =>
    ipcRenderer.invoke('interaction:respond', response),
  resetSessionApprovals: (): Promise<boolean> =>
    ipcRenderer.invoke('interaction:resetApprovals'),
  onInteractionRequest: (callback: (req: InteractionRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: InteractionRequest): void => {
      callback(data)
    }
    ipcRenderer.on('interaction:request', listener)
    return () => {
      ipcRenderer.removeListener('interaction:request', listener)
    }
  },
  installAgy: (): Promise<boolean> => ipcRenderer.invoke('agy:install'),
  loginAgy: (): Promise<boolean> => ipcRenderer.invoke('agy:login'),
  submitOAuthCode: (code: string): Promise<boolean> =>
    ipcRenderer.invoke('agy:oauthSubmit', code),
  cancelOAuth: (): Promise<boolean> => ipcRenderer.invoke('agy:oauthCancel'),
  openExternalUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('agy:openExternalUrl', url),
  registerInAppBrowser: (webContentsId: number | null): Promise<boolean> =>
    ipcRenderer.invoke('browser:register', webContentsId),
  onBrowserOpen: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string): void => {
      callback(url)
    }
    ipcRenderer.on('browser:open', listener)
    return () => {
      ipcRenderer.removeListener('browser:open', listener)
    }
  },
  onOAuthEvent: (callback: (event: OAuthFlowEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: OAuthFlowEvent): void => {
      callback(data)
    }
    ipcRenderer.on('agy:oauthEvent', listener)
    return () => {
      ipcRenderer.removeListener('agy:oauthEvent', listener)
    }
  },
  sendPrompt: (payload: SendPromptPayload): Promise<boolean> =>
    ipcRenderer.invoke('agy:send', payload),
  abortConversation: (conversationId: string): Promise<boolean> =>
    ipcRenderer.invoke('agy:abort', conversationId),
  onStreamEvent: (callback: (event: AgyStreamEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AgyStreamEvent): void => {
      callback(data)
    }
    ipcRenderer.on('agy:stream', listener)
    return () => {
      ipcRenderer.removeListener('agy:stream', listener)
    }
  },

  // State & Projects
  loadState: (): Promise<PersistedState> => ipcRenderer.invoke('state:load'),
  pickProject: (): Promise<ProjectWorkspace | null> => ipcRenderer.invoke('project:pick'),
  addProjectPath: (folderPath: string): Promise<ProjectWorkspace> =>
    ipcRenderer.invoke('project:addPath', folderPath),
  removeProject: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('project:remove', projectId),
  saveConversation: (conversation: Conversation): Promise<boolean> =>
    ipcRenderer.invoke('conversation:save', conversation),
  deleteConversation: (conversationId: string): Promise<boolean> =>
    ipcRenderer.invoke('conversation:delete', conversationId),
  updateSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', partial),

  // Data protection & accountability
  clearAllHistory: (): Promise<number> => ipcRenderer.invoke('history:clearAll'),
  getSecurityStatus: (): Promise<StorageSecurityStatus> => ipcRenderer.invoke('security:status'),
  exportAuditLogXlsx: (): Promise<{ path: string; rows: number; unreadable: number } | null> =>
    ipcRenderer.invoke('audit:exportXlsx'),

  // App updates (GitHub Releases)
  getUpdateState: (): Promise<UpdateState | null> => ipcRenderer.invoke('update:getState'),
  checkForUpdates: (): Promise<UpdateState | null> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<UpdateState | null> => ipcRenderer.invoke('update:install'),
  skipUpdateVersion: (version: string): Promise<UpdateState | null> =>
    ipcRenderer.invoke('update:skip', version),
  setAutoUpdateCheck: (enabled: boolean): Promise<UpdateState | null> =>
    ipcRenderer.invoke('update:setAutoCheck', enabled),
  onUpdateState: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: UpdateState): void => {
      callback(data)
    }
    ipcRenderer.on('update:state', listener)
    return () => {
      ipcRenderer.removeListener('update:state', listener)
    }
  },

  // Workspace & Skills
  listSkills: (projectPath?: string | null): Promise<SkillItem[]> =>
    ipcRenderer.invoke('skills:list', projectPath),
  importGlobalSkillFolder: (): Promise<{
    canceled: boolean
    sources?: GlobalSkillSource[]
    importedCount?: number
    error?: string
  }> => ipcRenderer.invoke('skills:importGlobal'),
  removeGlobalSkillSource: (sourceId: string): Promise<GlobalSkillSource[]> =>
    ipcRenderer.invoke('skills:removeGlobal', sourceId),
  readSkillSop: (projectPath: string, sopPathOrFull: string): Promise<string> =>
    ipcRenderer.invoke('skills:readSop', projectPath, sopPathOrFull),
  searchWorkspace: (projectPath: string, query: string): Promise<WorkspaceEntry[]> =>
    ipcRenderer.invoke('workspace:search', projectPath, query),
  pickFiles: (projectPath?: string): Promise<string[]> =>
    ipcRenderer.invoke('workspace:pickFiles', projectPath),
  openPath: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke('workspace:openPath', targetPath),
  revealInExplorer: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke('workspace:revealInExplorer', targetPath),

  // Phase 4: Document, Word & Excel Studio
  openDocument: (filePath: string): Promise<OpenedDocument> =>
    ipcRenderer.invoke('doc:open', filePath),
  pickOpenDocument: (defaultDir?: string): Promise<OpenedDocument[]> =>
    ipcRenderer.invoke('doc:pickOpen', defaultDir),
  saveTextDocument: (filePath: string, content: string): Promise<{ mtimeMs: number }> =>
    ipcRenderer.invoke('doc:saveText', filePath, content),
  saveExcelDocument: (
    filePath: string,
    sheets: ExcelSheetData[]
  ): Promise<{ mtimeMs: number }> => ipcRenderer.invoke('doc:saveExcel', filePath, sheets),
  exportDocx: (
    defaultName: string,
    defaultDir: string,
    markdownText: string
  ): Promise<{ path: string; mtimeMs: number } | null> =>
    ipcRenderer.invoke('doc:exportDocx', defaultName, defaultDir, markdownText),
  /** Lưu văn bản thành .docx trong thư mục dự án (không hỏi hộp thoại), trả về đường dẫn. */
  saveDraftDocx: (
    projectDir: string,
    title: string,
    markdownText: string,
    subfolder?: string
  ): Promise<{ path: string; mtimeMs: number }> =>
    ipcRenderer.invoke('doc:saveDraftDocx', projectDir, title, markdownText, subfolder),
  createDocument: (
    dirPath: string,
    fileName: string,
    kind: 'markdown' | 'docx' | 'excel'
  ): Promise<OpenedDocument> => ipcRenderer.invoke('doc:create', dirPath, fileName, kind),

  // Phase 4: Git Diff
  getGitChanges: (projectPath: string): Promise<GitFileChange[]> =>
    ipcRenderer.invoke('git:changes', projectPath),
  getGitFileDiff: (projectPath: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke('git:diff', projectPath, relativePath),

  // Phase 4: AI Work Directory
  getAiWorkDir: (projectPath: string): Promise<AiWorkDirInfo> =>
    ipcRenderer.invoke('aiworkdir:info', projectPath),
  pickAiWorkDir: (projectPath: string): Promise<AiWorkDirInfo | null> =>
    ipcRenderer.invoke('aiworkdir:pick', projectPath),

  // Phase 4: Terminal
  runTerminalCommand: (commandId: string, command: string, cwd: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:run', commandId, command, cwd),
  killTerminalCommand: (): Promise<boolean> => ipcRenderer.invoke('terminal:kill'),
  openExternalPowerShell: (cwd: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:openExternal', cwd),
  onTerminalOutput: (callback: (event: TerminalOutputEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: TerminalOutputEvent): void => {
      callback(data)
    }
    ipcRenderer.on('terminal:output', listener)
    return () => {
      ipcRenderer.removeListener('terminal:output', listener)
    }
  },

  // Phase 4: Scheduled Tasks
  upsertScheduledTask: (task: ScheduledTask): Promise<ScheduledTask[]> =>
    ipcRenderer.invoke('scheduler:upsert', task),
  deleteScheduledTask: (taskId: string): Promise<ScheduledTask[]> =>
    ipcRenderer.invoke('scheduler:delete', taskId),
  runScheduledTaskNow: (taskId: string): Promise<boolean> =>
    ipcRenderer.invoke('scheduler:runNow', taskId),
  onScheduledTasksUpdated: (callback: (tasks: ScheduledTask[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ScheduledTask[]): void => {
      callback(data)
    }
    ipcRenderer.on('scheduler:updated', listener)
    return () => {
      ipcRenderer.removeListener('scheduler:updated', listener)
    }
  },

  // Phase 4: Antigravity Customizations Sync
  loadCustomizations: (projectPath?: string): Promise<AntigravityCustomizations> =>
    ipcRenderer.invoke('customizations:load', projectPath),
  saveCustomizationFile: (
    filePath: string,
    content: string,
    validateJson: boolean
  ): Promise<boolean> =>
    ipcRenderer.invoke('customizations:save', filePath, content, validateJson)
}

export type GoogleAIApi = typeof googleAIApi

contextBridge.exposeInMainWorld('googleAI', googleAIApi)
