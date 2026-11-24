/**
 * Append-only audit trail (JSONL) in userData.
 *
 * Each line is one event. When Electron safeStorage is available the line is stored as
 * `enc:<base64 ciphertext>`; otherwise as plain JSON. Entries never contain full document
 * contents — only the first 200 characters of a prompt, file paths and tool names.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { userInfo } from 'os'
import * as XLSX from 'xlsx'
import type {
  AgyStreamEvent,
  InteractionRequest,
  InteractionResponse,
  SendPromptPayload
} from '../../shared/types'
import type { StringCrypto } from './storageService'

export const AUDIT_FILE_NAME = 'googleai-audit.jsonl'
export const PROMPT_PREVIEW_CHARS = 200

export type AuditEventType =
  | 'prompt_sent'
  | 'classified_blocked'
  | 'tool_step'
  | 'file_written'
  | 'desktop_action'
  | 'document_exported'
  | 'history_cleared'
  | 'audit_exported'
  | 'app_update'

export interface AuditEntry {
  /** ISO-8601 timestamp */
  ts: string
  windowsUser: string
  project: string
  conversationId: string
  event: AuditEventType
  /** Short human-readable summary (Vietnamese). */
  summary: string
  /** File paths involved (attachments, files written, exported documents). */
  files?: string[]
  toolName?: string
  /** For desktop actions: approved/denied. */
  decision?: 'approved' | 'denied'
  details?: Record<string, string | number | boolean>
}

const EVENT_LABELS: Record<AuditEventType, string> = {
  prompt_sent: 'Gửi yêu cầu tới AI',
  classified_blocked: 'Chặn tài liệu mật',
  tool_step: 'Bước công cụ AI',
  file_written: 'AI ghi/sửa tệp',
  desktop_action: 'Thao tác điều khiển máy tính',
  document_exported: 'Xuất văn bản',
  history_cleared: 'Xoá lịch sử hội thoại',
  audit_exported: 'Xuất nhật ký',
  app_update: 'Cập nhật ứng dụng'
}

function safeWindowsUser(): string {
  try {
    return process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : userInfo().username
  } catch {
    return process.env.USERNAME ?? 'unknown'
  }
}

export function truncatePrompt(prompt: string, max = PROMPT_PREVIEW_CHARS): string {
  const flat = (prompt ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function buildAuditEntry(
  input: Omit<AuditEntry, 'ts' | 'windowsUser'> & { ts?: string; windowsUser?: string }
): AuditEntry {
  const entry: AuditEntry = {
    ts: input.ts ?? new Date().toISOString(),
    windowsUser: input.windowsUser ?? safeWindowsUser(),
    project: input.project ?? '',
    conversationId: input.conversationId ?? '',
    event: input.event,
    summary: (input.summary ?? '').slice(0, 500)
  }
  if (input.files?.length) entry.files = input.files.slice(0, 100)
  if (input.toolName) entry.toolName = input.toolName
  if (input.decision) entry.decision = input.decision
  if (input.details && Object.keys(input.details).length) {
    const d: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(input.details)) {
      d[k] = typeof v === 'string' ? v.slice(0, 300) : v
    }
    entry.details = d
  }
  return entry
}

export function serializeAuditLine(entry: AuditEntry, crypto: StringCrypto | null): string {
  const json = JSON.stringify(entry)
  if (crypto && crypto.isEncryptionAvailable()) {
    return `enc:${crypto.encryptString(json).toString('base64')}`
  }
  return json
}

export function parseAuditLine(line: string, crypto: StringCrypto | null): AuditEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('enc:')) {
      if (!crypto) return null
      return JSON.parse(crypto.decryptString(Buffer.from(trimmed.slice(4), 'base64'))) as AuditEntry
    }
    return JSON.parse(trimmed) as AuditEntry
  } catch {
    return null
  }
}

/** Keys in tool parameters worth recording (paths, targets, commands) — never file contents. */
const PARAM_KEY_RE = /path|file|target|uri|dir|cwd|command|cmd|url|app|window|selector|name/i
const CONTENT_KEY_RE = /content|text|body|code|replacement|diff|data|chunk/i

export function summarizeToolParameters(
  params: Record<string, unknown> | undefined
): { files: string[]; details: Record<string, string> } {
  const files: string[] = []
  const details: Record<string, string> = {}
  if (!params) return { files, details }
  for (const [key, value] of Object.entries(params)) {
    if (CONTENT_KEY_RE.test(key) && !/path|file/i.test(key)) continue
    if (!PARAM_KEY_RE.test(key)) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v !== 'string' && typeof v !== 'number') continue
      const s = String(v).slice(0, 300)
      if (/path|file|target|uri/i.test(key)) files.push(s)
      else details[key] = s
    }
  }
  return { files, details }
}

const WRITE_TOOL_RE = /write|edit|replace|create|save|delete|move|rename|patch/i

export function isFileWriteTool(toolName: string): boolean {
  return WRITE_TOOL_RE.test(toolName) && !/^(view|read|list|grep|search|find)/i.test(toolName)
}

export class AuditLogService {
  private filePath: string
  private crypto: StringCrypto | null

  constructor(dir: string, crypto: StringCrypto | null) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, AUDIT_FILE_NAME)
    this.crypto = crypto
  }

  getFilePath(): string {
    return this.filePath
  }

  log(input: Parameters<typeof buildAuditEntry>[0]): AuditEntry | null {
    try {
      const entry = buildAuditEntry(input)
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(this.filePath, serializeAuditLine(entry, this.crypto) + '\n', 'utf8')
      return entry
    } catch {
      return null
    }
  }

  readAll(): { entries: AuditEntry[]; unreadable: number } {
    if (!existsSync(this.filePath)) return { entries: [], unreadable: 0 }
    const entries: AuditEntry[] = []
    let unreadable = 0
    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const e = parseAuditLine(line, this.crypto)
      if (e) entries.push(e)
      else unreadable++
    }
    return { entries, unreadable }
  }

  /** Write the whole log to an .xlsx file. Returns the number of rows exported. */
  exportToXlsx(targetPath: string): { rows: number; unreadable: number } {
    const { entries, unreadable } = this.readAll()
    const header = [
      'Thời gian',
      'Người dùng Windows',
      'Dự án',
      'Mã hội thoại',
      'Loại sự kiện',
      'Nội dung',
      'Công cụ',
      'Quyết định',
      'Tệp liên quan',
      'Chi tiết'
    ]
    const rows = entries.map((e) => [
      new Date(e.ts).toLocaleString('vi-VN'),
      e.windowsUser,
      e.project,
      e.conversationId,
      EVENT_LABELS[e.event] ?? e.event,
      e.summary,
      e.toolName ?? '',
      e.decision === 'approved' ? 'Cho phép' : e.decision === 'denied' ? 'Từ chối' : '',
      (e.files ?? []).join('\n'),
      e.details ? JSON.stringify(e.details) : ''
    ])
    if (unreadable > 0) {
      rows.push(['', '', '', '', '', `${unreadable} dòng nhật ký không giải mã được`, '', '', '', ''])
    }
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [20, 22, 30, 38, 24, 60, 22, 12, 50, 40].map((wch) => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Nhật ký')
    const dir = dirname(targetPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    writeFileSync(targetPath, buf)
    return { rows: entries.length, unreadable }
  }
}

/**
 * Glue between app events (prompt payloads, adapter stream events, approval popups)
 * and the audit log. Kept here so `src/main/index.ts` only needs one-line hooks.
 */
export class AgentAuditTracker {
  private projectByConversation = new Map<string, string>()
  private loggedSteps = new Set<string>()
  private pendingRequests = new Map<string, InteractionRequest>()
  private last = { project: '', conversationId: '' }

  constructor(private audit: AuditLogService) {}

  promptSent(payload: SendPromptPayload): void {
    this.projectByConversation.set(payload.conversationId, payload.projectPath)
    this.last = { project: payload.projectPath, conversationId: payload.conversationId }
    this.audit.log({
      project: payload.projectPath,
      conversationId: payload.conversationId,
      event: 'prompt_sent',
      summary: truncatePrompt(payload.prompt),
      files: (payload.attachments ?? []).map((a) => a.path),
      details: {
        ...(payload.modelId ? { model: payload.modelId } : {}),
        ...(payload.activeSkill?.title ? { skill: payload.activeSkill.title } : {}),
        attachments: (payload.attachments ?? []).length
      }
    })
  }

  classifiedBlocked(payload: SendPromptPayload, hits: { path: string; level: string }[]): void {
    this.audit.log({
      project: payload.projectPath,
      conversationId: payload.conversationId,
      event: 'classified_blocked',
      summary: `Chặn gửi ${hits.length} tệp có dấu độ mật: ${hits.map((h) => h.level).join(', ')}`,
      files: hits.map((h) => h.path),
      details: { promptPreview: truncatePrompt(payload.prompt, 80) }
    })
  }

  onStreamEvent(evt: AgyStreamEvent): void {
    if (evt.type !== 'tool_update') return
    const call = evt.toolCall
    if (call.state === 'ACTIVE') return
    const key = `${evt.conversationId}:${evt.messageId}:${call.stepIndex}`
    if (this.loggedSteps.has(key)) return
    this.loggedSteps.add(key)
    if (this.loggedSteps.size > 5000) this.loggedSteps.clear()

    const project = this.projectByConversation.get(evt.conversationId) ?? this.last.project
    const { files, details } = summarizeToolParameters(call.parameters)
    this.audit.log({
      project,
      conversationId: evt.conversationId,
      event: 'tool_step',
      summary: `${call.toolName} (${call.state === 'ERROR' ? 'lỗi' : 'xong'})`,
      toolName: call.toolName,
      files,
      details
    })
    if (call.state === 'DONE' && files.length > 0 && isFileWriteTool(call.toolName)) {
      this.audit.log({
        project,
        conversationId: evt.conversationId,
        event: 'file_written',
        summary: `AI ghi/sửa ${files.length} tệp bằng ${call.toolName}`,
        toolName: call.toolName,
        files
      })
    }
  }

  interactionRequested(req: InteractionRequest): void {
    if (req.kind !== 'approval') return
    this.pendingRequests.set(req.id, req)
  }

  interactionResponded(res: InteractionResponse): void {
    const req = this.pendingRequests.get(res.id)
    if (!req) return
    this.pendingRequests.delete(res.id)
    const detailEntries = Object.entries(req.details ?? {})
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .slice(0, 10) as [string, string | number | boolean][]
    this.audit.log({
      project: this.last.project,
      conversationId: this.last.conversationId,
      event: 'desktop_action',
      summary: `${res.approved ? 'Cho phép' : 'Từ chối'}: ${req.title}`.slice(0, 300),
      toolName: req.toolName,
      decision: res.approved ? 'approved' : 'denied',
      details: {
        ...Object.fromEntries(detailEntries),
        ...(res.alwaysAllowSession ? { alwaysAllowSession: true } : {})
      }
    })
  }

  documentExported(path: string, kind = 'docx'): void {
    this.audit.log({
      project: this.last.project,
      conversationId: this.last.conversationId,
      event: 'document_exported',
      summary: `Xuất văn bản ${kind.toUpperCase()}`,
      files: [path]
    })
  }

  historyCleared(count: number): void {
    this.audit.log({
      project: '',
      conversationId: '',
      event: 'history_cleared',
      summary: `Người dùng xoá toàn bộ ${count} hội thoại đã lưu`
    })
  }
}
