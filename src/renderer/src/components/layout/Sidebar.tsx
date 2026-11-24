import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  FolderPlus,
  Folder,
  MessageSquare,
  Trash2,
  BookOpen,
  Settings,
  Sliders,
  Clock,
  Search,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  FileDown,
  FileText
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/useAppStore'
import type { Conversation } from '../../../../shared/types'
import {
  conversationToMarkdown,
  exportFileBaseName,
  searchConversations
} from '../../utils/conversationTools'
import { SIDEBAR_SEARCH_ID, useGlobalShortcuts } from '../../utils/globalShortcuts'

const sectionLabel =
  'flex h-6 items-center justify-between px-2.5 mb-1 text-[12px] font-medium text-faint'

const menuItem =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sunken'

interface FloatingMenu {
  kind: 'project' | 'conv'
  id: string
  width: number
  left: number
  top?: number
  bottom?: number
}

/** Row action buttons stay hidden until the row is hovered, focused or its menu is open. */
function rowAction(visible: boolean): string {
  return `shrink-0 rounded-md p-1 text-faint hover:bg-line hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 ${
    visible ? 'opacity-100' : 'opacity-0'
  }`
}

function navItem(active: boolean): string {
  return `press flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] ${
    active ? 'bg-sunken font-medium text-ink' : 'text-muted hover:bg-sunken/60 hover:text-ink'
  }`
}

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    projects,
    activeProjectId,
    conversations,
    activeConversationId,
    streamingConversationIds,
    skills,
    activeView,
    scheduledTasks,
    setActiveView,
    setAuxTab,
    pickAndAddProject,
    selectProject,
    removeProject,
    createNewConversation,
    selectConversation,
    deleteConversation,
    renameConversation
  } = useAppStore()

  useGlobalShortcuts()

  const [search, setSearch] = useState('')
  // One floating row menu at a time. It is positioned `fixed` from the trigger's rect so the
  // scrolling project/conversation lists never clip it or grow a scrollbar.
  const [menu, setMenu] = useState<FloatingMenu | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false)
  const menuId = menu?.kind === 'conv' ? menu.id : null
  const projectMenuId = menu?.kind === 'project' ? menu.id : null
  const setMenuId = (id: string | null): void => setMenu(id ? (menu?.id === id ? null : menu) : null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const openMenu = (kind: FloatingMenu['kind'], id: string, trigger: HTMLElement): void => {
    if (menu?.id === id) {
      setMenu(null)
      return
    }
    const r = trigger.getBoundingClientRect()
    const width = kind === 'project' ? 220 : 200
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    const openUp = r.bottom > window.innerHeight - 220
    setConfirmDeleteProject(false)
    setMenu({
      kind,
      id,
      width,
      left,
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 })
    })
  }

  const searchHits = useMemo(() => {
    const filtered = conversations.filter((c) => c.projectId === activeProjectId)
    return searchConversations(filtered, search)
  }, [conversations, activeProjectId, search])

  const activeProjectPath = projects.find((p) => p.id === activeProjectId)?.path ?? ''

  // Close the row menu on outside click or Esc.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (menuRef.current?.contains(target) || target.closest('[data-menu-trigger]')) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    // The menu is pinned to where the trigger was; close it if the list scrolls or the window resizes.
    const onMove = (): void => setMenu(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    document.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('scroll', onMove, true)
    }
  }, [menu])

  const startRename = (conv: Conversation): void => {
    setMenuId(null)
    setRenameDraft(conv.title)
    setRenamingId(conv.id)
  }

  const commitRename = (): void => {
    if (renamingId) void renameConversation(renamingId, renameDraft)
    setRenamingId(null)
  }

  const exportMarkdown = (conv: Conversation): void => {
    setMenuId(null)
    const blob = new Blob([conversationToMarkdown(conv)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportFileBaseName(conv.title)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const exportWord = async (conv: Conversation): Promise<void> => {
    setMenuId(null)
    try {
      const res = await window.googleAI.exportDocx(
        exportFileBaseName(conv.title),
        activeProjectPath,
        conversationToMarkdown(conv)
      )
      if (res?.path) void window.googleAI.revealInExplorer(res.path)
    } catch (err) {
      window.alert(`Không xuất được tệp Word: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const activeTasks = scheduledTasks.filter((x) => x.projectId === activeProjectId && x.enabled).length

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col gap-5 border-r border-line bg-canvas px-2.5 py-3.5 text-ink">
      <button
        onClick={() => createNewConversation(null)}
        disabled={!activeProjectId}
        className="press flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[13.5px] font-medium hover:bg-sunken disabled:opacity-45"
      >
        <Plus className="h-4 w-4 text-brand" />
        <span>{t('sidebar.newConversation')}</span>
      </button>

      {/* Projects */}
      <div className="flex flex-col">
        <div className={sectionLabel}>
          <span>{t('sidebar.projects')}</span>
          <button
            onClick={() => void pickAndAddProject()}
            title={t('sidebar.addProject')}
            aria-label={t('sidebar.addProject')}
            className="press -mr-1 flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-sunken hover:text-ink"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {projects.length === 0 ? (
          <button
            onClick={() => void pickAndAddProject()}
            className="press flex items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-2.5 py-2 text-[13px] text-muted hover:border-brand hover:text-brand"
          >
            <FolderPlus className="h-[15px] w-[15px] shrink-0" />
            <span>{t('sidebar.addProject')}</span>
          </button>
        ) : (
          <div className="-mx-1 flex max-h-[176px] flex-col gap-px overflow-y-auto px-1 [scrollbar-gutter:stable]">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId
              return (
                <div
                  key={proj.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive}
                  onClick={() => void selectProject(proj.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && e.key === 'Enter') void selectProject(proj.id)
                  }}
                  title={proj.path}
                  className={`group cursor-pointer ${navItem(isActive)}`}
                >
                  <Folder className={`h-[15px] w-[15px] shrink-0 ${isActive ? 'text-brand' : 'opacity-75'}`} />
                  <span className="min-w-0 flex-1 truncate">{proj.name}</span>
                  {(proj.skillCount ?? 0) > 0 && (
                    <span
                      className={`tabular shrink-0 text-[12px] text-faint group-hover:hidden ${projectMenuId === proj.id ? 'hidden' : ''}`}
                      title={t('sidebar.skillsCount', { count: proj.skillCount })}
                    >
                      {proj.skillCount}
                    </span>
                  )}
                  <button
                    type="button"
                    data-menu-trigger
                    onClick={(e) => {
                      e.stopPropagation()
                      openMenu('project', proj.id, e.currentTarget)
                    }}
                    title="Tùy chọn dự án"
                    aria-label={`Tùy chọn dự án ${proj.name}`}
                    aria-haspopup="menu"
                    aria-expanded={projectMenuId === proj.id}
                    className={`-my-1 -mr-1 ${rowAction(projectMenuId === proj.id)}`}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={sectionLabel}>
          <span>{t('sidebar.conversations')}</span>
          <span className="tabular">{searchHits.length}</span>
        </div>

        <label className="mb-1.5 flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-faint focus-within:border-line-strong">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            id={SIDEBAR_SEARCH_ID}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch('')
                e.currentTarget.blur()
              }
            }}
            title="Tìm theo tên và nội dung hội thoại (Ctrl K)"
            placeholder={t('sidebar.searchConversations')}
            className="w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden shrink-0 rounded bg-sunken px-1 font-mono text-[10.5px] text-faint lg:block">
            Ctrl K
          </kbd>
        </label>

        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
          {searchHits.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12.5px] text-faint">
              {search.trim() ? 'Không tìm thấy hội thoại phù hợp.' : t('sidebar.noConversations')}
            </div>
          ) : (
            searchHits.map(({ conversation: conv, snippet }) => {
              const isSelected = activeView === 'chat' && conv.id === activeConversationId
              const isStreaming = Boolean(streamingConversationIds[conv.id])
              const isRenaming = renamingId === conv.id
              const menuOpen = menuId === conv.id

              if (isRenaming) {
                return (
                  <div key={conv.id} className="flex items-center gap-2.5 rounded-md bg-sunken px-2.5 py-1">
                    <Pencil className="h-[13px] w-[13px] shrink-0 text-faint" />
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitRename()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setRenamingId(null)
                        }
                      }}
                      aria-label="Tên hội thoại"
                      maxLength={120}
                      className="h-6 min-w-0 flex-1 rounded-[6px] border border-line-strong bg-surface px-1.5 text-[13px] text-ink outline-none focus:border-brand"
                    />
                  </div>
                )
              }

              return (
                <div key={conv.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectConversation(conv.id)}
                    onDoubleClick={() => startRename(conv)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') selectConversation(conv.id)
                      else if (e.key === 'F2') startRename(conv)
                    }}
                    title={`${conv.title} — bấm đúp để đổi tên`}
                    className={`group cursor-pointer ${navItem(isSelected)} ${snippet ? 'items-start' : ''}`}
                  >
                    {isStreaming ? (
                      <Loader2 className={`h-[15px] w-[15px] shrink-0 animate-spin text-brand ${snippet ? 'mt-0.5' : ''}`} />
                    ) : (
                      <MessageSquare className={`h-[15px] w-[15px] shrink-0 opacity-75 ${snippet ? 'mt-0.5' : ''}`} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{conv.title}</span>
                      {snippet && (
                        <span className="line-clamp-2 text-[12px] font-normal leading-snug text-faint">
                          {snippet.before}
                          <mark className="rounded-[3px] bg-brand-soft px-0.5 text-brand">{snippet.match}</mark>
                          {snippet.after}
                        </span>
                      )}
                    </span>
                    <button
                      data-menu-trigger
                      onClick={(e) => {
                        e.stopPropagation()
                        openMenu('conv', conv.id, e.currentTarget)
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title="Tùy chọn hội thoại"
                      aria-label="Tùy chọn hội thoại"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className={`-my-1 -mr-1 ${rowAction(menuOpen)}`}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Footer navigation */}
      <nav className="flex flex-col gap-px border-t border-line pt-3">
        <button onClick={() => setActiveView('skills')} className={navItem(activeView === 'skills')}>
          <BookOpen className="h-[15px] w-[15px] shrink-0 opacity-80" />
          <span className="flex-1 truncate">{t('sidebar.skillsHub')}</span>
          {skills.length > 0 && <span className="tabular text-[11.5px] text-faint">{skills.length}</span>}
        </button>
        <button onClick={() => setActiveView('customizations')} className={navItem(activeView === 'customizations')}>
          <Sliders className="h-[15px] w-[15px] shrink-0 opacity-80" />
          <span className="flex-1 truncate">Quy tắc &amp; Cấu hình</span>
        </button>
        <button onClick={() => setAuxTab('tasks')} className={navItem(false)}>
          <Clock className="h-[15px] w-[15px] shrink-0 opacity-80" />
          <span className="flex-1 truncate">Tác vụ định kỳ</span>
          {activeTasks > 0 && <span className="tabular text-[11.5px] text-faint">{activeTasks}</span>}
        </button>
        <button onClick={() => setActiveView('settings')} className={navItem(activeView === 'settings')}>
          <Settings className="h-[15px] w-[15px] shrink-0 opacity-80" />
          <span className="flex-1 truncate">{t('sidebar.settings')}</span>
        </button>
      </nav>

      {menu && (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: menu.left, top: menu.top, bottom: menu.bottom, width: menu.width }}
          className={`egov-pop fixed z-50 rounded-[10px] border border-line-strong bg-surface p-1 text-[13px] text-ink shadow-float ${
            menu.bottom !== undefined ? '[transform-origin:bottom_right]' : '[transform-origin:top_right]'
          }`}
        >
          {menu.kind === 'project'
            ? (() => {
                const proj = projects.find((p) => p.id === menu.id)
                if (!proj) return null
                if (confirmDeleteProject) {
                  return (
                    <div className="p-1.5">
                      <p className="text-[13px] font-medium">Xóa dự án “{proj.name}”?</p>
                      <p className="mt-1 text-[12px] leading-snug text-muted">
                        Hội thoại và tác vụ định kỳ của dự án bị xóa khỏi eGovAI. Thư mục trên máy vẫn giữ nguyên.
                      </p>
                      <div className="mt-2.5 flex justify-end gap-1.5">
                        <button
                          onClick={() => setConfirmDeleteProject(false)}
                          className="press h-7 rounded-md px-2.5 text-[12.5px] text-muted hover:bg-sunken hover:text-ink"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={() => {
                            setMenu(null)
                            void removeProject(proj.id).catch(() => {
                              window.alert(`Không thể lưu thay đổi khi xóa dự án "${proj.name}". Vui lòng thử lại.`)
                            })
                          }}
                          className="press h-7 rounded-md bg-red-600 px-2.5 text-[12.5px] font-medium text-white hover:bg-red-700"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  )
                }
                return (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null)
                        void window.googleAI.openPath(proj.path)
                      }}
                      className={menuItem}
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted" />
                      <span>{t('sidebar.openFolder')}</span>
                    </button>
                    <div className="my-1 h-px bg-line" />
                    <button
                      role="menuitem"
                      onClick={() => setConfirmDeleteProject(true)}
                      className={`${menuItem} text-red-600 hover:bg-red-50`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Xóa dự án</span>
                    </button>
                  </>
                )
              })()
            : (() => {
                const conv = conversations.find((c) => c.id === menu.id)
                if (!conv) return null
                return (
                  <>
                    <button role="menuitem" onClick={() => startRename(conv)} className={menuItem}>
                      <Pencil className="h-3.5 w-3.5 text-muted" />
                      <span>Đổi tên</span>
                    </button>
                    <button role="menuitem" onClick={() => exportMarkdown(conv)} className={menuItem}>
                      <FileText className="h-3.5 w-3.5 text-muted" />
                      <span>Xuất Markdown (.md)</span>
                    </button>
                    <button role="menuitem" onClick={() => void exportWord(conv)} className={menuItem}>
                      <FileDown className="h-3.5 w-3.5 text-muted" />
                      <span>Xuất Word (.docx)</span>
                    </button>
                    <div className="my-1 h-px bg-line" />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null)
                        void deleteConversation(conv.id)
                      }}
                      className={`${menuItem} text-red-600 hover:bg-red-50`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('sidebar.deleteConversation')}</span>
                    </button>
                  </>
                )
              })()}
        </div>
      )}
    </aside>
  )
}
