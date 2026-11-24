import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Conversation,
  type PersistedState,
  type ProjectWorkspace,
  type ScheduledTask,
  type StorageSecurityStatus
} from '../../shared/types'
import { discoverWorkspaceSkills } from './skillDiscovery'

const DEFAULT_RECOMMENDED_WORKSPACES = [
  'C:\\Users\\William Trinh\\Downloads\\ubndthieutoan-skills'
]

/** Subset of Electron `safeStorage` (DPAPI on Windows) — injectable for tests. */
export interface StringCrypto {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Magic header of the encrypted state file: `EGOVAI-ENC1\n` + safeStorage ciphertext. */
export const ENCRYPTED_MAGIC = Buffer.from('EGOVAI-ENC1\n', 'ascii')
export const STATE_FILE_NAME = 'googleai-state.json'
const DAY_MS = 24 * 60 * 60 * 1000

export function isEncryptedStateBuffer(buf: Buffer): boolean {
  return buf.length >= ENCRYPTED_MAGIC.length && buf.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)
}

export function encodeStateFile(json: string, crypto: StringCrypto | null): Buffer {
  if (crypto && crypto.isEncryptionAvailable()) {
    return Buffer.concat([ENCRYPTED_MAGIC, crypto.encryptString(json)])
  }
  return Buffer.from(json, 'utf8')
}

/** Throws when the file is encrypted but cannot be decrypted. */
export function decodeStateFile(buf: Buffer, crypto: StringCrypto | null): { json: string; encrypted: boolean } {
  if (isEncryptedStateBuffer(buf)) {
    if (!crypto || !crypto.isEncryptionAvailable()) {
      throw new Error('Tệp lịch sử đã được mã hoá nhưng máy hiện không hỗ trợ giải mã (safeStorage).')
    }
    return { json: crypto.decryptString(buf.subarray(ENCRYPTED_MAGIC.length)), encrypted: true }
  }
  return { json: buf.toString('utf8').replace(/^\uFEFF/, ''), encrypted: false }
}

/**
 * Remove conversations not updated within `retentionDays` (0 or less = keep forever).
 * Pinned conversations are always kept.
 */
export function pruneConversations(
  conversations: Conversation[],
  retentionDays: number,
  now: number = Date.now()
): { kept: Conversation[]; removed: number } {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { kept: conversations, removed: 0 }
  }
  const cutoff = now - retentionDays * DAY_MS
  const kept = conversations.filter((c) => c.pinned || (c.updatedAt ?? c.createdAt ?? 0) >= cutoff)
  return { kept, removed: conversations.length - kept.length }
}

export interface StorageServiceOptions {
  dir?: string
  crypto?: StringCrypto | null
  now?: () => number
  /** Skip seeding default workspaces (tests). */
  seedWorkspaces?: string[]
}

export class StorageService {
  private filePath: string
  private state: PersistedState
  private crypto: StringCrypto | null
  private now: () => number
  private seedWorkspaces: string[]
  private encrypted = false
  private writesBlocked = false
  private loadError: string | undefined
  private prunedOnStartup = 0

  constructor(options: StorageServiceOptions = {}) {
    const dir = options.dir ?? app.getPath('userData')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.crypto = options.crypto === undefined ? safeStorage : options.crypto
    this.now = options.now ?? Date.now
    this.seedWorkspaces = options.seedWorkspaces ?? DEFAULT_RECOMMENDED_WORKSPACES
    this.filePath = join(dir, STATE_FILE_NAME)
    this.state = this.load()
  }

  private encryptionAvailable(): boolean {
    try {
      return !!this.crypto && this.crypto.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private createProjectRecord(folderPath: string): ProjectWorkspace {
    const skills = discoverWorkspaceSkills(folderPath)
    return {
      id: randomUUID(),
      name: basename(folderPath) || folderPath,
      path: folderPath,
      lastOpenedAt: Date.now(),
      hasIndexRouter: existsSync(join(folderPath, 'INDEX.md')),
      hasAgentsSkills: existsSync(join(folderPath, '.agents', 'skills')),
      skillCount: skills.length
    }
  }

  private load(): PersistedState {
    if (existsSync(this.filePath)) {
      let parsed: Partial<PersistedState>
      let wasEncrypted = false
      try {
        const decoded = decodeStateFile(readFileSync(this.filePath), this.crypto)
        wasEncrypted = decoded.encrypted
        parsed = JSON.parse(decoded.json) as Partial<PersistedState>
      } catch (err) {
        // Never overwrite a file we could not read: keep it untouched, run in memory only.
        this.writesBlocked = true
        this.loadError =
          'Không đọc/giải mã được tệp lịch sử hiện có; ứng dụng tạm thời KHÔNG ghi đè tệp này. ' +
          `Chi tiết: ${err instanceof Error ? err.message : String(err)}`
        return this.initialState(false)
      }

      this.encrypted = wasEncrypted
      const projects = (parsed.projects ?? []).map((p) => {
        const skills = existsSync(p.path) ? discoverWorkspaceSkills(p.path) : []
        return {
          ...p,
          hasIndexRouter: existsSync(join(p.path, 'INDEX.md')),
          hasAgentsSkills: existsSync(join(p.path, '.agents', 'skills')),
          skillCount: skills.length
        }
      })
      const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
      const { kept, removed } = pruneConversations(
        parsed.conversations ?? [],
        settings.historyRetentionDays,
        this.now()
      )
      this.prunedOnStartup = removed

      const state: PersistedState = {
        projects,
        conversations: kept,
        settings,
        scheduledTasks: parsed.scheduledTasks ?? []
      }

      if (!wasEncrypted && this.encryptionAvailable()) {
        // One-time migration from the old plain-text file. writeState() verifies the
        // encrypted copy decrypts back to identical JSON before it replaces the plain file.
        this.writeState(state)
      } else if (removed > 0) {
        this.writeState(state)
      }
      return state
    }

    return this.initialState(true)
  }

  private initialState(persist: boolean): PersistedState {
    const seededProjects: ProjectWorkspace[] = []
    for (const candidate of this.seedWorkspaces) {
      if (existsSync(candidate)) {
        seededProjects.push(this.createProjectRecord(candidate))
      }
    }

    const initial: PersistedState = {
      projects: seededProjects,
      conversations: [],
      settings: { ...DEFAULT_SETTINGS },
      scheduledTasks: []
    }
    if (persist) this.writeState(initial)
    return initial
  }

  /**
   * Atomic write: encode to a temp file, verify it reads back to the same JSON,
   * then rename over the real file. The previous file stays intact on any failure.
   */
  private writeState(next: PersistedState): boolean {
    if (this.writesBlocked) return false
    const json = JSON.stringify(next, null, 2)
    const tmpPath = `${this.filePath}.tmp`
    try {
      const wantEncrypt = this.encryptionAvailable()
      if (!wantEncrypt && this.encrypted) {
        // Never downgrade an encrypted file to plain text.
        return false
      }
      const buf = encodeStateFile(json, wantEncrypt ? this.crypto : null)
      writeFileSync(tmpPath, buf)
      const check = decodeStateFile(readFileSync(tmpPath), this.crypto)
      if (check.json !== json) {
        throw new Error('Kiểm tra đọc lại tệp lịch sử thất bại')
      }
      renameSync(tmpPath, this.filePath)
      this.encrypted = wantEncrypt
      return true
    } catch {
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath)
      } catch {
        // ignore
      }
      return false
    }
  }

  getState(): PersistedState {
    return this.state
  }

  getFilePath(): string {
    return this.filePath
  }

  getSecurityStatus(auditLogPath = ''): StorageSecurityStatus {
    return {
      encrypted: this.encrypted,
      encryptionAvailable: this.encryptionAvailable(),
      writesBlocked: this.writesBlocked,
      loadError: this.loadError,
      prunedOnStartup: this.prunedOnStartup,
      filePath: this.filePath,
      auditLogPath
    }
  }

  addOrSelectProject(folderPath: string): ProjectWorkspace {
    const existing = this.state.projects.find(
      (p) => p.path.toLowerCase() === folderPath.toLowerCase()
    )
    if (existing) {
      existing.lastOpenedAt = Date.now()
      existing.hasIndexRouter = existsSync(join(folderPath, 'INDEX.md'))
      existing.hasAgentsSkills = existsSync(join(folderPath, '.agents', 'skills'))
      existing.skillCount = discoverWorkspaceSkills(folderPath).length
      this.writeState(this.state)
      return existing
    }

    const created = this.createProjectRecord(folderPath)
    this.state.projects.unshift(created)
    this.writeState(this.state)
    return created
  }

  removeProject(projectId: string): void {
    const next = {
      ...this.state,
      projects: this.state.projects.filter((p) => p.id !== projectId),
      conversations: this.state.conversations.filter((c) => c.projectId !== projectId),
      scheduledTasks: this.state.scheduledTasks.filter((t) => t.projectId !== projectId)
    }
    if (!this.writeState(next)) throw new Error('Không thể lưu thay đổi khi xóa dự án.')
    this.state = next
  }

  upsertConversation(conversation: Conversation): void {
    const idx = this.state.conversations.findIndex((c) => c.id === conversation.id)
    if (idx >= 0) {
      this.state.conversations[idx] = conversation
    } else {
      this.state.conversations.unshift(conversation)
    }
    this.writeState(this.state)
  }

  deleteConversation(conversationId: string): void {
    this.state.conversations = this.state.conversations.filter((c) => c.id !== conversationId)
    this.writeState(this.state)
  }

  /** Delete every saved conversation. Returns how many were removed. */
  clearAllConversations(): number {
    const count = this.state.conversations.length
    this.state.conversations = []
    this.writeState(this.state)
    return count
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.state.settings = { ...this.state.settings, ...partial }
    this.writeState(this.state)
    return this.state.settings
  }

  upsertScheduledTask(task: ScheduledTask): ScheduledTask[] {
    const idx = this.state.scheduledTasks.findIndex((t) => t.id === task.id)
    if (idx >= 0) {
      this.state.scheduledTasks[idx] = task
    } else {
      this.state.scheduledTasks.unshift(task)
    }
    this.writeState(this.state)
    return this.state.scheduledTasks
  }

  deleteScheduledTask(taskId: string): ScheduledTask[] {
    this.state.scheduledTasks = this.state.scheduledTasks.filter((t) => t.id !== taskId)
    this.writeState(this.state)
    return this.state.scheduledTasks
  }
}
