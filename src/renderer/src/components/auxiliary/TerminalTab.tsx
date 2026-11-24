import { useEffect, useRef, useState } from 'react'
import { Play, Square, Trash2, ExternalLink, Terminal } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'

interface TerminalLine {
  id: string
  stream: 'cmd' | 'stdout' | 'stderr' | 'meta'
  text: string
}

interface TerminalTabProps {
  isLight: boolean
}

export function TerminalTab({ isLight }: TerminalTabProps): React.JSX.Element {
  const { projects, activeProjectId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [running, setRunning] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = window.googleAI.onTerminalOutput((evt) => {
      if (evt.stream === 'meta') {
        setRunning(false)
        setLines((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            stream: 'meta',
            text: `── Hoàn tất (mã thoát: ${evt.exitCode ?? 0}) ──`
          }
        ])
      } else {
        setLines((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            stream: evt.stream,
            text: evt.data
          }
        ])
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length])

  const execute = (cmdText: string): void => {
    const trimmed = cmdText.trim()
    if (!trimmed || !activeProject) return

    setHistory((prev) => [trimmed, ...prev.slice(0, 30)])
    setHistoryIdx(-1)
    setCommand('')
    setRunning(true)
    setLines((prev) => [
      ...prev,
      { id: `${Date.now()}-cmd`, stream: 'cmd', text: `PS ${activeProject.name}> ${trimmed}` }
    ])
    void window.googleAI.runTerminalCommand(`cmd-${Date.now()}`, trimmed, activeProject.path)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      execute(command)
    } else if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(next)
      setCommand(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx <= 0) {
        setHistoryIdx(-1)
        setCommand('')
      } else {
        const next = historyIdx - 1
        setHistoryIdx(next)
        setCommand(history[next])
      }
    }
  }

  const quickCommands = activeProject?.hasIndexRouter
    ? [
        { label: 'Thư mục AI', cmd: 'python -m workflow.workspace' },
        { label: 'Kiểm tra skill', cmd: 'python integrations/vhxh-gemini-antigravity/install.py --check' },
        { label: 'Chạy test hệ thống', cmd: 'python -B -m unittest discover -s tests' }
      ]
    : [
        { label: 'Danh sách tệp', cmd: 'Get-ChildItem' },
        { label: 'Git status', cmd: 'git status -s' }
      ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top Quick Actions */}
      <div
        className={`flex flex-wrap items-center justify-between gap-1.5 border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {quickCommands.map((qc) => (
            <button
              key={qc.label}
              disabled={!activeProject || running}
              onClick={() => execute(qc.cmd)}
              className={`press rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                isLight
                  ? 'border-line bg-surface text-muted hover:bg-blue-50'
                  : 'border-line-strong bg-surface text-muted hover:bg-sunken'
              }`}
            >
              {qc.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setLines([])}
            title="Xóa màn hình lệnh"
            className={`press rounded-lg p-1.5 transition ${
              isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5 text-faint" />
          </button>
          {activeProject && (
            <button
              onClick={() => void window.googleAI.openExternalPowerShell(activeProject.path)}
              title="Mở cửa sổ PowerShell riêng tại thư mục dự án"
              className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                isLight
                  ? 'border-line bg-surface text-muted hover:bg-sunken'
                  : 'border-line-strong bg-surface text-muted hover:bg-sunken'
              }`}
            >
              <ExternalLink className="h-3 w-3" />
              <span>PowerShell</span>
            </button>
          )}
        </div>
      </div>

      {/* Console Output */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center font-sans text-xs text-faint">
            <Terminal className="mb-2 h-6 w-6 opacity-60" />
            <div>Nhập lệnh PowerShell bên dưới hoặc bấm các nút lệnh nhanh ở trên.</div>
          </div>
        ) : (
          lines.map((l) => (
            <pre
              key={l.id}
              className={`whitespace-pre-wrap break-all ${
                l.stream === 'cmd'
                  ? 'mt-2 font-semibold text-blue-400'
                  : l.stream === 'stderr'
                    ? 'text-red-400'
                    : l.stream === 'meta'
                      ? 'mb-1 text-[10px] text-faint'
                      : 'text-ink'
              }`}
            >
              {l.text}
            </pre>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Input Bar */}
      <div
        className={`flex items-center gap-2 border-t px-3 py-2 ${
          isLight ? 'border-line bg-surface' : 'border-line bg-canvas'
        }`}
      >
        <span className="font-mono text-xs font-bold text-blue-400">&gt;</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeProject}
          placeholder="Nhập lệnh PowerShell (VD: dir, git status, python ...)..."
          className="flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-faint"
        />
        {running ? (
          <button
            onClick={() => void window.googleAI.killTerminalCommand()}
            className="press flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>Dừng</span>
          </button>
        ) : (
          <button
            onClick={() => execute(command)}
            disabled={!command.trim() || !activeProject}
            className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Chạy</span>
          </button>
        )}
      </div>
    </div>
  )
}
