import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plug, Save, Check, AlertCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import type { AntigravityCustomizations } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

type TechTab = 'mcp' | 'cli' | 'hooks'

interface McpConfigSectionProps {
  cardClass: string
  isLight: boolean
}

export function McpConfigSection({ cardClass, isLight }: McpConfigSectionProps): React.JSX.Element {
  const { projects, activeProjectId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<AntigravityCustomizations | null>(null)
  const [tab, setTab] = useState<TechTab>('mcp')
  const [editorText, setEditorText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)

  const load = useCallback(async () => {
    const res = await window.googleAI.loadCustomizations(activeProject?.path)
    setData(res)
    setEditorText(
      tab === 'mcp' ? res.mcpConfigJson : tab === 'cli' ? res.cliSettingsJson : res.hooksConfigJson
    )
    setError(null)
  }, [activeProject?.path, tab])

  useEffect(() => {
    void load()
  }, [load])

  const mcpServerNames = useMemo(() => {
    if (!data?.mcpConfigJson) return []
    try {
      const parsed = JSON.parse(data.mcpConfigJson) as { mcpServers?: Record<string, unknown> }
      return Object.keys(parsed.mcpServers ?? {})
    } catch {
      return []
    }
  }, [data?.mcpConfigJson])

  const selectTab = (next: TechTab): void => {
    setTab(next)
    setError(null)
    if (!data) return
    setEditorText(
      next === 'mcp' ? data.mcpConfigJson : next === 'cli' ? data.cliSettingsJson : data.hooksConfigJson
    )
  }

  const activeTarget = data
    ? tab === 'mcp'
      ? { path: data.mcpConfigPath, label: 'Máy chủ MCP (mcp_config.json)' }
      : tab === 'cli'
        ? { path: data.cliSettingsPath, label: 'Cài đặt Antigravity CLI (settings.json)' }
        : { path: data.hooksConfigPath, label: 'Móc sự kiện (hooks.json)' }
    : null

  const handleSave = async (): Promise<void> => {
    if (!activeTarget) return
    setError(null)
    try {
      await window.googleAI.saveCustomizationFile(activeTarget.path, editorText, true)
      setSavedNotice(true)
      setTimeout(() => setSavedNotice(false), 1800)
      await load()
    } catch (err) {
      setError(
        err instanceof Error ? `Lỗi cú pháp JSON: ${err.message}` : 'Không thể lưu tệp cấu hình.'
      )
    }
  }

  return (
    <section className={cardClass}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="h-4 w-4 text-indigo-500" />
          <span>Máy chủ MCP &amp; Cấu hình kỹ thuật (Nâng cao)</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-indigo-500">
            {mcpServerNames.length} máy chủ MCP
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-faint" />
          ) : (
            <ChevronRight className="h-4 w-4 text-faint" />
          )}
        </div>
      </button>

      {!expanded && (
        <div className="text-xs text-faint">
          Quản lý tệp cấu hình <code className="font-mono">mcp_config.json</code>,{' '}
          <code className="font-mono">settings.json</code> và{' '}
          <code className="font-mono">hooks.json</code> đồng bộ trực tiếp với lõi Google Antigravity.
          {mcpServerNames.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {mcpServerNames.map((name) => (
                <span
                  key={name}
                  className="rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(
                [
                  ['mcp', 'Máy chủ MCP'],
                  ['cli', 'CLI settings.json'],
                  ['hooks', 'Móc sự kiện (Hooks)']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectTab(id)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    tab === id
                      ? 'bg-brand text-white'
                      : 'border border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void load()}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                  isLight
                    ? 'border-line bg-canvas hover:bg-sunken'
                    : 'border-line-strong bg-surface hover:bg-sunken'
                }`}
              >
                <RefreshCw className="h-3 w-3" />
                <span>Tải lại</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                className="press flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
              >
                {savedNotice ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
                <span>{savedNotice ? 'Đã lưu' : 'Lưu JSON'}</span>
              </button>
            </div>
          </div>

          {activeTarget && (
            <div className="truncate font-mono text-[11px] text-faint">{activeTarget.path}</div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            spellCheck={false}
            rows={10}
            className={`w-full resize-y rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none ${
              isLight
                ? 'border-line bg-canvas text-ink focus:border-brand'
                : 'border-line-strong bg-canvas text-ink focus:border-brand'
            }`}
          />
        </div>
      )}
    </section>
  )
}
