import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  ArrowDown,
  Brain,
  Cpu,
  Square,
  Paperclip,
  X,
  BookOpen,
  FolderOpen,
  CheckCircle,
  Bookmark,
  File,
  Folder,
  Monitor,
  SlidersHorizontal
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AttachedItem,
  ExecutionMode,
  ReasoningEffort,
  SkillItem,
  WorkspaceEntry
} from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'
import { usePlanStore } from '../../stores/usePlanStore'
import { MessageItem } from './MessageItem'
import { ChipSelect } from './ChipSelect'
import { EgovMark } from '../brand/EgovLogo'
import { InteractivePromptBar } from '../interaction/InteractivePromptBar'
import { useGlobalShortcuts } from '../../utils/globalShortcuts'
import {
  AI_PRESETS,
  DEFAULT_AI_PRESET,
  curateModels,
  resolveModelChoice,
  type AiPresetId
} from '../../../../shared/aiPresets'

/** Cách làm việc trong ô chat: các chế độ của lõi + "Theo kế hoạch" (soạn nhiều văn bản theo quy trình). */
export type ComposerMode = ExecutionMode | 'workflow'

const ADD_PROJECT_OPTION = '__add_project__'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

function filePathToAttachment(fullPath: string, isDirectory = false): AttachedItem {
  const parts = fullPath.split(/[\\/]/)
  const name = parts[parts.length - 1] || fullPath
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return {
    type: isDirectory ? 'folder' : IMAGE_EXTS.has(ext) ? 'image' : 'file',
    path: fullPath,
    name
  }
}

export function ChatCanvas(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    agyStatus,
    projects,
    activeProjectId,
    conversations,
    activeConversationId,
    streamingConversationIds,
    skills,
    selectedSkill,
    settings,
    computerUseStatus,
    composerDraftRequest,
    setActiveView,
    setSelectedSkill,
    updateSettings,
    createNewConversation,
    newConversationInProject,
    sendMessage,
    abortCurrentConversation,
    pickAndAddProject,
    openFileInStudio,
    clearComposerDraftRequest
  } = useAppStore()
  const createPlanFromRequest = usePlanStore((s) => s.createPlanFromRequest)

  useGlobalShortcuts()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const isStreaming = Boolean(activeConversation && streamingConversationIds[activeConversation.id])
  const isLight = settings.theme === 'light'

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachedItem[]>([])
  // U1: một ô "Chế độ AI" thay cho danh sách mô hình + mức suy luận.
  const [preset, setPreset] = useState<AiPresetId>(settings.aiPreset ?? DEFAULT_AI_PRESET)
  const useCustomModel = Boolean(settings.defaultModelId)
  const [modelFamily, setModelFamily] = useState<string>(settings.modelFamily ?? '')
  const modelFamilies = useMemo(() => curateModels(agyStatus?.models ?? []), [agyStatus?.models])
  const resolvedModel = useCustomModel
    ? { modelId: settings.defaultModelId, effort: settings.effort as ReasoningEffort }
    : resolveModelChoice(preset, modelFamily, agyStatus?.models ?? [])
  const modelId = resolvedModel.modelId
  const effort = resolvedModel.effort
  const [composerMode, setComposerMode] = useState<ComposerMode>(settings.mode)
  const mode: ExecutionMode = composerMode === 'workflow' ? 'default' : composerMode
  const setMode = (m: ExecutionMode): void => setComposerMode(m)
  const [isDragging, setIsDragging] = useState(false)

  // Slash & Mention Menus
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionEntries, setMentionEntries] = useState<WorkspaceEntry[]>([])
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)

  const viewportRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const followingLatest = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const hasMessages = Boolean(activeConversation?.messages.length)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setComposerMode(settings.mode)
  }, [settings.mode])

  useEffect(() => {
    if (settings.aiPreset) setPreset(settings.aiPreset)
  }, [settings.aiPreset])

  useEffect(() => {
    setModelFamily(settings.modelFamily ?? '')
  }, [settings.modelFamily])

  const jumpToLatest = (): void => {
    followingLatest.current = true
    setShowJumpToLatest(false)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const messages = messagesRef.current
    followingLatest.current = true
    setShowJumpToLatest(false)
    if (!viewport || !messages) return

    const trackPosition = (): void => {
      const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      followingLatest.current = distance <= 2
      setShowJumpToLatest(!followingLatest.current)
    }
    const followContent = (): void => {
      if (followingLatest.current) viewport.scrollTop = viewport.scrollHeight
      else trackPosition()
    }
    followContent()
    viewport.addEventListener('scroll', trackPosition, { passive: true })
    const observer = new ResizeObserver(followContent)
    observer.observe(messages)
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', trackPosition)
    }
  }, [activeConversationId, hasMessages])

  // Receive file + prompt sent from Auxiliary Pane (Word/Excel/Markdown Studio)
  useEffect(() => {
    if (!composerDraftRequest) return
    if (composerDraftRequest.attachment) {
      const att = composerDraftRequest.attachment
      setAttachments((prev) =>
        prev.some((x) => x.path === att.path) ? prev : [...prev, att]
      )
    }
    if (composerDraftRequest.promptText) {
      setInput(composerDraftRequest.promptText)
    }
    clearComposerDraftRequest()
    textareaRef.current?.focus()
  }, [composerDraftRequest, clearComposerDraftRequest])

  // Workspace @ mention lookup
  useEffect(() => {
    if (mentionQuery === null || !activeProject) {
      setMentionEntries([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.googleAI.searchWorkspace(activeProject.path, mentionQuery).then((res) => {
        if (!cancelled) setMentionEntries(res)
      })
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mentionQuery, activeProject])

  const featuredSkills = useMemo(() => {
    return skills.slice(0, 8)
  }, [skills])

  const skill00 = useMemo(() => {
    return skills.find((s) => s.code === '00')
  }, [skills])

  const slashItems = useMemo(() => {
    if (slashQuery === null) return []
    const q = slashQuery.toLowerCase()
    const builtIn = [
      {
        id: 'cmd-plan',
        label: '/plan',
        desc: t('chat.slashCommands.plan'),
        action: () => {
          setMode('plan')
          setInput('')
          setSlashQuery(null)
        }
      },
      {
        id: 'cmd-kynang',
        label: '/kynang',
        desc: t('chat.slashCommands.kynang'),
        action: () => {
          setInput('')
          setSlashQuery(null)
          setActiveView('skills')
        }
      },
      {
        id: 'cmd-duyet',
        label: '/duyet',
        desc: t('chat.slashCommands.duyet'),
        action: () => {
          setInput('')
          setSlashQuery(null)
          void sendMessage({
            text: t('chat.approveFinalPrompt'),
            overrideSkill: skill00 ?? null,
            modelId,
            effort,
            mode
          })
        }
      },
      {
        id: 'cmd-kiemtra',
        label: '/kiemtra',
        desc: t('chat.slashCommands.kiemtra'),
        action: () => {
          setInput('')
          setSlashQuery(null)
          void sendMessage({
            text: t('chat.quickPrompts.checkSkillsPrompt'),
            modelId,
            effort,
            mode
          })
        }
      },
      {
        id: 'cmd-moi',
        label: '/moi',
        desc: t('chat.slashCommands.moi'),
        action: () => {
          setInput('')
          setSlashQuery(null)
          createNewConversation(null)
        }
      }
    ]

    const skillCmds = skills.map((sk) => ({
      id: `sk-${sk.id}`,
      label: sk.code ? `/${sk.code} ${sk.title}` : `/${sk.name}`,
      desc: sk.description,
      action: () => {
        setSelectedSkill(sk)
        setInput('')
        setSlashQuery(null)
        textareaRef.current?.focus()
      }
    }))

    return [...builtIn, ...skillCmds]
      .filter((item) => item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q))
      .slice(0, 10)
  }, [
    slashQuery,
    skills,
    skill00,
    t,
    setActiveView,
    setSelectedSkill,
    createNewConversation,
    sendMessage,
    modelId,
    effort,
    mode
  ])

  const handleInputChange = (val: string): void => {
    setInput(val)

    // Detect leading "/" for Slash menu
    if (val.startsWith('/') && !val.includes('\n')) {
      setSlashQuery(val.slice(1))
      setMentionQuery(null)
      return
    }
    setSlashQuery(null)

    // Detect "@query" at end of input for workspace file mention
    const mentionMatch = val.match(/(?:^|\s)@([^\s@]*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
    } else {
      setMentionQuery(null)
    }
  }

  const handleSelectMention = (entry: WorkspaceEntry): void => {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === entry.fullPath)) return prev
      return [...prev, filePathToAttachment(entry.fullPath, entry.isDirectory)]
    })
    setInput((prev) => prev.replace(/(?:^|\s)@([^\s@]*)$/, ' ').trimStart())
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  const handlePickFiles = async (): Promise<void> => {
    const picked = await window.googleAI.pickFiles(activeProject?.path)
    if (picked.length === 0) return
    setAttachments((prev) => {
      const next = [...prev]
      for (const p of picked) {
        if (!next.some((a) => a.path === p)) {
          next.push(filePathToAttachment(p))
        }
      }
      return next
    })
    // Also open the picked document directly in the Tài liệu & Excel pane
    for (const p of picked) {
      await openFileInStudio(p)
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!activeProject || isStreaming) return
    const text = input.trim()
    if (!text) return

    const currentAttachments = [...attachments]
    setInput('')
    setAttachments([])
    setSlashQuery(null)
    setMentionQuery(null)
    // B6: vừa gửi thì luôn theo dõi câu trả lời mới.
    jumpToLatest()

    if (composerMode === 'workflow') {
      await createPlanFromRequest(text, currentAttachments, { modelId: modelId || undefined, effort })
      return
    }

    await sendMessage({
      text,
      attachments: currentAttachments,
      modelId: modelId || undefined,
      effort,
      mode
    })
  }

  const menuOpen =
    (slashQuery !== null && slashItems.length > 0) ||
    (mentionQuery !== null && mentionEntries.length > 0)
  const menuLength = slashQuery !== null ? slashItems.length : mentionEntries.length

  useEffect(() => {
    setMenuIndex(0)
  }, [slashQuery, mentionQuery])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      setSlashQuery(null)
      setMentionQuery(null)
      return
    }
    if (menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setMenuIndex((i) => (i + step + menuLength) % menuLength)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (slashItems.length > 0 && slashQuery !== null) {
        slashItems[Math.min(menuIndex, slashItems.length - 1)].action()
        return
      }
      if (mentionEntries.length > 0 && mentionQuery !== null) {
        handleSelectMention(mentionEntries[Math.min(menuIndex, mentionEntries.length - 1)])
        return
      }
      void handleSend()
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const added: AttachedItem[] = []
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        added.push(filePathToAttachment(filePath))
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => {
        const next = [...prev]
        for (const item of added) {
          if (!next.some((x) => x.path === item.path)) next.push(item)
        }
        return next
      })
      for (const item of added) {
        if (item.type !== 'folder') {
          void openFileInStudio(item.path)
        }
      }
    }
  }

  const handlePickSkillCard = (skill: SkillItem): void => {
    setSelectedSkill(skill)
    textareaRef.current?.focus()
  }

  // A conversation belongs to one project, so switching project always opens a fresh
  // conversation there; the text being typed stays in the composer.
  const handlePickProject = (value: string): void => {
    if (value === ADD_PROJECT_OPTION) {
      void pickAndAddProject()
    } else if (value !== activeProjectId) {
      void newConversationInProject(value)
    }
  }

  const canSend =
    Boolean(activeProject) &&
    Boolean(input.trim()) &&
    !isStreaming &&
    Boolean(agyStatus?.installed && agyStatus?.authenticated)

  const hour = new Date().getHours()
  const greeting =
    hour < 11
      ? t('chat.greeting.morning')
      : hour < 14
        ? t('chat.greeting.noon')
        : hour < 18
          ? t('chat.greeting.afternoon')
          : t('chat.greeting.evening')

  const quickPrompts = [
    {
      id: 'workdir',
      icon: FolderOpen,
      title: t('chat.quickPrompts.selectWorkDir'),
      hint: t('chat.quickPrompts.selectWorkDirHint'),
      text: t('chat.quickPrompts.selectWorkDirPrompt')
    },
    {
      id: 'check',
      icon: CheckCircle,
      title: t('chat.quickPrompts.checkSkills'),
      hint: t('chat.quickPrompts.checkSkillsHint', { count: skills.length }),
      text: t('chat.quickPrompts.checkSkillsPrompt')
    }
  ]


  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-surface"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand-soft">
          <div className="rounded-xl bg-surface px-5 py-3 text-sm font-medium text-ink shadow-float">
            Thả tệp hoặc hồ sơ vào đây để đính kèm vào yêu cầu
          </div>
        </div>
      )}

      {/* Scrollable welcome / messages */}
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto">
        {!activeProject ? (
          <div className="mx-auto flex h-full max-w-[520px] flex-col items-center justify-center px-5 text-center">
            <EgovMark size={64} className="egov-enter mb-5" />
            <h1 className="egov-enter egov-enter-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-balance">
              {t('chat.welcomeTitle')}
            </h1>
            <p className="egov-enter egov-enter-1 mt-2 text-[15px] text-muted">{t('chat.selectProjectFirst')}</p>
            <button
              onClick={() => void pickAndAddProject()}
              className="press egov-enter egov-enter-2 mt-6 flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white hover:brightness-110"
            >
              <FolderOpen className="h-4 w-4" />
              <span>{t('sidebar.addProject')}</span>
            </button>
          </div>
        ) : !activeConversation || activeConversation.messages.length === 0 ? (
          <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-5 pb-6 pt-[clamp(28px,7vh,72px)]">
            <section className="egov-enter">
              <p
                className="mb-3 flex min-w-0 items-center gap-1.5 text-[12.5px] text-faint"
                title={activeProject.path}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                <span className="shrink-0">{t('chat.inProject')}</span>
                <span className="min-w-0 truncate font-medium text-muted">{activeProject.name}</span>
              </p>
              <h1 className="mb-2.5 font-display text-[clamp(26px,3.2vw,34px)] font-semibold leading-[1.12] tracking-[-0.02em] text-balance">
                {greeting} <span className="text-faint">{t('chat.welcomeQuestion')}</span>
              </h1>
              <p className="max-w-[56ch] text-[15px] text-muted text-pretty">{t('chat.welcomeSubtitle')}</p>
            </section>

            {activeProject.hasIndexRouter && (
              <section className="egov-enter egov-enter-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Gợi ý nhanh">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp.id}
                    onClick={() =>
                      void sendMessage({ text: qp.text, modelId: modelId || undefined, effort, mode })
                    }
                    className="press group flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left hover:border-line-strong hover:bg-canvas"
                  >
                    <qp.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted group-hover:text-brand" />
                    <span className="min-w-0">
                      <b className="mb-0.5 block text-[13.5px] font-medium">{qp.title}</b>
                      <small className="block text-[12.5px] leading-snug text-faint">{qp.hint}</small>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {featuredSkills.length > 0 && (
              <section className="egov-enter egov-enter-2">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <h2 className="text-[13px] font-semibold">{t('chat.featuredSkills')}</h2>
                  <button
                    onClick={() => setActiveView('skills')}
                    className="text-[12.5px] text-brand hover:underline"
                  >
                    {t('chat.viewAllSkills', { count: skills.length })}
                  </button>
                </div>
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  {featuredSkills.map((sk, i) => {
                    const isPicked = selectedSkill?.id === sk.id
                    return (
                      <button
                        key={sk.id}
                        onClick={() => handlePickSkillCard(sk)}
                        aria-pressed={isPicked}
                        className={`group grid w-full grid-cols-[44px_1fr_auto] items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 ${
                          i > 0 ? 'border-t border-line' : ''
                        } ${isPicked ? 'bg-brand-soft' : 'hover:bg-canvas'}`}
                      >
                        <span
                          className={`rounded-md py-1 text-center font-mono text-[12px] font-medium ${
                            isPicked ? 'bg-brand text-white' : 'bg-sunken text-muted'
                          }`}
                        >
                          {sk.code ?? '—'}
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] font-medium">{sk.title}</b>
                          <small className="block truncate text-[12px] text-faint">
                            {sk.category || sk.description}
                          </small>
                        </span>
                        <span
                          className={`text-[12.5px] text-brand transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] ${
                            isPicked
                              ? 'opacity-100'
                              : 'translate-x-[-4px] opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100'
                          }`}
                        >
                          {isPicked ? 'Đang chọn' : 'Dùng →'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div ref={messagesRef} className="mx-auto max-w-[760px] space-y-6 px-5 pb-6 pt-6">
            {activeConversation.messages.map((msg, i, all) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isLight={isLight}
                isLast={i === all.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* Docked composer */}
      <div className="egov-dock-fade relative shrink-0 px-5 pb-4">
        {showJumpToLatest && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink shadow-float hover:bg-sunken"
          >
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
            {t('chat.jumpToLatest')}
          </button>
        )}
        <div className="relative mx-auto max-w-[680px]">
          <InteractivePromptBar />

          {activeProject?.hasIndexRouter &&
            activeConversation &&
            activeConversation.messages.length > 0 &&
            !isStreaming && (
              <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => setActiveView('skills')}
                  className="press flex h-7 items-center gap-1.5 rounded-md border border-line px-3 text-[12px] text-muted hover:bg-sunken hover:text-ink"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Chọn nghiệp vụ khác</span>
                </button>
                <button
                  onClick={() =>
                    void sendMessage({
                      text: t('chat.approveFinalPrompt'),
                      overrideSkill: skill00 ?? null,
                      modelId: modelId || undefined,
                      effort,
                      mode
                    })
                  }
                  className="press flex h-7 items-center gap-1.5 rounded-md bg-ok-soft px-3 text-[12px] font-medium text-ok hover:brightness-95"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>{t('chat.approveFinalOutput')}</span>
                </button>
              </div>
            )}

          {/* Slash command menu */}
          {slashQuery !== null && slashItems.length > 0 && (
            <div
              role="listbox"
              aria-label="Lệnh nhanh"
              className="egov-pop absolute bottom-full left-2 z-20 mb-2 max-h-72 w-[min(420px,calc(100%-16px))] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 text-ink "
            >
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-faint">
                Lệnh nhanh
              </div>
              {slashItems.map((item, i) => (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={i === menuIndex}
                  onMouseEnter={() => setMenuIndex(i)}
                  onClick={item.action}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                    i === menuIndex ? 'bg-sunken' : ''
                  }`}
                >
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-[11.5px] text-brand">{item.label}</span>
                  <span className={`min-w-0 truncate ${i === menuIndex ? 'text-ink' : 'text-muted'}`}>
                    {item.desc}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* @ file mention menu */}
          {mentionQuery !== null && mentionEntries.length > 0 && (
            <div
              role="listbox"
              aria-label="Tệp trong dự án"
              className="egov-pop absolute bottom-full left-2 z-20 mb-2 max-h-72 w-[min(480px,calc(100%-16px))] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 text-ink "
            >
              {mentionEntries.map((entry, i) => (
                <button
                  key={entry.fullPath}
                  role="option"
                  aria-selected={i === menuIndex}
                  onMouseEnter={() => setMenuIndex(i)}
                  onClick={() => handleSelectMention(entry)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                    i === menuIndex ? 'bg-sunken' : ''
                  }`}
                >
                  {entry.isDirectory ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-gold-ink" />
                  ) : (
                    <File className="h-3.5 w-3.5 shrink-0 text-muted" />
                  )}
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint">{entry.relativePath}</span>
                </button>
              ))}
            </div>
          )}

          {/* Thanh thư mục làm việc nằm ngang ngay phía trên khung chat */}
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-line bg-surface/80 px-2 py-1">
            <ChipSelect
              label={t('chat.project')}
              icon={Folder}
              value={activeProjectId ?? ''}
              placeholder={t('chat.selectProject')}
              tooltip={
                activeProject
                  ? `${t('chat.projectTooltip', { path: activeProject.path })}\n${t('chat.switchProjectHint')}`
                  : t('chat.selectProject')
              }
              onChange={handlePickProject}
              options={[
                ...projects.map((p) => ({ value: p.id, label: p.name, short: p.name, hint: p.path })),
                {
                  value: ADD_PROJECT_OPTION,
                  label: t('chat.addProjectOption'),
                  short: t('chat.addProjectOption'),
                  hint: t('chat.addProjectHint')
                }
              ]}
            />
            {activeProject?.path && (
              <span
                title={activeProject.path}
                className="min-w-0 flex-1 truncate text-[11.5px] text-faint"
              >
                {activeProject.path}
              </span>
            )}
          </div>

          {/* Composer card */}
          <div className="rounded-2xl border border-line-strong bg-surface transition-[box-shadow,border-color] duration-200 ease-[var(--ease-out-strong)] focus-within:border-brand/45 focus-within:shadow-[0_0_0_3px_var(--egov-brand-soft)]">
            {(selectedSkill || attachments.length > 0) && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {selectedSkill && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-soft py-1 pl-2.5 pr-1 text-[12px] font-medium text-brand">
                    <Bookmark className="h-3 w-3" />
                    <span className="max-w-[320px] truncate">
                      {selectedSkill.code ? `${selectedSkill.code} · ` : ''}
                      {selectedSkill.title}
                    </span>
                    <button
                      onClick={() => setSelectedSkill(null)}
                      title={t('chat.clearSkill')}
                      className="rounded-md p-0.5 hover:bg-brand/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {attachments.map((att) => (
                  <span
                    key={att.path}
                    className="inline-flex items-center gap-1.5 rounded-md bg-sunken py-1 pl-2.5 pr-1 text-[12px] text-muted"
                    title={`Bấm để xem trong Tài liệu: ${att.path}`}
                  >
                    <button
                      onClick={() => att.type !== 'folder' && void openFileInStudio(att.path)}
                      className="flex items-center gap-1.5 hover:text-ink"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="max-w-[180px] truncate">{att.name}</span>
                    </button>
                    <button
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== att.path))}
                      className="rounded-md p-0.5 hover:bg-black/5"
                      title="Bỏ tệp đính kèm"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              id="composer-input"
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!activeProject}
              rows={2}
              placeholder={activeProject ? t('chat.placeholder') : t('chat.needProjectToSend')}
              aria-label="Yêu cầu"
              className="block max-h-48 w-full resize-none bg-transparent px-4 pb-1.5 pt-3.5 text-[14.5px] leading-normal text-ink outline-none placeholder:text-faint disabled:opacity-50"
            />

            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1.5">
              <button
                onClick={() => void handlePickFiles()}
                disabled={!activeProject}
                title={t('chat.attachFile')}
                className="press flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              {!useCustomModel && modelFamilies.length > 0 && (
                <ChipSelect
                  label="Mô hình"
                  icon={Cpu}
                  value={modelFamilies.some((fam) => fam.base === modelFamily) ? modelFamily : ''}
                  onChange={(v) => {
                    setModelFamily(v)
                    void updateSettings({ modelFamily: v })
                  }}
                  options={[
                    {
                      value: '',
                      label: 'eGovAI Autopilot',
                      short: 'eGovAI Autopilot',
                      hint: 'Tự chọn mô hình phù hợp với Chế độ AI và công việc (khuyên dùng)'
                    },
                    ...modelFamilies.map((fam) => ({ value: fam.base, label: fam.label }))
                  ]}
                />
              )}

              {useCustomModel ? (
                <ChipSelect
                  label="Mô hình (Cài đặt nâng cao)"
                  icon={Cpu}
                  value="custom"
                  onChange={() => setActiveView('settings')}
                  options={[
                    {
                      value: 'custom',
                      label:
                        agyStatus?.models.find((m) => m.id === settings.defaultModelId)?.name ??
                        settings.defaultModelId,
                      short: 'Mô hình riêng',
                      hint: 'Đang dùng mô hình chọn trong Cài đặt. Bỏ chọn ở Cài đặt để dùng Chế độ AI.'
                    }
                  ]}
                />
              ) : (
                <ChipSelect<AiPresetId>
                  label="Chế độ AI"
                  icon={Brain}
                  value={preset}
                  onChange={(v) => {
                    setPreset(v)
                    void updateSettings({ aiPreset: v })
                  }}
                  options={AI_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
                />
              )}

              <ChipSelect<ComposerMode>
                label="Cách làm"
                icon={SlidersHorizontal}
                value={composerMode}
                onChange={setComposerMode}
                options={[
                  { value: 'default', label: 'Trò chuyện', short: 'Trò chuyện', hint: 'Hỏi đáp, soạn từng văn bản' },
                  {
                    value: 'workflow',
                    label: 'Theo kế hoạch',
                    short: 'Theo kế hoạch',
                    hint: 'Lập danh sách nhiều văn bản rồi soạn lần lượt (tab Kế hoạch)'
                  },
                  { value: 'plan', label: 'Chỉ lên phương án', short: 'Lên phương án', hint: 'AI đề xuất cách làm, không sửa tệp' },
                  { value: 'accept-edits', label: 'Tự sửa tệp', short: 'Tự sửa tệp', hint: 'AI được sửa tệp trong dự án mà không hỏi lại' }
                ]}
              />

              {isStreaming ? (
                <button
                  onClick={() => void abortCurrentConversation()}
                  title={t('chat.stop')}
                  className="press ml-auto flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-medium text-surface hover:opacity-90"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>{t('chat.stop')}</span>
                </button>
              ) : (
                <button
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  title={activeProject ? t('chat.send') : t('chat.needProjectToSend')}
                  aria-label={activeProject ? t('chat.send') : t('chat.needProjectToSend')}
                  className="press ml-auto flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white hover:brightness-110 disabled:bg-sunken disabled:text-faint"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 hidden flex-wrap justify-center gap-3.5 text-[11.5px] text-faint md:flex">
            {[
              ['Enter', 'gửi'],
              ['Shift Enter', 'xuống dòng'],
              ['/', 'lệnh nhanh'],
              ['@', 'đính kèm tệp'],
              ['Ctrl N', 'hội thoại mới'],
              ['Ctrl K', 'tìm hội thoại']
            ].map(([k, label]) => (
              <span key={k}>
                <kbd className="rounded bg-sunken px-1.5 py-px font-mono text-[11px] text-muted">{k}</kbd> {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
