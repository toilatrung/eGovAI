import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolCallBlock } from '../../../../shared/types'

function summarizeParams(params?: Record<string, unknown>): string {
  if (!params) return ''
  const preferredKeys = ['CommandLine', 'Path', 'TargetFile', 'AbsolutePath', 'query', 'Query', 'Url', 'DirectoryPath']
  for (const key of preferredKeys) {
    const val = params[key]
    if (typeof val === 'string' && val.trim()) return val
  }
  const firstString = Object.values(params).find((v) => typeof v === 'string' && v.trim())
  return typeof firstString === 'string' ? firstString : ''
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)} giây`
  const m = Math.floor(s / 60)
  return `${m} phút ${Math.round(s - m * 60)} giây`
}

/** One step on the vertical timeline: a dot on the rail, a one-line summary, details on demand. */
function ToolStep({ toolCall }: { toolCall: ToolCallBlock }): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const name = t(`tools.${toolCall.toolName}`, { defaultValue: toolCall.toolName })
  const summary = summarizeParams(toolCall.parameters)
  const hasDetails =
    Boolean(toolCall.output) || Boolean(toolCall.parameters && Object.keys(toolCall.parameters).length > 0)
  const active = toolCall.state === 'ACTIVE'
  const failed = toolCall.state === 'ERROR'
  const startedAtRef = useRef(Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)

  useEffect(() => {
    if (!active) return
    startedAtRef.current = Date.now()
    setElapsedSec(0)
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return (
    <li className="relative pl-6">
      {/* Dot sits on the rail drawn by the parent list */}
      <span
        aria-hidden
        className={`absolute left-[3px] top-[9px] h-[9px] w-[9px] rounded-full ring-[3px] ring-surface ${
          active ? 'bg-brand' : failed ? 'bg-red-500' : 'bg-faint'
        }`}
      >
        {active && <span className="absolute inset-0 animate-ping rounded-full bg-brand/40 motion-reduce:hidden" />}
      </span>

      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        aria-expanded={hasDetails ? expanded : undefined}
        className={`group flex w-full min-w-0 items-baseline gap-2 rounded-md py-1 pr-1 text-left ${
          hasDetails ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span
          className={`shrink-0 text-[13px] font-medium ${
            failed ? 'text-red-600' : active ? 'text-ink' : 'text-muted group-hover:text-ink'
          }`}
        >
          {name}
        </span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-faint" title={summary}>
            {summary}
          </span>
        )}
        <span className="tabular ml-auto shrink-0 text-[12px] text-faint">
          {active ? (
            <span className="inline-flex items-center gap-1.5">
              {elapsedSec > 0 && <span>{elapsedSec}s</span>}
              <Loader2 className="inline h-3 w-3 animate-spin text-brand" />
            </span>
          ) : failed ? (
            t('tools.error')
          ) : typeof toolCall.durationSeconds === 'number' && toolCall.durationSeconds > 0 ? (
            `${toolCall.durationSeconds.toFixed(1)}s`
          ) : null}
        </span>
      </button>

      {expanded && (
        <div className="mb-2 mt-1 space-y-2">
          {toolCall.parameters && Object.keys(toolCall.parameters).length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-faint">{t('tools.parameters')}</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunken p-2.5 font-mono text-[12px] text-ink">
                {JSON.stringify(toolCall.parameters, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-faint">{t('tools.output')}</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunken p-2.5 font-mono text-[12px] text-ink">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The assistant's work steps as a vertical timeline. Open while the turn runs;
 * folds into a one-line summary once it finishes (and stays folded for past turns).
 */
export function ToolTimeline({
  toolCalls,
  isStreaming
}: {
  toolCalls: ToolCallBlock[]
  isStreaming: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(isStreaming)
  const wasStreaming = useRef(isStreaming)

  useEffect(() => {
    if (wasStreaming.current !== isStreaming) setOpen(isStreaming)
    wasStreaming.current = isStreaming
  }, [isStreaming])

  const total = toolCalls.reduce((sum, tc) => sum + (tc.durationSeconds ?? 0), 0)
  const errors = toolCalls.filter((tc) => tc.state === 'ERROR').length
  const n = toolCalls.length

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex items-center gap-1.5 rounded-md py-0.5 text-[13px] text-muted hover:text-ink"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform duration-200 ease-[var(--ease-out-strong)] ${open ? 'rotate-90' : ''}`}
        />
        {isStreaming ? (
          <span>Đang thực hiện · bước {n}</span>
        ) : (
          <span className="tabular">
            Đã thực hiện {n} bước{total > 0 ? ` · ${formatSeconds(total)}` : ''}
            {errors > 0 && <span className="text-red-600"> · {errors} lỗi</span>}
          </span>
        )}
      </button>

      {open && (
        <ol className="relative mt-1.5 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-line-strong">
          {toolCalls.map((tc) => (
            <ToolStep key={`${tc.stepIndex}-${tc.toolName}`} toolCall={tc} />
          ))}
        </ol>
      )}
    </div>
  )
}
