import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen,
  Search,
  Play,
  FileText,
  ArrowLeft,
  Globe2,
  Folder,
  FolderPlus,
  Trash2,
  ExternalLink,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SkillItem } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

/** SKILL.md files open with a YAML block; hide it so the preview starts at the real content. */
function stripFrontMatter(text: string): string {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

type ScopeTab = 'global' | 'project' | 'all'

export function SkillsCatalogView(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    projects,
    activeProjectId,
    skills,
    settings,
    setActiveView,
    createNewConversation,
    importGlobalSkills,
    removeGlobalSkillSource
  } = useAppStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const isLight = settings.theme === 'light'
  const globalSources = settings.globalSkillSources ?? []

  const globalSkills = useMemo(() => skills.filter((s) => s.scope === 'global'), [skills])
  const projectSkills = useMemo(() => skills.filter((s) => s.scope === 'project'), [skills])

  const [scopeTab, setScopeTab] = useState<ScopeTab>(
    globalSkills.length > 0 ? 'global' : projectSkills.length > 0 ? 'project' : 'global'
  )
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [previewSkill, setPreviewSkill] = useState<SkillItem | null>(null)
  const [sopContent, setSopContent] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)

  const scopedSkills = useMemo(() => {
    if (scopeTab === 'global') return globalSkills
    if (scopeTab === 'project') return projectSkills
    return skills
  }, [scopeTab, globalSkills, projectSkills, skills])

  const categories = useMemo(() => {
    const unique = Array.from(new Set(scopedSkills.map((s) => s.category)))
    return ['ALL', ...unique]
  }, [scopedSkills])

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scopedSkills.filter((s) => {
      if (selectedCategory !== 'ALL' && s.category !== selectedCategory) return false
      if (!q) return true
      return (
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.code ?? '').toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.packName ?? '').toLowerCase().includes(q)
      )
    })
  }, [scopedSkills, selectedCategory, query])

  // Keep previewSkill synced to current tab
  useEffect(() => {
    if (!previewSkill || !filteredSkills.some((s) => s.id === previewSkill.id)) {
      setPreviewSkill(filteredSkills[0] ?? null)
    }
  }, [filteredSkills, previewSkill])

  // Reset category filter when switching scope tab
  useEffect(() => {
    setSelectedCategory('ALL')
  }, [scopeTab])

  useEffect(() => {
    if (!previewSkill) {
      setSopContent('')
      return
    }
    let cancelled = false
    const targetPath = previewSkill.sopFullPath || previewSkill.sopPath
    const baseDir = previewSkill.rootPath || activeProject?.path || ''
    void window.googleAI.readSkillSop(baseDir, targetPath).then((text) => {
      if (!cancelled) setSopContent(text)
    })
    return () => {
      cancelled = true
    }
  }, [previewSkill, activeProject?.path])

  const handleImportGlobal = async (): Promise<void> => {
    setImportFeedback(null)
    const res = await importGlobalSkills()
    if (res.canceled) return
    if (res.error) {
      setImportFeedback({ type: 'err', text: res.error })
      return
    }
    setScopeTab('global')
    setImportFeedback({
      type: 'ok',
      text: `Đã import ${res.importedCount ?? 0} kỹ năng vào Kỹ năng chung (Global) — tự động áp dụng cho toàn bộ mọi phiên và dự án.`
    })
    setTimeout(() => setImportFeedback(null), 5000)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView('chat')}
            className="press flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-sunken"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.01em]">
              <BookOpen className="h-4 w-4 text-brand" />
              <span>{t('skills.title')}</span>
            </h1>
            <p className="text-xs text-faint">
              Phân tách rõ Kỹ năng chung (Global — áp dụng toàn bộ phiên) và Kỹ năng riêng của từng dự án
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void handleImportGlobal()}
            className="press flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Import kỹ năng chung (Global)</span>
          </button>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('skills.searchPlaceholder')}
              className={`w-full rounded-xl border py-2 pl-9 pr-3 text-xs outline-none ${
                isLight
                  ? 'border-line bg-canvas text-ink focus:border-brand'
                  : 'border-line-strong bg-surface text-ink focus:border-brand'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Scope Tabs: Kỹ năng chung (Global) | Kỹ năng dự án | Tất cả */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/70 px-6 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setScopeTab('global')}
            className={`press flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              scopeTab === 'global'
                ? 'bg-brand text-white'
                : 'border border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" />
            <span>Kỹ năng chung (Global)</span>
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                scopeTab === 'global' ? 'bg-white/20 text-white' : 'bg-sunken text-muted'
              }`}
            >
              {globalSkills.length}
            </span>
          </button>

          <button
            onClick={() => setScopeTab('project')}
            className={`press flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              scopeTab === 'project'
                ? 'bg-brand text-white'
                : 'border border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            <Folder className="h-3.5 w-3.5" />
            <span>
              Kỹ năng dự án{activeProject ? ` (${activeProject.name})` : ''}
            </span>
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                scopeTab === 'project' ? 'bg-white/20 text-white' : 'bg-sunken text-muted'
              }`}
            >
              {projectSkills.length}
            </span>
          </button>

          <button
            onClick={() => setScopeTab('all')}
            className={`press rounded-lg px-3 py-1.5 font-medium transition ${
              scopeTab === 'all'
                ? 'bg-brand text-white'
                : 'border border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            Tất cả ({skills.length})
          </button>
        </div>
      </div>

      {/* Feedback Banner after Global Import */}
      {importFeedback && (
        <div
          className={`mx-6 mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            importFeedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-500'
          }`}
        >
          {importFeedback.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{importFeedback.text}</span>
        </div>
      )}

      {/* Imported Global Skill Sources Strip (shown in Global & All tabs) */}
      {(scopeTab === 'global' || scopeTab === 'all') && globalSources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-6 py-2 text-xs">
          <span className="text-[11px] font-semibold text-faint">Nguồn Global đã import:</span>
          {globalSources.map((src) => (
            <span
              key={src.id}
              title={src.path}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px]"
            >
              <Globe2 className="h-3 w-3 text-emerald-500" />
              <span className="font-medium">{src.name}</span>
              <span className="text-faint">({src.skillCount})</span>
              <button
                onClick={() => void window.googleAI.openPath(src.path)}
                title="Mở thư mục gốc"
                className="rounded p-0.5 text-faint hover:bg-sunken hover:text-ink"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                onClick={() => void removeGlobalSkillSource(src.id)}
                title="Gỡ khỏi Kỹ năng chung (không xóa thư mục gốc)"
                className="rounded p-0.5 text-faint hover:bg-red-500/15 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Category Filter Pills */}
      {scopedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line bg-canvas px-6 py-2">
          {categories.map((cat) => {
            const active = selectedCategory === cat
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`press rounded-md px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'bg-ink text-surface'
                    : 'bg-surface text-muted ring-1 ring-line hover:bg-sunken'
                }`}
              >
                {cat === 'ALL' ? `${t('skills.allCategories')} (${scopedSkills.length})` : cat}
              </button>
            )
          })}
        </div>
      )}

      {/* Body Split: Left Skill List + Right SOP Preview */}
      {scopedSkills.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          {scopeTab === 'global' ? (
            <>
              <Globe2 className="mb-3 h-9 w-9 text-brand opacity-80" />
              <div className="text-sm font-semibold">Chưa có Kỹ năng chung (Global) nào</div>
              <p className="mt-1 max-w-md text-xs text-faint">
                Import bộ kỹ năng (ví dụ thư mục <strong>ubndthieutoan-skills</strong>) vào đây để tự động dùng chung cho <strong>toàn bộ mọi dự án và phiên làm việc</strong> mà không cần chép vào từng thư mục.
              </p>
              <button
                onClick={() => void handleImportGlobal()}
                className="press mt-4 flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
              >
                <FolderPlus className="h-4 w-4" />
                <span>Import bộ kỹ năng vào Global</span>
              </button>
            </>
          ) : (
            <>
              <Folder className="mb-3 h-9 w-9 text-faint opacity-70" />
              <div className="text-sm font-semibold">
                Dự án {activeProject ? `"${activeProject.name}"` : 'hiện tại'} chưa có kỹ năng riêng
              </div>
              <p className="mt-1 max-w-md text-xs text-faint">
                Kỹ năng đặt trong <code className="font-mono">.agents/skills/</code> hoặc{' '}
                <code className="font-mono">INDEX.md</code> của riêng dự án này sẽ hiện tại đây. Các kỹ năng dùng chung cho mọi nơi hãy chuyển sang tab{' '}
                <strong>Kỹ năng chung (Global)</strong>.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,350px)_1fr]">
          {/* Left list */}
          <div className="min-h-0 overflow-y-auto border-r border-line p-4">
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {filteredSkills.map((sk, i) => {
                const selected = previewSkill?.id === sk.id
                return (
                  <div
                    key={sk.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => setPreviewSkill(sk)}
                    onKeyDown={(e) => e.key === 'Enter' && setPreviewSkill(sk)}
                    className={`group grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-3 px-3.5 py-3 transition-colors duration-150 ${
                      i > 0 ? 'border-t border-line' : ''
                    } ${selected ? 'bg-brand-soft' : 'hover:bg-canvas'}`}
                  >
                    <span
                      className={`rounded-md py-1 text-center font-mono text-[12px] font-medium ${
                        selected
                          ? 'bg-brand text-white'
                          : sk.code === '★'
                            ? 'bg-gold/25 text-gold-ink'
                            : 'bg-sunken text-muted'
                      }`}
                    >
                      {sk.code ?? '—'}
                    </span>
                    <span className="min-w-0">
                      <b className="line-clamp-2 block text-[13.5px] font-medium leading-snug">
                        {sk.title}
                      </b>
                      <small className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-faint">
                        <span
                          className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                            sk.scope === 'global'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {sk.scope === 'global' ? 'Global' : 'Dự án'}
                        </span>
                        <span className="truncate">{sk.category || sk.description}</span>
                      </small>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        createNewConversation(sk)
                      }}
                      title={t('skills.useSkill')}
                      className={`press items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft ${
                        selected ? 'flex' : 'hidden'
                      }`}
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Dùng</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right SOP Preview */}
          <div className="hidden min-h-0 min-w-0 flex-col overflow-y-auto p-6 lg:flex">
            {previewSkill ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-4 border-b border-line pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-brand" />
                      <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-balance">
                        {previewSkill.code ? `[${previewSkill.code}] ` : ''}
                        {previewSkill.title}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          previewSkill.scope === 'global'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {previewSkill.scope === 'global'
                          ? `Kỹ năng chung (${previewSkill.packName ?? 'Global'})`
                          : 'Kỹ năng riêng dự án'}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-faint">
                      {previewSkill.sopFullPath || previewSkill.sopPath}
                    </p>
                  </div>
                  <button
                    onClick={() => createNewConversation(previewSkill)}
                    className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>{t('skills.useSkill')}</span>
                  </button>
                </div>

                <div className="markdown-body text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stripFrontMatter(sopContent)}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-faint">
                {t('skills.selectToPreview')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
