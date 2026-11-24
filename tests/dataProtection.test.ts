import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as XLSX from 'xlsx'
import { Document, Packer, Paragraph, TextRun, Header } from 'docx'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import {
  detectSecretStamp,
  readZipEntries,
  scanAttachmentsForClassification,
  formatClassificationBlockMessage
} from '../src/main/services/classificationGuard'
import {
  ENCRYPTED_MAGIC,
  StorageService,
  pruneConversations,
  type StringCrypto
} from '../src/main/services/storageService'
import {
  AgentAuditTracker,
  AuditLogService,
  buildAuditEntry,
  parseAuditLine,
  serializeAuditLine
} from '../src/main/services/auditLogService'
import { AI_DRAFT_MARK, exportMarkdownToDocx } from '../src/main/services/documentService'
import type { Conversation } from '../src/shared/types'

/** Fake safeStorage: XOR + base64 so ciphertext never contains the plain JSON. */
function fakeCrypto(opts: { available?: boolean; failDecrypt?: boolean } = {}): StringCrypto {
  const key = 0x5a
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (s: string) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ key)),
    decryptString: (b: Buffer) => {
      if (opts.failDecrypt) throw new Error('DPAPI decrypt failed')
      return Buffer.from(b.map((x) => x ^ key)).toString('utf8')
    }
  }
}

function conv(id: string, daysAgo: number, now: number, pinned = false): Conversation {
  const t = now - daysAgo * 86400000
  return { id, projectId: 'p1', title: id, createdAt: t, updatedAt: t, messages: [], pinned }
}

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'egov-dp-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------- 1. classification
describe('classificationGuard.detectSecretStamp', () => {
  it('detects standalone uppercase stamps', () => {
    expect(detectSecretStamp('UBND XÃ A\nMẬT\nQUYẾT ĐỊNH')?.level).toBe('MẬT')
    expect(detectSecretStamp('CỘNG HÒA XHCN VIỆT NAM\n  TỐI MẬT  \nnội dung')?.level).toBe('TỐI MẬT')
    expect(detectSecretStamp('**TUYỆT MẬT**\nBáo cáo')?.level).toBe('TUYỆT MẬT')
    expect(detectSecretStamp('[MẬT]')?.level).toBe('MẬT')
  })

  it('detects "Độ mật:" field in any case', () => {
    expect(detectSecretStamp('Số: 12/BC-UBND\nĐộ mật: Tối mật\n')?.level).toBe('TỐI MẬT')
    expect(detectSecretStamp('ĐỘ MẬT: MẬT')?.level).toBe('MẬT')
  })

  it('detects strong stamps inline in the header area', () => {
    expect(detectSecretStamp('UBND HUYỆN X     TUYỆT MẬT     Số: 01')?.level).toBe('TUYỆT MẬT')
  })

  it('handles NFD-decomposed Vietnamese text', () => {
    expect(detectSecretStamp('TỐI MẬT'.normalize('NFD'))?.level).toBe('TỐI MẬT')
  })

  it('returns the highest level when several appear', () => {
    expect(detectSecretStamp('MẬT\nTUYỆT MẬT')?.level).toBe('TUYỆT MẬT')
  })

  it('does not flag ordinary body text', () => {
    const body = [
      'Đề nghị đổi mật khẩu tài khoản định kỳ.',
      'Bảo vệ bí mật kinh doanh của doanh nghiệp.',
      'QUY CHẾ BẢO VỆ BÍ MẬT NHÀ NƯỚC',
      'Mật',
      'mật',
      'Tài liệu thường, không mật.',
      'Mật độ dân số cao',
      'Độ mật độ xây dựng: 40%'
    ].join('\n')
    expect(detectSecretStamp(body)).toBeNull()
    expect(detectSecretStamp('')).toBeNull()
  })

  it('ignores TỐI MẬT/TUYỆT MẬT mentioned inline deep in the body', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `Đoạn văn số ${i}.`).join('\n')
    expect(
      detectSecretStamp(`${filler}\nTài liệu độ TUYỆT MẬT phải được bảo quản trong két sắt.`)
    ).toBeNull()
  })
})

describe('classificationGuard.scanAttachmentsForClassification', () => {
  it('blocks a .docx with the stamp in the page header and passes a clean one', async () => {
    const stamped = new Document({
      sections: [
        {
          headers: { default: new Header({ children: [new Paragraph('MẬT')] }) },
          children: [new Paragraph({ children: [new TextRun('Báo cáo tình hình')] })]
        }
      ]
    })
    const clean = new Document({
      sections: [{ children: [new Paragraph('Đổi mật khẩu hộp thư công vụ')] }]
    })
    const stampedPath = join(tmp, 'mat.docx')
    const cleanPath = join(tmp, 'thuong.docx')
    writeFileSync(stampedPath, await Packer.toBuffer(stamped))
    writeFileSync(cleanPath, await Packer.toBuffer(clean))

    const res = await scanAttachmentsForClassification([stampedPath, cleanPath])
    expect(res.blocked).toBe(true)
    expect(res.hits).toHaveLength(1)
    expect(res.hits[0]).toMatchObject({ name: 'mat.docx', level: 'MẬT' })

    const ok = await scanAttachmentsForClassification([cleanPath])
    expect(ok.blocked).toBe(false)
  })

  it('scans .xlsx cells, .txt/.md files and folders', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Danh sách'], ['TỐI MẬT'], ['Nguyễn Văn A', '123']]),
      'S1'
    )
    const xlsxPath = join(tmp, 'ds.xlsx')
    writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    const txtPath = join(tmp, 'note.md')
    writeFileSync(txtPath, '# Ghi chú\nĐộ mật: Tuyệt mật\n')

    const res = await scanAttachmentsForClassification([xlsxPath, txtPath])
    expect(res.hits.map((h) => h.level).sort()).toEqual(['TUYỆT MẬT', 'TỐI MẬT'].sort())

    const folderRes = await scanAttachmentsForClassification([tmp])
    expect(folderRes.blocked).toBe(true)
  })

  it('reports unsupported files as unscanned and the message cites the law', async () => {
    const img = join(tmp, 'a.png')
    writeFileSync(img, Buffer.from([0x89, 0x50]))
    const res = await scanAttachmentsForClassification([img])
    expect(res.blocked).toBe(false)
    expect(res.unscanned).toEqual([img])
    const msg = formatClassificationBlockMessage([
      { path: 'x', name: 'x.docx', level: 'MẬT', evidence: 'MẬT' }
    ])
    expect(msg).toContain('Luật Bảo vệ bí mật nhà nước')
    expect(msg).toContain('x.docx')
  })
})

describe('StorageService.removeProject', () => {
  it('persists removal of only the selected project and its records', () => {
    const folder = mkdtempSync(join(tmp, 'project-'))
    const file = join(folder, 'note.txt')
    writeFileSync(file, 'original')
    const options = { dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [folder] }
    const storage = new StorageService(options)
    const [first] = storage.getState().projects
    const other = storage.addOrSelectProject(mkdtempSync(join(tmp, 'other-')))
    for (const project of [first, other]) {
      storage.upsertConversation({ ...conv(project.id, 0, Date.now()), projectId: project.id })
      storage.upsertScheduledTask({
        id: project.id, projectId: project.id, name: 'task', projectPath: project.path,
        prompt: '', intervalMinutes: 60, enabled: true, createdAt: Date.now()
      })
    }

    storage.removeProject(first.id)
    const reloaded = new StorageService(options)
    expect(reloaded.getState().projects.map((p) => p.id)).toEqual([other.id])
    expect(reloaded.getState().conversations.map((c) => c.projectId)).toEqual([other.id])
    expect(reloaded.getState().scheduledTasks.map((t) => t.projectId)).toEqual([other.id])
    reloaded.removeProject(other.id)
    expect(new StorageService(options).getState().projects).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe('original')
  })

  it('keeps the project when saving the deletion fails', () => {
    const options = { dir: tmp, crypto: null, seedWorkspaces: [] }
    const storage = new StorageService(options)
    const project = storage.addOrSelectProject(tmp)
    mkdirSync(`${storage.getFilePath()}.tmp`)
    expect(() => storage.removeProject(project.id)).toThrow()
    expect(storage.getState().projects).toContainEqual(project)
    expect(new StorageService(options).getState().projects).toContainEqual(project)
  })
})

// ---------------------------------------------------------------- 2. encrypted storage
describe('StorageService encryption at rest', () => {
  const statePath = (): string => join(tmp, 'googleai-state.json')

  it('writes a new state file encrypted', () => {
    const s = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    s.upsertConversation(conv('c1', 0, Date.now()))
    const raw = readFileSync(statePath())
    expect(raw.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)).toBe(true)
    expect(raw.toString('utf8')).not.toContain('"conversations"')
    expect(s.getSecurityStatus().encrypted).toBe(true)

    const reopened = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    expect(reopened.getState().conversations.map((c) => c.id)).toEqual(['c1'])
  })

  it('migrates an existing plain-text file and leaves no plaintext copy', () => {
    const now = Date.now()
    const plain = {
      projects: [],
      conversations: [conv('old-plain', 1, now)],
      settings: { theme: 'dark' },
      scheduledTasks: []
    }
    writeFileSync(statePath(), JSON.stringify(plain, null, 2), 'utf8')

    const s = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    expect(s.getState().conversations[0].id).toBe('old-plain')
    expect(s.getState().settings.theme).toBe('dark')
    expect(s.getState().settings.historyRetentionDays).toBe(90)

    const raw = readFileSync(statePath())
    expect(raw.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)).toBe(true)
    expect(raw.toString('utf8')).not.toContain('old-plain')
    // No backup / temp file left behind
    expect(readdirSync(tmp).sort()).toEqual(['googleai-state.json'])

    const reopened = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    expect(reopened.getState().conversations[0].id).toBe('old-plain')
  })

  it('keeps the plain file untouched if the encrypted read-back check fails', () => {
    const plain = JSON.stringify({ projects: [], conversations: [conv('keep', 0, Date.now())], settings: {}, scheduledTasks: [] })
    writeFileSync(statePath(), plain, 'utf8')
    const broken: StringCrypto = {
      isEncryptionAvailable: () => true,
      encryptString: (str) => Buffer.from(str),
      decryptString: () => 'garbage'
    }
    new StorageService({ dir: tmp, crypto: broken, seedWorkspaces: [] })
    expect(readFileSync(statePath(), 'utf8')).toBe(plain)
    expect(existsSync(`${statePath()}.tmp`)).toBe(false)
  })

  it('never overwrites a file it cannot decrypt', () => {
    const s = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    s.upsertConversation(conv('secret', 0, Date.now()))
    const before = readFileSync(statePath())

    const failing = new StorageService({
      dir: tmp,
      crypto: fakeCrypto({ failDecrypt: true }),
      seedWorkspaces: []
    })
    expect(failing.getSecurityStatus().writesBlocked).toBe(true)
    expect(failing.getSecurityStatus().loadError).toBeTruthy()
    failing.upsertConversation(conv('new', 0, Date.now()))
    failing.clearAllConversations()
    expect(readFileSync(statePath()).equals(before)).toBe(true)

    // Same for encryption becoming unavailable, and for corrupt plain JSON.
    const noCrypto = new StorageService({ dir: tmp, crypto: fakeCrypto({ available: false }), seedWorkspaces: [] })
    noCrypto.updateSettings({ theme: 'dark' })
    expect(readFileSync(statePath()).equals(before)).toBe(true)

    writeFileSync(statePath(), '{ not json', 'utf8')
    const corrupt = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    corrupt.updateSettings({ theme: 'dark' })
    expect(readFileSync(statePath(), 'utf8')).toBe('{ not json')
  })

  it('falls back to plain JSON when encryption is unavailable', () => {
    const s = new StorageService({ dir: tmp, crypto: null, seedWorkspaces: [] })
    s.upsertConversation(conv('p', 0, Date.now()))
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).conversations[0].id).toBe('p')
  })
})

// ---------------------------------------------------------------- 3. retention
describe('history retention & wipe', () => {
  it('pruneConversations removes old, keeps recent and pinned; 0 keeps all', () => {
    const now = Date.UTC(2026, 10, 24)
    const list = [conv('new', 5, now), conv('old', 100, now), conv('oldPinned', 400, now, true)]
    const res = pruneConversations(list, 90, now)
    expect(res.kept.map((c) => c.id)).toEqual(['new', 'oldPinned'])
    expect(res.removed).toBe(1)
    expect(pruneConversations(list, 0, now).kept).toHaveLength(3)
  })

  it('prunes on startup and persists the result; clearAllConversations wipes', () => {
    const now = Date.now()
    const plain = {
      projects: [],
      conversations: [conv('recent', 10, now), conv('stale', 40, now)],
      settings: { historyRetentionDays: 30 },
      scheduledTasks: []
    }
    writeFileSync(join(tmp, 'googleai-state.json'), JSON.stringify(plain), 'utf8')
    const s = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [], now: () => now })
    expect(s.getState().conversations.map((c) => c.id)).toEqual(['recent'])
    expect(s.getSecurityStatus().prunedOnStartup).toBe(1)

    const reopened = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [], now: () => now })
    expect(reopened.getState().conversations.map((c) => c.id)).toEqual(['recent'])
    expect(reopened.clearAllConversations()).toBe(1)
    const again = new StorageService({ dir: tmp, crypto: fakeCrypto(), seedWorkspaces: [] })
    expect(again.getState().conversations).toEqual([])
  })
})

// ---------------------------------------------------------------- 4. audit log
describe('auditLogService', () => {
  it('builds entries with the required shape and truncated prompt', () => {
    const e = buildAuditEntry({
      project: 'C:\\DuAn',
      conversationId: 'c1',
      event: 'prompt_sent',
      summary: 'x',
      ts: '2026-11-24T00:00:00.000Z',
      windowsUser: 'UBND\\canbo'
    })
    expect(e).toEqual({
      ts: '2026-11-24T00:00:00.000Z',
      windowsUser: 'UBND\\canbo',
      project: 'C:\\DuAn',
      conversationId: 'c1',
      event: 'prompt_sent',
      summary: 'x'
    })
    expect(buildAuditEntry({ project: '', conversationId: '', event: 'tool_step', summary: '' }).windowsUser).toBeTruthy()
  })

  it('round-trips encrypted lines and never stores plaintext when encrypted', () => {
    const crypto = fakeCrypto()
    const entry = buildAuditEntry({ project: 'P', conversationId: 'c', event: 'file_written', summary: 'ghi tệp', files: ['C:\\a.docx'] })
    const line = serializeAuditLine(entry, crypto)
    expect(line.startsWith('enc:')).toBe(true)
    expect(line).not.toContain('a.docx')
    expect(parseAuditLine(line, crypto)).toEqual(entry)
    expect(parseAuditLine(serializeAuditLine(entry, null), null)).toEqual(entry)
    expect(parseAuditLine('enc:@@@', crypto)).toBeNull()
  })

  it('tracker logs prompts (200 chars), tool steps, written files, approvals; exports xlsx', () => {
    const audit = new AuditLogService(tmp, fakeCrypto())
    const tracker = new AgentAuditTracker(audit)
    const longPrompt = 'Soạn công văn '.repeat(40)
    tracker.promptSent({
      conversationId: 'c1',
      messageId: 'm1',
      projectPath: 'C:\\DuAn',
      prompt: longPrompt,
      attachments: [{ type: 'file', path: 'C:\\DuAn\\a.docx', name: 'a.docx' }]
    })
    const step = {
      type: 'tool_update' as const,
      conversationId: 'c1',
      messageId: 'm1',
      toolCall: {
        stepIndex: 2,
        toolName: 'write_to_file',
        parameters: { TargetFile: 'C:\\DuAn\\out.md', CodeContent: 'NỘI DUNG BÍ MẬT DÀI' },
        state: 'DONE' as const
      }
    }
    tracker.onStreamEvent({ ...step, toolCall: { ...step.toolCall, state: 'ACTIVE' } })
    tracker.onStreamEvent(step)
    tracker.onStreamEvent(step) // duplicate DONE update is logged once
    tracker.interactionRequested({
      id: 'r1',
      kind: 'approval',
      title: 'Bấm nút Lưu',
      message: '',
      toolName: 'desktop_click',
      createdAt: 0
    })
    tracker.interactionResponded({ id: 'r1', approved: false })
    tracker.documentExported('C:\\DuAn\\vb.docx')

    const { entries, unreadable } = audit.readAll()
    expect(unreadable).toBe(0)
    expect(entries.map((e) => e.event)).toEqual([
      'prompt_sent',
      'tool_step',
      'file_written',
      'desktop_action',
      'document_exported'
    ])
    expect(entries[0].summary.length).toBeLessThanOrEqual(201)
    expect(entries[0].files).toEqual(['C:\\DuAn\\a.docx'])
    expect(entries[1].project).toBe('C:\\DuAn')
    expect(entries[2].files).toEqual(['C:\\DuAn\\out.md'])
    expect(entries[3].decision).toBe('denied')
    const rawFile = readFileSync(audit.getFilePath(), 'utf8')
    expect(rawFile).not.toContain('NỘI DUNG')
    expect(JSON.stringify(entries)).not.toContain('NỘI DUNG')

    const xlsxPath = join(tmp, 'out', 'nhat-ky.xlsx')
    const res = audit.exportToXlsx(xlsxPath)
    expect(res.rows).toBe(5)
    const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })
    expect(rows[0][0]).toBe('Thời gian')
    expect(rows).toHaveLength(6)
  })
})

// ---------------------------------------------------------------- 5. DOCX AI-draft mark
describe('DOCX export marks AI drafts in document properties', () => {
  it('sets creator/description/keywords without changing the body', async () => {
    const target = join(tmp, 'du-thao.docx')
    await exportMarkdownToDocx(target, '# CÔNG VĂN\n\nNội dung công văn.')
    const entries = readZipEntries(readFileSync(target), (n) => n === 'docProps/core.xml' || n === 'word/document.xml')
    const core = entries.get('docProps/core.xml')!.toString('utf8')
    expect(core).toContain(`<dc:creator>${AI_DRAFT_MARK}</dc:creator>`)
    expect(core).toContain(`<dc:description>${AI_DRAFT_MARK}</dc:description>`)
    expect(core).toContain('<cp:keywords>')
    const body = entries.get('word/document.xml')!.toString('utf8')
    expect(body).not.toContain('Dự thảo – có sự hỗ trợ')
    expect(body).toContain('Nội dung công văn.')
  })
})
