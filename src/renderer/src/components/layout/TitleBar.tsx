import { PanelLeft, PanelRight, AlertCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/useAppStore'
import { EgovMark, EgovWordmark } from '../brand/EgovLogo'

function getInitials(name?: string, email?: string): string {
  const source = (name || email || 'E').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return source.slice(0, 1).toUpperCase()
}

const iconBtn =
  'press flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink'

export function TitleBar(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    agyStatus,
    checkingStatus,
    projects,
    activeProjectId,
    auxOpen,
    toggleSidebar,
    toggleAuxPane,
    setActiveView
  } = useAppStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const ready = Boolean(agyStatus?.installed && agyStatus?.authenticated)

  return (
    <header className="app-drag flex h-11 shrink-0 select-none items-center gap-2.5 border-b border-line bg-surface px-3 pr-36 text-ink">
      <div className="app-no-drag flex min-w-0 items-center gap-2.5">
        <button onClick={toggleSidebar} title="Ẩn hoặc hiện thanh bên" className={iconBtn}>
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <EgovMark size={22} />
          <EgovWordmark className="text-[14px]" />
        </div>

        {activeProject && (
          <div className="hidden min-w-0 items-center gap-2 text-[13px] text-faint md:flex" title={activeProject.path}>
            <span>/</span>
            <span className="max-w-[260px] truncate font-medium text-muted">{activeProject.name}</span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="app-no-drag flex items-center gap-2">
        <button
          onClick={() => setActiveView('settings')}
          title={
            ready
              ? `${agyStatus?.account?.displayName ?? 'Tài khoản Google'}${agyStatus?.account?.email ? ` (${agyStatus.account.email})` : ''} · ${agyStatus?.models.length ?? 0} mô hình`
              : undefined
          }
          className={`press flex items-center gap-2 rounded-full py-1 text-[12px] font-medium ${
            checkingStatus
              ? 'bg-sunken px-2.5 text-muted'
              : ready
                ? 'bg-ok-soft pl-1 pr-2.5 text-ok hover:brightness-95'
                : 'bg-amber-50 px-2.5 text-amber-700 hover:bg-amber-100'
          }`}
        >
          {checkingStatus ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t('app.checking')}</span>
            </>
          ) : ready ? (
            <>
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                {getInitials(agyStatus?.account?.displayName, agyStatus?.account?.email)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-ok ring-2 ring-surface" />
              </span>
              <span className="max-w-[190px] truncate">
                {agyStatus?.account?.email || agyStatus?.account?.displayName || t('app.connected')}
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              <span>{agyStatus?.installed ? t('app.notAuthenticated') : t('app.notInstalled')}</span>
            </>
          )}
        </button>

        <button
          onClick={toggleAuxPane}
          title="Ẩn hoặc hiện bảng Tài liệu & Excel"
          aria-pressed={auxOpen}
          className={`press flex h-[30px] items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium ${
            auxOpen ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sunken hover:text-ink'
          }`}
        >
          <PanelRight className="h-4 w-4" />
          <span className="hidden lg:inline">Tài liệu &amp; Excel</span>
        </button>
      </div>
    </header>
  )
}
