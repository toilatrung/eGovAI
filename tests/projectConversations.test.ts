import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store talks to the main process through window.googleAI; stub what these flows touch.
const sendPrompt = vi.fn(async (_payload?: unknown) => undefined)
const listSkills = vi.fn(async (projectPath?: string | null) =>
  projectPath ? [{ id: `skill-${projectPath}`, name: 'sk', title: 'Skill', description: '' }] : []
)
const removeProject = vi.fn(async (_id?: string) => undefined)
;(globalThis as unknown as { window: unknown }).window = {
  googleAI: new Proxy(
    { sendPrompt, listSkills, removeProject },
    { get: (target, key) => (target as Record<string, unknown>)[key as string] ?? vi.fn(async () => undefined) }
  )
}

const { useAppStore } = await import('../src/renderer/src/stores/useAppStore')

function conv(id: string, projectId: string, withMessages = true): never {
  return {
    id,
    projectId,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    messages: withMessages
      ? [
          { id: `${id}-u`, role: 'user', content: 'hỏi', createdAt: 1 },
          { id: `${id}-a`, role: 'assistant', content: 'đáp', createdAt: 2, status: 'done' }
        ]
      : []
  } as never
}

function seed(): void {
  useAppStore.setState({
    projects: [
      { id: 'p1', name: 'Một', path: 'C:\\p1' } as never,
      { id: 'p2', name: 'Hai', path: 'C:\\p2' } as never
    ],
    activeProjectId: 'p1',
    activeConversationId: 'c1',
    streamingConversationIds: {},
    skills: [],
    selectedSkill: null,
    activeView: 'skills',
    conversations: [conv('c1', 'p1'), conv('c2', 'p2'), conv('c3', 'p2')]
  })
}

describe('conversations scoped to projects', () => {
  beforeEach(() => {
    sendPrompt.mockClear()
    listSkills.mockClear()
    removeProject.mockClear()
    seed()
  })

  it('newConversationInProject switches project and opens a blank conversation there', async () => {
    await useAppStore.getState().newConversationInProject('p2')
    const s = useAppStore.getState()
    expect(s.activeProjectId).toBe('p2')
    expect(s.activeConversationId).toBeNull()
    expect(s.activeView).toBe('chat')
    expect(listSkills).toHaveBeenCalledWith('C:\\p2')
    expect(s.skills.map((x) => x.id)).toEqual(['skill-C:\\p2'])
  })

  it('newConversationInProject on the active project just starts a blank conversation', async () => {
    await useAppStore.getState().newConversationInProject('p1')
    const s = useAppStore.getState()
    expect(s.activeProjectId).toBe('p1')
    expect(s.activeConversationId).toBeNull()
    expect(listSkills).not.toHaveBeenCalled()
  })

  it('newConversationInProject ignores unknown projects', async () => {
    await useAppStore.getState().newConversationInProject('nope')
    expect(useAppStore.getState().activeProjectId).toBe('p1')
    expect(useAppStore.getState().activeConversationId).toBe('c1')
  })

  it('the next message after switching is created in the new project', async () => {
    await useAppStore.getState().newConversationInProject('p2')
    await useAppStore.getState().sendMessage({ text: 'Xin chào' })
    const s = useAppStore.getState()
    const created = s.conversations.find((c) => c.id === s.activeConversationId)!
    expect(created.projectId).toBe('p2')
    expect((sendPrompt.mock.calls[0][0] as { projectPath: string }).projectPath).toBe('C:\\p2')
  })

  it('selecting a conversation from another project makes that project active', async () => {
    useAppStore.getState().selectConversation('c3')
    let s = useAppStore.getState()
    expect(s.activeProjectId).toBe('p2')
    expect(s.activeConversationId).toBe('c3')
    expect(s.activeView).toBe('chat')
    await vi.waitFor(() => expect(useAppStore.getState().skills.map((x) => x.id)).toEqual(['skill-C:\\p2']))
    // Same project: no reload of skills.
    listSkills.mockClear()
    useAppStore.getState().selectConversation('c2')
    s = useAppStore.getState()
    expect(s.activeConversationId).toBe('c2')
    expect(listSkills).not.toHaveBeenCalled()
  })

  it('a conversation keeps streaming in the background when switching project', async () => {
    useAppStore.setState({ streamingConversationIds: { c1: true } })
    await useAppStore.getState().newConversationInProject('p2')
    expect(useAppStore.getState().streamingConversationIds).toEqual({ c1: true })
    useAppStore.getState().handleStreamEvent({
      type: 'result',
      conversationId: 'c1',
      messageId: 'c1-a',
      response: 'xong'
    } as never)
    expect(useAppStore.getState().streamingConversationIds).toEqual({})
  })

  it('sendMessage runs an existing conversation in its own project folder', async () => {
    // Inconsistent state guard: the active conversation belongs to p2 while p1 is active.
    useAppStore.setState({ activeConversationId: 'c2' })
    await useAppStore.getState().sendMessage({ text: 'tiếp' })
    expect((sendPrompt.mock.calls[0][0] as { projectPath: string }).projectPath).toBe('C:\\p2')
  })

  it('removing the active project falls back to the next project and its latest conversation', async () => {
    await useAppStore.getState().removeProject('p1')
    const s = useAppStore.getState()
    expect(s.projects.map((p) => p.id)).toEqual(['p2'])
    expect(s.activeProjectId).toBe('p2')
    expect(s.activeConversationId).toBe('c2')
    expect(s.conversations.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('removing the last project leaves nothing active', async () => {
    await useAppStore.getState().removeProject('p1')
    await useAppStore.getState().removeProject('p2')
    const s = useAppStore.getState()
    expect(s.activeProjectId).toBeNull()
    expect(s.activeConversationId).toBeNull()
    expect(s.conversations).toEqual([])
  })
})
