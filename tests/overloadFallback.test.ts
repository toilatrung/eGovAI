import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { AgyCliAdapter } from '../src/main/services/agent/agyAdapter'
import { parseAgyNdjsonLine } from '../src/main/services/agent/ndjsonParser'
import {
  agyTranscriptPath,
  isOverloadError,
  pickStrongFallbackModel,
  pickSummaryModel,
  readNewOverloadErrors
} from '../src/main/services/agent/overloadFallback'
import type { AgyStreamEvent, SendPromptPayload } from '../src/shared/types'

const MODELS = [
  'gemini-4-hydrogen-high',
  'gemini-4-hydrogen-xhigh',
  'gemini-4-hydrogen-medium',
  'gemini-4-hydrogen-low',
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium'
].map((id) => ({ id }))

const OVERLOAD_MSG =
  'API error (attempt 1): transport error (Unavailable, HTTP 503): No capacity available for model gemini-4-hydrogen-medium on the server'

function errorLine(msg: string, idx: number): string {
  return (
    JSON.stringify({ step_index: idx, source: 'SYSTEM', type: 'ERROR_MESSAGE', status: 'DONE', error: msg }) +
    '\n'
  )
}

interface FakeChild {
  proc: ChildProcessWithoutNullStreams
  args: string[]
  stdinText: () => string
  killed: boolean
  emitStdout: (obj: unknown) => void
}

function createFakeChild(args: string[]): FakeChild {
  const ee = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let written = ''
  stdin.on('data', (c: Buffer) => (written += c.toString('utf8')))
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
    args,
    stdinText: () => written,
    get killed() {
      return state.killed
    },
    emitStdout: (obj) => stdout.write(JSON.stringify(obj) + '\n')
  }
}

function makePayload(overrides?: Partial<SendPromptPayload>): SendPromptPayload {
  return {
    conversationId: 'conv-1',
    messageId: 'msg-1',
    projectPath: 'C:\\Work\\ProjectA',
    prompt: 'Tạo ảnh tuyên truyền',
    modelId: 'gemini-4-hydrogen-medium',
    effort: 'medium',
    mode: 'default',
    computerUseEnabled: false,
    ...overrides
  }
}

const waitFor = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(): {
  adapter: AgyCliAdapter
  spawned: FakeChild[]
  transcript: (agyId: string) => string
} {
  const brainRoot = mkdtempSync(join(tmpdir(), 'egovai-brain-'))
  tempDirs.push(brainRoot)
  const spawned: FakeChild[] = []
  const adapter = new AgyCliAdapter({
    keepAlive: true,
    overloadPollMs: 15,
    brainRootDir: brainRoot,
    listModelsFn: async () => MODELS,
    resolveBinaryFn: async () => 'C:\\App\\agy.exe',
    spawnFn: ((_bin: string, args: string[]) => {
      const fake = createFakeChild(args)
      spawned.push(fake)
      return fake.proc
    }) as unknown as typeof import('child_process').spawn
  })
  const transcript = (agyId: string): string => {
    const p = agyTranscriptPath(brainRoot, agyId)
    mkdirSync(dirname(p), { recursive: true })
    return p
  }
  return { adapter, spawned, transcript }
}

const argValue = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe('overload helpers', () => {
  it('recognises 503 / capacity errors', () => {
    expect(isOverloadError(OVERLOAD_MSG)).toBe(true)
    expect(isOverloadError('RESOURCE_EXHAUSTED (code 429)')).toBe(true)
    expect(isOverloadError('permission denied')).toBe(false)
  })

  it('picks a cheap summary model and a strong model from another family', () => {
    expect(pickSummaryModel('gemini-4-hydrogen-medium', MODELS)).toBe('gemini-3.8-flash-medium')
    expect(pickStrongFallbackModel('gemini-4-hydrogen-medium', MODELS)).toBe('claude-sonnet-4-6')
    expect(pickSummaryModel('gemini-3.8-flash-medium', MODELS)).toBe('gemini-4-hydrogen-low')
    expect(pickStrongFallbackModel('claude-sonnet-4-6', MODELS)).toBe('gemini-4-hydrogen-medium')
    expect(pickSummaryModel('gemini-4-hydrogen-medium', [{ id: 'gemini-4-hydrogen-high' }])).toBeNull()
  })

  it('reads only new, complete overload lines from the transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'egovai-tr-'))
    tempDirs.push(dir)
    const p = join(dir, 'transcript.jsonl')
    writeFileSync(p, errorLine('old ' + OVERLOAD_MSG, 1))
    const start = readNewOverloadErrors(p, 0)
    expect(start.errors).toHaveLength(1)

    appendFileSync(p, JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'ok' }) + '\n')
    appendFileSync(p, errorLine(OVERLOAD_MSG, 3))
    appendFileSync(p, '{"type":"ERROR_MESS') // dòng dở dang
    const next = readNewOverloadErrors(p, start.offset)
    expect(next.errors).toEqual([OVERLOAD_MSG])
    expect(readNewOverloadErrors(p, next.offset).errors).toEqual([])
  })

  it('turns an overload error step on stdout into a status event', () => {
    const ev = parseAgyNdjsonLine(
      JSON.stringify({ event: 'step_update', step_update: { step_index: 8, step_type: 'error_message', error: OVERLOAD_MSG } }),
      'c',
      'm'
    )
    expect(ev?.type).toBe('status')
  })
})

describe('AgyCliAdapter overload fallback', () => {
  it('after work is done, resumes the same conversation with a cheap model just to summarise', async () => {
    const { adapter, spawned, transcript } = setup()
    const events: AgyStreamEvent[] = []
    await adapter.sendPrompt(makePayload(), undefined, (e) => events.push(e))
    const first = spawned[0]
    const tPath = transcript('agy-42')

    first.emitStdout({ event: 'init', conversation_id: 'agy-42' })
    first.emitStdout({
      event: 'step_update',
      step_update: { step_index: 1, step_type: 'tool', state: 'DONE', tool_name: 'invoke_subagent' }
    })
    await waitFor(() => events.some((e) => e.type === 'tool_update'))
    appendFileSync(tPath, errorLine(OVERLOAD_MSG, 8))

    await waitFor(() => spawned.length === 2)
    expect(first.killed).toBe(true)
    const second = spawned[1]
    expect(argValue(second.args, '--model')).toBe('gemini-3.8-flash-medium')
    expect(argValue(second.args, '--conversation')).toBe('agy-42')
    expect(argValue(second.args, '--effort')).toBe('medium')
    await waitFor(() => second.stdinText().length > 0)
    expect(second.stdinText()).toContain('KHÔNG làm lại')

    const statuses = events.filter((e) => e.type === 'status')
    expect(statuses.some((e) => e.type === 'status' && e.modelId === 'gemini-3.8-flash-medium')).toBe(true)
    // Tiến trình cũ bị dừng không được báo lỗi/aborted cho lượt này.
    expect(events.some((e) => e.type === 'error' || e.type === 'aborted')).toBe(false)

    second.emitStdout({
      event: 'step_update',
      step_update: { step_index: 12, step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Đã tạo xong poster.' }
    })
    second.emitStdout({ event: 'result', result: { conversation_id: 'agy-42', status: 'SUCCESS' } })
    await waitFor(() => events.some((e) => e.type === 'result'))
    const result = events.find((e) => e.type === 'result')
    expect(result?.messageId).toBe('msg-1')
    adapter.abortAll()
  })

  it('before any work, switches to a strong model of another family and only once', async () => {
    const { adapter, spawned, transcript } = setup()
    const events: AgyStreamEvent[] = []
    await adapter.sendPrompt(makePayload(), undefined, (e) => events.push(e))
    const tPath = transcript('agy-7')
    spawned[0].emitStdout({ event: 'init', conversation_id: 'agy-7' })
    await new Promise((r) => setTimeout(r, 30))
    appendFileSync(tPath, errorLine(OVERLOAD_MSG, 2))

    await waitFor(() => spawned.length === 2)
    expect(argValue(spawned[1].args, '--model')).toBe('claude-sonnet-4-6')
    expect(spawned[1].args).not.toContain('--effort')

    // Lượt dự phòng cũng gặp quá tải: chỉ báo trạng thái, không chuyển tiếp lần nữa.
    appendFileSync(tPath, errorLine(OVERLOAD_MSG.replace('attempt 1', 'attempt 2'), 3))
    await waitFor(() =>
      events.some((e) => e.type === 'status' && e.message.includes('tự thử lại'))
    )
    expect(spawned).toHaveLength(2)
    adapter.abortAll()
  })

  it('ignores overload errors left over from earlier turns', async () => {
    const { adapter, spawned, transcript } = setup()
    const tPath = transcript('agy-9')
    writeFileSync(tPath, errorLine(OVERLOAD_MSG, 1))
    await adapter.sendPrompt(makePayload({ agyConversationId: 'agy-9' }), undefined, () => {})
    spawned[0].emitStdout({ event: 'init', conversation_id: 'agy-9' })
    await new Promise((r) => setTimeout(r, 80))
    expect(spawned).toHaveLength(1)
    adapter.abortAll()
  })
})
