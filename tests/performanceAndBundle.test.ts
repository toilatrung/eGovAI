import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { describe, expect, it } from 'vitest'
import {
  AgyCliAdapter,
  buildComposedPrompt,
  buildSessionKey
} from '../src/main/services/agent/agyAdapter'
import { resolveAgyBinary } from '../src/main/services/agent/agyBinary'
import { normalizeBrowserInputUrl } from '../src/main/services/browser/inAppBrowserService'
import {
  countVietnameseWords,
  deriveLiveDraftTitle,
  extractWrittenFileFromToolCall,
  looksLikeDocumentDraft
} from '../src/renderer/src/utils/liveDraft'
import type { AgyStreamEvent, SendPromptPayload } from '../src/shared/types'

interface FakeChild {
  proc: ChildProcessWithoutNullStreams
  writtenLines: string[]
  killed: boolean
  emitStdout: (line: string) => void
  close: (code?: number) => void
}

function createFakeChild(): FakeChild {
  const ee = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const writtenLines: string[] = []

  stdin.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) writtenLines.push(line)
    }
  })

  const state = { killed: false }
  Object.assign(ee, {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    killed: false,
    kill: () => {
      state.killed = true
      ;(ee as unknown as { killed: boolean }).killed = true
      ee.emit('exit', null, 'SIGTERM')
      ee.emit('close', null, 'SIGTERM')
      return true
    }
  })

  return {
    proc: ee,
    writtenLines,
    get killed() {
      return state.killed
    },
    emitStdout(line: string) {
      stdout.write(`${line}\n`)
    },
    close(code = 0) {
      ;(ee as unknown as { exitCode: number }).exitCode = code
      ee.emit('exit', code, null)
      ee.emit('close', code, null)
    }
  }
}

function makePayload(overrides?: Partial<SendPromptPayload>): SendPromptPayload {
  return {
    conversationId: 'conv-1',
    messageId: 'msg-1',
    projectPath: 'C:\\Work\\ProjectA',
    prompt: 'Xin chào',
    modelId: 'gemini-4-neon-medium',
    effort: 'medium',
    mode: 'default',
    preferVietnameseReplies: true,
    computerUseEnabled: true,
    ...overrides
  }
}

describe('bundled agy.exe resolution', () => {
  it('prefers explicit overridePath over bundled agy.exe, and prefers bundled over system', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'egovai-agy-bundle-'))
    try {
      const resourcesDir = join(tempRoot, 'resources')
      const bundledBinDir = join(resourcesDir, 'bin')
      mkdirSync(bundledBinDir, { recursive: true })
      const exeName = process.platform === 'win32' ? 'agy.exe' : 'agy'
      const bundledExe = join(bundledBinDir, exeName)
      writeFileSync(bundledExe, 'stub')

      const overrideExe = join(tempRoot, 'custom-agy.exe')
      writeFileSync(overrideExe, 'stub')

      expect(resolveAgyBinary(overrideExe, resourcesDir)).toBe(overrideExe)
      expect(resolveAgyBinary('', resourcesDir)).toBe(bundledExe)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

describe('buildComposedPrompt session preamble deduplication', () => {
  it('omits static session preamble when omitSessionPreamble is true while keeping prompt and attachments', () => {
    const payload = makePayload({
      attachments: [{ type: 'file', name: 'bao-cao.docx', path: 'C:\\Work\\bao-cao.docx' }]
    })

    const full = buildComposedPrompt(payload)
    const compact = buildComposedPrompt(payload, { omitSessionPreamble: true })

    expect(full).toContain('Hướng dẫn ngôn ngữ')
    expect(full).toContain('Công cụ tra cứu web & điều khiển máy tính')
    expect(compact).not.toContain('Hướng dẫn ngôn ngữ')
    expect(compact).not.toContain('Công cụ tra cứu web & điều khiển máy tính')
    expect(compact).toContain('C:\\Work\\bao-cao.docx')
    expect(compact).toContain('Xin chào')
  })
})

describe('AgyCliAdapter persistent multi-turn worker pool', () => {
  it('reuses the same agy process across turns in a conversation and omits duplicate preamble on turn 2', async () => {
    const spawned: FakeChild[] = []
    const adapter = new AgyCliAdapter({
      keepAlive: true,
      idleTtlMs: 60_000,
      resolveBinaryFn: async () => 'C:\\App\\resources\\bin\\agy.exe',
      spawnFn: (() => {
        const fake = createFakeChild()
        spawned.push(fake)
        return fake.proc
      }) as unknown as typeof import('child_process').spawn
    })

    const turn1Events: AgyStreamEvent[] = []
    await adapter.sendPrompt(makePayload({ messageId: 'm1', prompt: 'Lượt 1' }), undefined, (e) =>
      turn1Events.push(e)
    )
    expect(spawned).toHaveLength(1)

    spawned[0].emitStdout(JSON.stringify({ event: 'init', conversation_id: 'agy-conv-42' }))
    spawned[0].emitStdout(
      JSON.stringify({
        event: 'result',
        result: { conversation_id: 'agy-conv-42', status: 'SUCCESS', response: 'OK 1' }
      })
    )
    expect(turn1Events.some((e) => e.type === 'result')).toBe(true)

    // Turn 2 with the same conversation & config: must reuse the exact same child process.
    const turn2Events: AgyStreamEvent[] = []
    await adapter.sendPrompt(
      makePayload({ messageId: 'm2', prompt: 'Lượt 2', agyConversationId: 'agy-conv-42' }),
      undefined,
      (e) => turn2Events.push(e)
    )
    expect(spawned).toHaveLength(1)
    expect(spawned[0].writtenLines).toHaveLength(2)

    const line1Content = JSON.parse(spawned[0].writtenLines[0]).message.content as string
    const line2Content = JSON.parse(spawned[0].writtenLines[1]).message.content as string
    expect(line1Content).toContain('Hướng dẫn ngôn ngữ')
    expect(line2Content).not.toContain('Hướng dẫn ngôn ngữ')
    expect(line2Content).toContain('Lượt 2')

    spawned[0].emitStdout(
      JSON.stringify({
        event: 'result',
        result: { conversation_id: 'agy-conv-42', status: 'SUCCESS', response: 'OK 2' }
      })
    )
    expect(turn2Events.some((e) => e.type === 'result' && e.messageId === 'm2')).toBe(true)

    adapter.abortAll()
  })

  it('spawns a new process when model changes or agyConversationId is reset (edit/resend)', async () => {
    const spawned: FakeChild[] = []
    const adapter = new AgyCliAdapter({
      keepAlive: true,
      resolveBinaryFn: async () => 'C:\\App\\resources\\bin\\agy.exe',
      spawnFn: (() => {
        const fake = createFakeChild()
        spawned.push(fake)
        return fake.proc
      }) as unknown as typeof import('child_process').spawn
    })

    await adapter.sendPrompt(makePayload({ messageId: 'm1' }), undefined, () => {})
    spawned[0].emitStdout(JSON.stringify({ event: 'init', conversation_id: 'agy-conv-1' }))
    spawned[0].emitStdout(
      JSON.stringify({ event: 'result', result: { conversation_id: 'agy-conv-1', status: 'SUCCESS' } })
    )

    // Change model -> must spawn a new worker
    await adapter.sendPrompt(
      makePayload({ messageId: 'm2', modelId: 'gemini-3.8-flash-medium', agyConversationId: 'agy-conv-1' }),
      undefined,
      () => {}
    )
    expect(spawned).toHaveLength(2)
    spawned[1].emitStdout(JSON.stringify({ event: 'init', conversation_id: 'agy-conv-1' }))
    spawned[1].emitStdout(
      JSON.stringify({ event: 'result', result: { conversation_id: 'agy-conv-1', status: 'SUCCESS' } })
    )

    // Clear agyConversationId (edit/resend) -> must spawn a fresh worker
    await adapter.sendPrompt(
      makePayload({ messageId: 'm3', modelId: 'gemini-3.8-flash-medium', agyConversationId: undefined }),
      undefined,
      () => {}
    )
    expect(spawned).toHaveLength(3)

    expect(
      buildSessionKey('agy.exe', makePayload({ effort: 'low' }))
    ).not.toBe(
      buildSessionKey('agy.exe', makePayload({ effort: 'high' }))
    )

    adapter.abortAll()
  })
})

describe('in-app browser URL normalization', () => {
  it('preserves http(s), prefixes bare domains, and turns plain queries into Google search', () => {
    expect(normalizeBrowserInputUrl('https://vbpl.vn')).toBe('https://vbpl.vn')
    expect(normalizeBrowserInputUrl('dichvucong.gov.vn/p/home')).toBe('https://dichvucong.gov.vn/p/home')
    expect(normalizeBrowserInputUrl('Nghị định 30/2020/NĐ-CP')).toBe(
      'https://www.google.com/search?q=Ngh%E1%BB%8B%20%C4%91%E1%BB%8Bnh%2030%2F2020%2FN%C4%90-CP'
    )
  })
})

describe('liveDraft realtime document helpers', () => {
  it('detects Vietnamese administrative drafts and derives clean titles', () => {
    const draft =
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\n# BÁO CÁO KẾT QUẢ CHUYỂN ĐỔI SỐ QUÝ IV\n\nKính gửi: Ủy ban nhân dân tỉnh.'
    expect(looksLikeDocumentDraft(draft)).toBe(true)
    expect(looksLikeDocumentDraft('Chào bạn, tôi có thể giúp gì?')).toBe(false)
    expect(deriveLiveDraftTitle(draft)).toBe('BÁO CÁO KẾT QUẢ CHUYỂN ĐỔI SỐ QUÝ IV')
    expect(countVietnameseWords('Ủy ban nhân dân xã')).toBe(5)
  })

  it('extracts viewable document paths and preview content from file-writing tool calls', () => {
    expect(
      extractWrittenFileFromToolCall({
        stepIndex: 1,
        toolName: 'write_file',
        state: 'ACTIVE',
        parameters: {
          Path: 'C:\\Work\\bao-cao.md',
          Content: '# Báo cáo\nNội dung đang viết...'
        }
      })
    ).toEqual({
      filePath: 'C:\\Work\\bao-cao.md',
      content: '# Báo cáo\nNội dung đang viết...'
    })

    expect(
      extractWrittenFileFromToolCall({
        stepIndex: 2,
        toolName: 'write_file',
        state: 'DONE',
        parameters: { Path: 'C:\\Work\\script.ps1' }
      })
    ).toBeNull()
  })
})
