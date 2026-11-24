import { useRef } from 'react'
import { FileSpreadsheet, FolderGit2, Terminal, Clock, X } from 'lucide-react'
import { useAppStore, type AuxTab } from '../../stores/useAppStore'
import { DocumentStudioTab } from './DocumentStudioTab'
import { FilesDiffTab } from './FilesDiffTab'
import { TerminalTab } from './TerminalTab'
import { ScheduledTasksTab } from './ScheduledTasksTab'

export function AuxiliaryPane(): React.JSX.Element {
  const { auxTab, auxWidth, settings, openedDocs, setAuxTab, setAuxOpen, setAuxWidth } =
    useAppStore()
  const isLight = settings.theme === 'light'
  const draggingRef = useRef(false)

  const handleResizeMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startWidth = auxWidth

    const onMove = (moveEvent: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = startX - moveEvent.clientX
      setAuxWidth(startWidth + delta)
    }

    const onUp = (): void => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const tabs: { id: AuxTab; label: string; icon: React.JSX.Element; badge?: number }[] = [
    {
      id: 'doc',
      label: 'Tài liệu & Excel',
      icon: <FileSpreadsheet className="h-3.5 w-3.5" />,
      badge: openedDocs.length > 0 ? openedDocs.length : undefined
    },
    {
      id: 'files',
      label: 'Hồ sơ & Diff',
      icon: <FolderGit2 className="h-3.5 w-3.5" />
    },
    {
      id: 'terminal',
      label: 'Lệnh',
      icon: <Terminal className="h-3.5 w-3.5" />
    },
    {
      id: 'tasks',
      label: 'Lịch chạy',
      icon: <Clock className="h-3.5 w-3.5" />
    }
  ]

  return (
    <aside
      style={{ width: `${auxWidth}px` }}
      className={`relative flex h-full shrink-0 flex-col border-l ${
        isLight
          ? 'border-line bg-surface text-ink'
          : 'border-line bg-canvas text-ink'
      }`}
    >
      {/* Left Drag Resize Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        title="Kéo để thay đổi độ rộng bảng phụ trợ"
        className="absolute bottom-0 left-0 top-0 z-20 w-1 cursor-col-resize transition hover:bg-blue-500/60"
      />

      {/* Top Tab Header */}
      <div
        className="flex h-11 shrink-0 items-stretch justify-between border-b border-line bg-surface px-2"
      >
        <div className="flex items-stretch gap-1 overflow-x-auto" role="tablist">
          {tabs.map((tab) => {
            const active = auxTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setAuxTab(tab.id)}
                role="tab"
                aria-selected={active}
                className={`relative flex shrink-0 items-center gap-1.5 px-2.5 text-[12.5px] font-medium transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors after:duration-150 ${
                  active ? 'text-ink after:bg-brand' : 'text-muted after:bg-transparent hover:text-ink'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="tabular rounded-full bg-sunken px-1.5 text-[11px] text-muted">
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => setAuxOpen(false)}
          title="Đóng bảng phụ trợ"
          className="press my-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-sunken hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Active Tab Content */}
      {auxTab === 'doc' && <DocumentStudioTab isLight={isLight} />}
      {auxTab === 'files' && <FilesDiffTab isLight={isLight} />}
      {auxTab === 'terminal' && <TerminalTab isLight={isLight} />}
      {auxTab === 'tasks' && <ScheduledTasksTab isLight={isLight} />}
    </aside>
  )
}
