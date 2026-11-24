import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FolderOpen,
  FileText,
  FileSpreadsheet,
  File,
  GitBranch,
  RefreshCw,
  Search,
  FolderKanban,
  BookMarked,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  ExternalLink
} from 'lucide-react'
import type { AiWorkDirInfo, GitFileChange, WorkspaceEntry } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

interface FilesDiffTabProps {
  isLight: boolean
}

function getFileIcon(name: string): React.JSX.Element {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
  }
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-faint" />
}

export function FilesDiffTab({ isLight }: FilesDiffTabProps): React.JSX.Element {
  const { projects, activeProjectId, openFileInStudio } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [subTab, setSubTab] = useState<'workdir' | 'files' | 'diff'>(
    activeProject?.hasIndexRouter ? 'workdir' : 'files'
  )

  // AI WorkDir state
  const [workDir, setWorkDir] = useState<AiWorkDirInfo | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({})

  // Project files state
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'docx' | 'excel' | 'text'>('all')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])

  // Git Diff state
  const [gitChanges, setGitChanges] = useState<GitFileChange[]>([])
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')

  const loadAll = useCallback(async () => {
    if (!activeProject) return
    const [wd, files, changes] = await Promise.all([
      window.googleAI.getAiWorkDir(activeProject.path),
      window.googleAI.searchWorkspace(activeProject.path, query),
      window.googleAI.getGitChanges(activeProject.path)
    ])
    setWorkDir(wd)
    setEntries(files.filter((e) => !e.isDirectory))
    setGitChanges(changes)
  }, [activeProject, query])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const filteredFiles = useMemo(() => {
    return entries.filter((e) => {
      const lower = e.name.toLowerCase()
      if (typeFilter === 'docx') return lower.endsWith('.docx') || lower.endsWith('.doc')
      if (typeFilter === 'excel') {
        return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
      }
      if (typeFilter === 'text') {
        return lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')
      }
      return true
    })
  }, [entries, typeFilter])

  const handleSelectDiff = async (change: GitFileChange): Promise<void> => {
    if (!activeProject) return
    setSelectedDiffPath(change.path)
    const text = await window.googleAI.getGitFileDiff(activeProject.path, change.path)
    setDiffText(text)
  }

  const handlePickAiWorkDir = async (): Promise<void> => {
    if (!activeProject) return
    const info = await window.googleAI.pickAiWorkDir(activeProject.path)
    if (info) setWorkDir(info)
  }

  if (!activeProject) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-faint">
        Hãy chọn một dự án trước.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sub-navigation */}
      <div
        className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div className="flex items-center gap-1 text-[11px]">
          <button
            onClick={() => setSubTab('workdir')}
            className={`press rounded-lg px-2 py-1 font-medium transition ${
              subTab === 'workdir'
                ? 'bg-blue-600 text-white'
                : isLight
                  ? 'text-muted hover:bg-sunken'
                  : 'text-faint hover:bg-sunken hover:text-ink'
            }`}
          >
            Thư mục AI
          </button>
          <button
            onClick={() => setSubTab('files')}
            className={`press rounded-lg px-2 py-1 font-medium transition ${
              subTab === 'files'
                ? 'bg-blue-600 text-white'
                : isLight
                  ? 'text-muted hover:bg-sunken'
                  : 'text-faint hover:bg-sunken hover:text-ink'
            }`}
          >
            Tệp dự án
          </button>
          <button
            onClick={() => setSubTab('diff')}
            className={`press flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition ${
              subTab === 'diff'
                ? 'bg-blue-600 text-white'
                : isLight
                  ? 'text-muted hover:bg-sunken'
                  : 'text-faint hover:bg-sunken hover:text-ink'
            }`}
          >
            <GitBranch className="h-3 w-3" />
            <span>Thay đổi</span>
            {gitChanges.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                {gitChanges.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={() => void loadAll()}
          title="Làm mới danh sách"
          className={`press rounded-lg p-1.5 transition ${
            isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5 text-faint" />
        </button>
      </div>

      {/* SubTab 1: Thư mục làm việc AI (UBND Thiệu Toán) */}
      {subTab === 'workdir' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {!workDir?.configured ? (
            <div
              className={`rounded-xl border border-dashed p-4 text-center text-xs ${
                isLight ? 'border-line-strong bg-surface' : 'border-line-strong bg-surface'
              }`}
            >
              <FolderKanban className="mx-auto mb-2 h-7 w-7 text-blue-400" />
              <div className="font-semibold">Chưa liên kết Thư mục làm việc AI</div>
              <p className="mt-1 text-[11px] text-faint">
                Chọn thư mục <strong>&ldquo;Thư mục làm việc AI&rdquo;</strong> để tự động quản lý kho <em>Quy tắc</em>, <em>Kiến thức</em> và các hồ sơ phiên công việc (Word/Excel/Báo cáo) tương thích 100% với bộ skill xã Thiệu Toán.
              </p>
              <button
                onClick={() => void handlePickAiWorkDir()}
                className="press mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Chọn Thư mục làm việc AI</span>
              </button>
            </div>
          ) : (
            <>
              <div
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                  isLight ? 'border-line bg-surface' : 'border-line bg-surface'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-blue-400">Thư mục làm việc AI</div>
                  <div className="truncate font-mono text-[10px] text-faint">
                    {workDir.folderPath}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => workDir.folderPath && void window.googleAI.openPath(workDir.folderPath)}
                    title="Mở trong File Explorer"
                    className={`press rounded-lg p-1.5 transition ${
                      isLight
                        ? 'text-faint hover:bg-sunken hover:text-ink'
                        : 'text-faint hover:bg-sunken hover:text-ink'
                    }`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void handlePickAiWorkDir()}
                    className={`press rounded-lg border px-2 py-1 text-[10px] transition ${
                      isLight
                        ? 'border-line-strong bg-surface text-muted hover:bg-sunken'
                        : 'border-line-strong text-muted hover:bg-sunken'
                    }`}
                  >
                    Đổi
                  </button>
                </div>
              </div>

              {/* Vaults: Quy tắc & Kiến thức */}
              <div className="grid grid-cols-2 gap-2">
                <div
                  className={`rounded-xl border p-2.5 text-xs ${
                    isLight ? 'border-line bg-surface' : 'border-line bg-surface'
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
                    <BookMarked className="h-3.5 w-3.5 text-amber-400" />
                    <span>Quy tắc ({workDir.rulesFiles.length})</span>
                  </div>
                  <div className="max-h-24 space-y-1 overflow-y-auto">
                    {workDir.rulesFiles.length === 0 ? (
                      <div className="text-[11px] text-faint">Chưa có mục nào</div>
                    ) : (
                      workDir.rulesFiles.map((f) => (
                        <button
                          key={f.fullPath}
                          onClick={() => void openFileInStudio(f.fullPath)}
                          className="press flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-blue-500/15"
                        >
                          {getFileIcon(f.name)}
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div
                  className={`rounded-xl border p-2.5 text-xs ${
                    isLight ? 'border-line bg-surface' : 'border-line bg-surface'
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
                    <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Kiến thức ({workDir.knowledgeFiles.length})</span>
                  </div>
                  <div className="max-h-24 space-y-1 overflow-y-auto">
                    {workDir.knowledgeFiles.length === 0 ? (
                      <div className="text-[11px] text-faint">Chưa có mục nào</div>
                    ) : (
                      workDir.knowledgeFiles.map((f) => (
                        <button
                          key={f.fullPath}
                          onClick={() => void openFileInStudio(f.fullPath)}
                          className="press flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-blue-500/15"
                        >
                          {getFileIcon(f.name)}
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Dated Case Sessions */}
              <div>
                <div className="mb-2 text-[11px] font-semibold text-faint">
                  Hồ sơ đầu việc theo ngày ({workDir.sessions.length})
                </div>
                {workDir.sessions.length === 0 ? (
                  <div className="py-4 text-center text-xs text-faint">
                    Chưa có phiên đầu việc nào. Khi bắt đầu xử lý hồ sơ, eGovAI sẽ tạo thư mục theo ngày tại đây.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {workDir.sessions.map((sess) => {
                      const isExpanded = expandedSessions[sess.fullPath] ?? true
                      return (
                        <div
                          key={sess.fullPath}
                          className={`rounded-xl border ${
                            isLight ? 'border-line bg-surface' : 'border-line bg-surface'
                          }`}
                        >
                          <button
                            onClick={() =>
                              setExpandedSessions((prev) => ({
                                ...prev,
                                [sess.fullPath]: !isExpanded
                              }))
                            }
                            className="press flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                              )}
                              <span className="truncate">{sess.name}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-faint">
                              {sess.files.length} tệp
                            </span>
                          </button>

                          {isExpanded && sess.files.length > 0 && (
                            <div className="space-y-0.5 border-t border-line px-2 py-1.5">
                              {sess.files.map((f) => (
                                <button
                                  key={f.fullPath}
                                  onClick={() => void openFileInStudio(f.fullPath)}
                                  className={`press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                                    isLight ? 'hover:bg-blue-50' : 'hover:bg-sunken'
                                  }`}
                                >
                                  {getFileIcon(f.name)}
                                  <span className="truncate">{f.relativePath}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* SubTab 2: Project Files with Docs/Excel filters */}
      {subTab === 'files' && (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tên tệp trong dự án..."
              className={`w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-xs outline-none ${
                isLight
                  ? 'border-line bg-surface text-ink'
                  : 'border-line bg-surface text-ink'
              }`}
            />
          </div>

          <div className="mb-2 flex flex-wrap gap-1 text-[11px]">
            {(
              [
                ['all', 'Tất cả'],
                ['docx', 'Word (.docx)'],
                ['excel', 'Excel (.xlsx)'],
                ['text', 'Văn bản / MD']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`press rounded-md px-2.5 py-0.5 font-medium transition ${
                  typeFilter === key
                    ? 'bg-blue-600 text-white'
                    : isLight
                      ? 'bg-sunken text-muted hover:bg-sunken'
                      : 'bg-sunken text-faint hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {filteredFiles.length === 0 ? (
              <div className="py-8 text-center text-xs text-faint">
                Không tìm thấy tệp phù hợp.
              </div>
            ) : (
              filteredFiles.map((entry) => (
                <button
                  key={entry.fullPath}
                  onClick={() => void openFileInStudio(entry.fullPath)}
                  className={`press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                    isLight ? 'hover:bg-blue-50' : 'hover:bg-sunken'
                  }`}
                >
                  {getFileIcon(entry.name)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{entry.name}</div>
                    <div className="truncate text-[10px] text-faint">{entry.relativePath}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* SubTab 3: Git Changed Files & Colored Diff */}
      {subTab === 'diff' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {gitChanges.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-faint">
              Không có tệp nào thay đổi trong kho Git của dự án này.
            </div>
          ) : (
            <>
              <div className="max-h-48 shrink-0 space-y-1 overflow-y-auto border-b border-line p-2.5">
                {gitChanges.map((change) => {
                  const active = selectedDiffPath === change.path
                  return (
                    <div
                      key={change.path}
                      onClick={() => void handleSelectDiff(change)}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition ${
                        active
                          ? isLight
                            ? 'bg-blue-100 text-blue-900 font-medium'
                            : 'bg-blue-500/15 text-blue-200 font-medium'
                          : isLight
                            ? 'hover:bg-sunken'
                            : 'hover:bg-sunken'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {getFileIcon(change.path)}
                        <span className="truncate">{change.path}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            change.status.includes('?') || change.status.includes('A')
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : change.status.includes('D')
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-amber-500/15 text-amber-400'
                          }`}
                        >
                          {change.label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void openFileInStudio(change.fullPath)
                          }}
                          title="Mở tệp trong trình soạn thảo"
                          className="press rounded px-1.5 py-0.5 text-[10px] text-blue-400 hover:bg-blue-500/15"
                        >
                          Mở
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                {!selectedDiffPath ? (
                  <div className="py-8 text-center font-sans text-xs text-faint">
                    Chọn một tệp ở danh sách trên để xem chi tiết thay đổi (Diff).
                  </div>
                ) : (
                  diffText.split(/\r?\n/).map((line, i) => {
                    const cls = line.startsWith('+')
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : line.startsWith('-')
                        ? 'bg-red-500/15 text-red-400'
                        : line.startsWith('@@')
                          ? 'bg-blue-500/15 text-blue-300'
                          : 'opacity-80'
                    return (
                      <div key={i} className={`whitespace-pre-wrap break-all px-1.5 ${cls}`}>
                        {line || ' '}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
