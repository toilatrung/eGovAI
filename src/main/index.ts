import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import type {
  AppSettings,
  Conversation,
  ExcelSheetData,
  GlobalSkillSource,
  InteractionResponse,
  ScheduledTask,
  SendPromptPayload
} from '../shared/types'
import { AgyCliAdapter } from './agent/agyAdapter'
import {
  checkAgyStatus,
  fetchAgyQuota,
  getAgyBinaryPath,
  GoogleOAuthManager,
  launchOfficialAgyInstaller
} from './agent/agyBinary'
import { configureAiWorkDir, getAiWorkDirInfo } from './services/aiWorkDirService'
import {
  loadAntigravityCustomizations,
  saveCustomizationFile
} from './services/configSyncService'
import {
  checkComputerUseStatus,
  listDesktopWindows
} from './services/computerUseService'
import { DesktopMcpServer } from './services/desktopMcpServer'
import { InAppBrowserService } from './services/inAppBrowserService'
import { InteractionManager } from './services/interactionManager'
import {
  createBlankDocument,
  exportMarkdownToDocx,
  openDocumentFile,
  saveExcelDocumentFile,
  saveTextDocumentFile
} from './services/documentService'
import { getGitChanges, getGitFileDiff } from './services/gitDiffService'
import { SchedulerService } from './services/schedulerService'
import { checkOpenPathAllowed } from './services/openPathGuard'
import { stat } from 'fs/promises'
import {
  discoverAllSkills,
  discoverSkillsInDirectory,
  syncGlobalSkillsToOfficialDir
} from './services/skillDiscovery'
import { StorageService } from './services/storageService'
import { AgentAuditTracker, AuditLogService } from './services/auditLogService'
import {
  formatClassificationBlockMessage,
  scanAttachmentsForClassification
} from './services/classificationGuard'
import { TerminalService } from './services/terminalService'
import { readSkillPreview, searchWorkspaceEntries } from './services/workspaceService'
import { UpdateService } from './services/updateService'

let mainWindow: BrowserWindow | null = null
let storageService: StorageService
let schedulerService: SchedulerService
let desktopMcpServer: DesktopMcpServer | null = null
let inAppBrowserService: InAppBrowserService | null = null
let interactionManager: InteractionManager | null = null
let auditLog: AuditLogService
let auditTracker: AgentAuditTracker
let updateService: UpdateService | null = null
const agyAdapter = new AgyCliAdapter()
const terminalService = new TerminalService()
const oauthManager = new GoogleOAuthManager()

function applyWindowTheme(win: BrowserWindow, theme: 'dark' | 'light'): void {
  const isLight = theme === 'light'
  nativeTheme.themeSource = isLight ? 'light' : 'dark'
  win.setBackgroundColor(isLight ? '#fafbfc' : '#0f1116')
  if (typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({
      color: isLight ? '#ffffff' : '#161920',
      symbolColor: isLight ? '#5d6678' : '#a0a7b6',
      height: 44
    })
  }
}

function createWindow(): void {
  const initialTheme = storageService.getState().settings.theme
  const isLight = initialTheme === 'light'
  nativeTheme.themeSource = isLight ? 'light' : 'dark'

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1020,
    minHeight: 660,
    title: 'eGovAI',
    backgroundColor: isLight ? '#fafbfc' : '#0f1116',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isLight ? '#ffffff' : '#161920',
      symbolColor: isLight ? '#5d6678' : '#a0a7b6',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // ---- Antigravity Core (agy) ----
  ipcMain.handle('agy:status', async () => {
    const s = storageService.getState().settings
    return await checkAgyStatus(s.agyPathOverride, s.accountDisplayName, s.accountEmail)
  })

  ipcMain.handle('agy:quota', async () => {
    const override = storageService.getState().settings.agyPathOverride
    return await fetchAgyQuota(override)
  })

  // ---- Computer Use (vercel-labs/agent-desktop) ----
  ipcMain.handle('computerUse:status', async () => {
    return await checkComputerUseStatus()
  })

  ipcMain.handle('computerUse:windows', async () => {
    return await listDesktopWindows()
  })

  ipcMain.handle('agy:install', () => {
    launchOfficialAgyInstaller()
    return true
  })

  ipcMain.handle('agy:login', async () => {
    const override = storageService.getState().settings.agyPathOverride
    const binary = await getAgyBinaryPath(override)
    if (!binary) return false
    oauthManager.start(
      binary,
      (evt) => {
        if (evt.stage === 'success' && evt.email) {
          storageService.updateSettings({ accountEmail: evt.email })
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agy:oauthEvent', evt)
        }
      },
      (url) => {
        void shell.openExternal(url)
      }
    )
    return true
  })

  ipcMain.handle('agy:oauthSubmit', (_event, code: string) => {
    return oauthManager.submitInput(code)
  })

  ipcMain.handle('agy:oauthCancel', () => {
    oauthManager.cancel()
    return true
  })

  ipcMain.handle('agy:openExternalUrl', async (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      await shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.handle('browser:register', (_event, webContentsId: number | null) => {
    inAppBrowserService?.registerWebContents(
      typeof webContentsId === 'number' ? webContentsId : null
    )
    return true
  })

  ipcMain.handle('agy:send', async (_event, payload: SendPromptPayload) => {
    // Classified-document gate: never forward state-secret documents to the cloud AI.
    const attachmentPaths = (payload.attachments ?? []).map((a) => a.path).filter(Boolean)
    if (attachmentPaths.length > 0) {
      const scan = await scanAttachmentsForClassification(attachmentPaths)
      if (scan.blocked) {
        auditTracker.classifiedBlocked(payload, scan.hits)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agy:stream', {
            type: 'error',
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            error: formatClassificationBlockMessage(scan.hits)
          })
        }
        return true
      }
    }
    auditTracker.promptSent(payload)
    const override = storageService.getState().settings.agyPathOverride

    // Trước mỗi lượt bật Điều khiển máy: xác minh máy chủ MCP còn sống và agy trỏ đúng cổng/mã xác thực.
    if (payload.computerUseEnabled && desktopMcpServer) {
      let mcpCheck = await desktopMcpServer.ensureConnectedWithAgy(override)
      if (!mcpCheck.ok) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agy:stream', {
            type: 'text_delta',
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            delta: 'Không kết nối được bộ điều khiển máy, đang thử kết nối lại…\n',
            stepIndex: 0
          })
        }
        mcpCheck = await desktopMcpServer.ensureConnectedWithAgy(override)
        if (!mcpCheck.ok) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agy:stream', {
              type: 'error',
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              error: `Không kết nối được bộ điều khiển máy (MCP egovai-desktop)${mcpCheck.reason ? `: ${mcpCheck.reason}` : ''}. Vui lòng kiểm tra cấu hình MCP trong Cài đặt hoặc khởi động lại ứng dụng.`
            })
          }
          return true
        }
      }
    }

    void agyAdapter.sendPrompt(payload, override, (streamEvent) => {
      auditTracker.onStreamEvent(streamEvent)
      if (
        streamEvent.type === 'result' ||
        streamEvent.type === 'error' ||
        streamEvent.type === 'aborted'
      ) {
        // Phạm vi điều khiển theo việc tự hết hạn ngay khi lượt trả lời kết thúc.
        interactionManager?.clearTaskScope()
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agy:stream', streamEvent)
      }
    })
    return true
  })

  ipcMain.handle('agy:abort', (_event, conversationId: string) => {
    interactionManager?.cancelAll('Người dùng đã dừng phản hồi của trợ lý.')
    return agyAdapter.abort(conversationId)
  })

  // ---- Interactive Approval & Context Popups ----
  ipcMain.handle('interaction:respond', (_event, response: InteractionResponse) => {
    auditTracker.interactionResponded(response)
    return interactionManager?.respond(response) ?? false
  })

  ipcMain.handle('interaction:resetApprovals', () => {
    interactionManager?.resetSessionAutoApprove()
    return true
  })

  // ---- Persistent App State ----
  ipcMain.handle('state:load', () => {
    const state = storageService.getState()
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowTheme(mainWindow, state.settings.theme)
    }
    return state
  })

  ipcMain.handle('project:pick', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục dự án / bộ kỹ năng',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return storageService.addOrSelectProject(res.filePaths[0])
  })

  ipcMain.handle('project:addPath', (_event, folderPath: string) => {
    return storageService.addOrSelectProject(folderPath)
  })

  ipcMain.handle('project:remove', (_event, projectId: string) => {
    storageService.removeProject(projectId)
    return true
  })

  ipcMain.handle('conversation:save', (_event, conversation: Conversation) => {
    if (!storageService.getState().projects.some((p) => p.id === conversation.projectId)) return false
    storageService.upsertConversation(conversation)
    return true
  })

  ipcMain.handle('conversation:delete', (_event, conversationId: string) => {
    agyAdapter.abort(conversationId)
    storageService.deleteConversation(conversationId)
    return true
  })

  // ---- Data protection: history wipe, storage status, audit export ----
  ipcMain.handle('history:clearAll', () => {
    agyAdapter.abortAll()
    const count = storageService.clearAllConversations()
    auditTracker.historyCleared(count)
    return count
  })

  ipcMain.handle('security:status', () => {
    return storageService.getSecurityStatus(auditLog.getFilePath())
  })

  ipcMain.handle('audit:exportXlsx', async () => {
    if (!mainWindow) return null
    const stamp = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất nhật ký hoạt động (Excel)',
      defaultPath: join(app.getPath('documents'), `nhat-ky-eGovAI-${stamp}.xlsx`),
      filters: [{ name: 'Excel (*.xlsx)', extensions: ['xlsx'] }]
    })
    if (res.canceled || !res.filePath) return null
    const result = auditLog.exportToXlsx(res.filePath)
    auditLog.log({
      project: '',
      conversationId: '',
      event: 'audit_exported',
      summary: `Xuất ${result.rows} dòng nhật ký ra Excel`,
      files: [res.filePath]
    })
    return { path: res.filePath, ...result }
  })

  // ---- App updates (GitHub Releases) ----
  ipcMain.handle('update:getState', () => updateService?.getState() ?? null)
  ipcMain.handle('update:check', () => updateService?.check(true) ?? null)
  ipcMain.handle('update:install', () => updateService?.downloadAndInstall() ?? null)
  ipcMain.handle('update:skip', (_event, version: string) =>
    typeof version === 'string' ? (updateService?.skipVersion(version) ?? null) : null
  )
  ipcMain.handle('update:setAutoCheck', (_event, enabled: boolean) =>
    updateService?.setAutoCheck(enabled === true) ?? null
  )

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    const updated = storageService.updateSettings(partial)
    if (mainWindow && !mainWindow.isDestroyed() && partial.theme) {
      applyWindowTheme(mainWindow, updated.theme)
    }
    return updated
  })

  // ---- Workspace & Skills (Project + Global) ----
  ipcMain.handle('skills:list', (_event, projectPath?: string | null) => {
    const globalSources = storageService.getState().settings.globalSkillSources ?? []
    return discoverAllSkills(projectPath, globalSources)
  })

  ipcMain.handle('skills:importGlobal', async () => {
    if (!mainWindow) return { canceled: true }
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import thư mục kỹ năng vào Kỹ năng chung (Global — áp dụng mọi phiên)',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }

    const folderPath = res.filePaths[0]
    const found = discoverSkillsInDirectory(folderPath, 'global')
    if (found.length === 0) {
      return {
        canceled: false,
        error:
          'Thư mục này chưa có tệp SKILL.md, INDEX.md hoặc .agents/skills/. Vui lòng chọn đúng thư mục chứa bộ kỹ năng.'
      }
    }

    const current = storageService.getState().settings.globalSkillSources ?? []
    const existing = current.find((s) => s.path.toLowerCase() === folderPath.toLowerCase())
    const nextSources: GlobalSkillSource[] = existing
      ? current.map((s) =>
          s.id === existing.id
            ? { ...s, name: basename(folderPath) || folderPath, skillCount: found.length }
            : s
        )
      : [
          {
            id: randomUUID(),
            name: basename(folderPath) || folderPath,
            path: folderPath,
            addedAt: Date.now(),
            skillCount: found.length
          },
          ...current
        ]

    storageService.updateSettings({ globalSkillSources: nextSources })
    syncGlobalSkillsToOfficialDir(nextSources)
    return {
      canceled: false,
      sources: nextSources,
      importedCount: found.length
    }
  })

  ipcMain.handle('skills:removeGlobal', (_event, sourceId: string) => {
    const current = storageService.getState().settings.globalSkillSources ?? []
    const nextSources = current.filter((s) => s.id !== sourceId)
    storageService.updateSettings({ globalSkillSources: nextSources })
    syncGlobalSkillsToOfficialDir(nextSources)
    return nextSources
  })

  ipcMain.handle('skills:readSop', (_event, projectPath: string, sopPathOrFull: string) => {
    return readSkillPreview(projectPath, sopPathOrFull)
  })

  ipcMain.handle('workspace:search', (_event, projectPath: string, query: string) => {
    return searchWorkspaceEntries(projectPath, query, 80)
  })

  ipcMain.handle('workspace:pickFiles', async (_event, projectPath?: string) => {
    if (!mainWindow) return []
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn tài liệu hoặc hình ảnh đính kèm',
      defaultPath: projectPath,
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled) return []
    return res.filePaths
  })

  ipcMain.handle('workspace:openPath', async (event, targetPath: string) => {
    // Only directories and office/document/image files may be opened with the OS default app —
    // never executables/scripts (an AI-generated link to a .bat/.exe/.lnk would run it).
    let isDirectory: boolean | undefined
    try {
      isDirectory = (await stat(targetPath)).isDirectory()
    } catch {
      isDirectory = undefined
    }
    const check = checkOpenPathAllowed(targetPath, isDirectory)
    const failMessage = check.allowed ? await shell.openPath(targetPath) : check.error
    if (!failMessage) return true
    const win = BrowserWindow.fromWebContents(event.sender)
    const box = {
      type: 'warning' as const,
      title: 'eGovAI',
      message: 'Không mở được tệp',
      detail: failMessage
    }
    void (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box))
    return false
  })

  ipcMain.handle('workspace:revealInExplorer', (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath)
    return true
  })

  // ---- Phase 4: Document, Word (.docx) & Excel (.xlsx/.csv) Studio ----
  ipcMain.handle('doc:open', async (_event, filePath: string) => {
    return await openDocumentFile(filePath)
  })

  ipcMain.handle('doc:pickOpen', async (_event, defaultDir?: string) => {
    if (!mainWindow) return []
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Mở tệp Word, Excel, PDF hoặc Văn bản',
      defaultPath: defaultDir,
      filters: [
        {
          name: 'Tài liệu, Bảng tính & PDF',
          extensions: ['docx', 'xlsx', 'xls', 'xlsm', 'csv', 'pdf', 'md', 'txt', 'json', 'png', 'jpg', 'jpeg', 'webp']
        },
        { name: 'Word (.docx)', extensions: ['docx', 'doc'] },
        { name: 'Excel (.xlsx, .xls, .csv)', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] },
        { name: 'PDF & Hình ảnh', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'Văn bản & Mã', extensions: ['md', 'txt', 'json', 'py', 'ts', 'js', 'html'] },
        { name: 'Tất cả tệp', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || res.filePaths.length === 0) return []
    const opened = []
    for (const filePath of res.filePaths) {
      opened.push(await openDocumentFile(filePath))
    }
    return opened
  })

  ipcMain.handle('doc:saveText', (_event, filePath: string, content: string) => {
    return saveTextDocumentFile(filePath, content)
  })

  ipcMain.handle('doc:saveExcel', (_event, filePath: string, sheets: ExcelSheetData[]) => {
    return saveExcelDocumentFile(filePath, sheets)
  })

  ipcMain.handle(
    'doc:exportDocx',
    async (_event, defaultName: string, defaultDir: string, markdownText: string) => {
      if (!mainWindow) return null
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Xuất văn bản chuẩn Word (.docx — Times New Roman 14pt, lề NĐ 30)',
        defaultPath: join(defaultDir, defaultName.endsWith('.docx') ? defaultName : `${defaultName}.docx`),
        filters: [{ name: 'Word Document (*.docx)', extensions: ['docx'] }]
      })
      if (res.canceled || !res.filePath) return null
      const exported = await exportMarkdownToDocx(res.filePath, markdownText)
      auditTracker.documentExported(exported.path, 'docx')
      return exported
    }
  )

  ipcMain.handle(
    'doc:create',
    async (_event, dirPath: string, fileName: string, kind: 'markdown' | 'docx' | 'excel') => {
      const createdPath = await createBlankDocument(dirPath, fileName, kind)
      return await openDocumentFile(createdPath)
    }
  )

  // ---- Phase 4: Git Diff ----
  ipcMain.handle('git:changes', async (_event, projectPath: string) => {
    return await getGitChanges(projectPath)
  })

  ipcMain.handle('git:diff', async (_event, projectPath: string, relativePath: string) => {
    return await getGitFileDiff(projectPath, relativePath)
  })

  // ---- Phase 4: AI Work Directory (UBND Thiệu Toán) ----
  ipcMain.handle('aiworkdir:info', (_event, projectPath: string) => {
    return getAiWorkDirInfo(projectPath)
  })

  ipcMain.handle('aiworkdir:pick', async (_event, projectPath: string) => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn Thư mục làm việc AI (nên đặt tên "Thư mục làm việc AI")',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return configureAiWorkDir(projectPath, res.filePaths[0])
  })

  // ---- Phase 4: Integrated Terminal ----
  ipcMain.handle('terminal:run', (_event, commandId: string, command: string, cwd: string) => {
    terminalService.runCommand(commandId, command, cwd, (evt) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', evt)
      }
    })
    return true
  })

  ipcMain.handle('terminal:kill', () => {
    return terminalService.killActive()
  })

  ipcMain.handle('terminal:openExternal', (_event, cwd: string) => {
    terminalService.openExternalPowerShell(cwd)
    return true
  })

  // ---- Phase 4: Scheduled Tasks ----
  ipcMain.handle('scheduler:upsert', (_event, task: ScheduledTask) => {
    return storageService.upsertScheduledTask(task)
  })

  ipcMain.handle('scheduler:delete', (_event, taskId: string) => {
    return storageService.deleteScheduledTask(taskId)
  })

  ipcMain.handle('scheduler:runNow', (_event, taskId: string) => {
    void schedulerService.runTaskNow(taskId)
    return true
  })

  // ---- Phase 4: Antigravity Customizations Sync ----
  ipcMain.handle('customizations:load', (_event, projectPath?: string) => {
    return loadAntigravityCustomizations(projectPath)
  })

  ipcMain.handle(
    'customizations:save',
    (_event, filePath: string, content: string, validateJson: boolean) => {
      saveCustomizationFile(filePath, content, validateJson)
      return true
    }
  )
}

app.whenReady().then(async () => {
  // Keep the internal name: it decides the userData folder that holds saved projects and conversations.
  app.setName('GoogleAI')
  storageService = new StorageService()
  auditLog = new AuditLogService(
    app.getPath('userData'),
    safeStorage.isEncryptionAvailable() ? safeStorage : null
  )
  auditTracker = new AgentAuditTracker(auditLog)
  syncGlobalSkillsToOfficialDir(storageService.getState().settings.globalSkillSources ?? [])

  // Start interactive Approval/Context Manager + Desktop MCP bridge in Electron's real desktop session
  interactionManager = new InteractionManager((req) => {
    auditTracker.interactionRequested(req)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.flashFrame(true)
      mainWindow.webContents.send('interaction:request', req)
    }
  })

  inAppBrowserService = new InAppBrowserService({
    onRequestOpen: (url) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:open', url ?? '')
      }
    }
  })

  desktopMcpServer = new DesktopMcpServer(
    () => true,
    interactionManager,
    inAppBrowserService
  )
  try {
    await desktopMcpServer.start()
    void desktopMcpServer.registerWithAgy(storageService.getState().settings.agyPathOverride)
  } catch {
    // non-fatal
  }

  schedulerService = new SchedulerService(storageService, (tasks) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler:updated', tasks)
    }
  })
  schedulerService.start()
  updateService = new UpdateService({
    getSettings: () => storageService.getState().settings,
    updateSettings: (partial) => {
      storageService.updateSettings(partial)
    },
    audit: auditLog,
    onState: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:state', state)
      }
    }
  })
  registerIpcHandlers()
  createWindow()
  updateService.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  updateService?.stop()
  oauthManager.cancel()
  interactionManager?.cancelAll('Ứng dụng đã đóng.')
  desktopMcpServer?.stop()
  schedulerService?.stop()
  terminalService.killActive()
  agyAdapter.abortAll()
})

app.on('window-all-closed', () => {
  oauthManager.cancel()
  interactionManager?.cancelAll('Ứng dụng đã đóng.')
  desktopMcpServer?.stop()
  schedulerService?.stop()
  terminalService.killActive()
  agyAdapter.abortAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
