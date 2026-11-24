import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store talks to the main process through window.googleAI; stub just what a turn needs.
const sendPrompt = vi.fn(async (_payload?: unknown) => undefined)
const saveConversation = vi.fn(async (_conv?: unknown) => undefined)
;(globalThis as unknown as { window: unknown }).window = {
  googleAI: new Proxy(
    { sendPrompt, saveConversation },
    { get: (target, key) => (target as Record<string, unknown>)[key as string] ?? vi.fn(async () => undefined) }
  )
}

const { useAppStore } = await import('../src/renderer/src/stores/useAppStore')

function seed(): void {
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'test', path: 'C:\\proj' } as never],
    activeProjectId: 'p1',
    activeConversationId: 'c1',
    streamingConversationIds: {},
    skills: [],
    conversations: [
      {
        id: 'c1',
        projectId: 'p1',
        title: 'Hello',
        createdAt: 1,
        updatedAt: 1,
        agyConversationId: 'agy-old',
        messages: [
          { id: 'u1', role: 'user', content: 'Câu hỏi đầu', createdAt: 1 },
          { id: 'a1', role: 'assistant', content: 'Trả lời đầu', createdAt: 2, status: 'done' },
          { id: 'u2', role: 'user', content: 'Bật Zalo và nhắn: hello', createdAt: 3 },
          { id: 'a2', role: 'assistant', content: 'Lỗi', createdAt: 4, status: 'error' }
        ]
      } as never
    ]
  })
}

describe('editAndResend', () => {
  beforeEach(() => {
    sendPrompt.mockClear()
    saveConversation.mockClear()
    seed()
  })

  it('re-sends even when the text is unchanged (acts as retry)', async () => {
    await useAppStore.getState().editAndResend('u2', 'Bật Zalo và nhắn: hello')
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    const conv = useAppStore.getState().conversations.find((c) => c.id === 'c1')!
    // Earlier turns kept, the edited turn replaced, a fresh assistant reply streaming.
    expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(conv.messages[2].content).toBe('Bật Zalo và nhắn: hello')
    expect(conv.messages[3].status).toBe('streaming')
  })

  it('drops later messages and starts a new core thread with replayed history', async () => {
    await useAppStore.getState().editAndResend('u1', 'Câu hỏi đã sửa')
    const payload = sendPrompt.mock.calls[0][0] as { prompt: string; agyConversationId?: string }
    expect(payload.agyConversationId).toBeUndefined()
    expect(payload.prompt).toContain('Câu hỏi đã sửa')
    const conv = useAppStore.getState().conversations.find((c) => c.id === 'c1')!
    expect(conv.messages).toHaveLength(2)
  })

  it('does nothing while the conversation is still streaming', async () => {
    useAppStore.setState({ streamingConversationIds: { c1: true } })
    await useAppStore.getState().editAndResend('u2', 'khác')
    expect(sendPrompt).not.toHaveBeenCalled()
  })
})

describe('settleInterruptedTurns', () => {
  it('turns replies left streaming by a closed app into aborted ones', async () => {
    const { settleInterruptedTurns } = await import('../src/renderer/src/stores/useAppStore')
    const untouched = { id: 'a', messages: [{ id: 'm', role: 'assistant', status: 'done' }] } as never
    const stuck = { id: 'b', messages: [{ id: 'n', role: 'assistant', status: 'streaming' }] } as never
    const [a, b] = settleInterruptedTurns([untouched, stuck])
    expect(a).toBe(untouched)
    expect((b as { messages: { status: string }[] }).messages[0].status).toBe('aborted')
  })
})

describe('renameConversation', () => {
  beforeEach(seed)

  it('collapses whitespace without eating the letter s', async () => {
    await useAppStore.getState().renameConversation('c1', '  Kế hoạch   năm học  sơ kết ')
    expect(useAppStore.getState().conversations[0].title).toBe('Kế hoạch năm học sơ kết')
  })
})
