import { useEffect, useState } from 'react'
import {
  ShieldAlert,
  MessageCircleQuestion,
  Check,
  X,
  Paperclip,
  ShieldCheck,
  Send,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'

export function InteractivePromptBar(): React.JSX.Element | null {
  const { pendingInteractions, projects, activeProjectId, respondToInteraction } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const req = pendingInteractions[0] ?? null

  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [contextNote, setContextNote] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    setSelectedOptions([])
    setContextNote('')
    setAttachedFiles([])
    setShowDetails(false)
  }, [req?.id])

  if (!req) return null

  const isApproval = req.kind === 'approval'
  const details = (req.details ?? {}) as Record<string, unknown>
  const isScopeRequest = Boolean(details.isScopeRequest)
  const scopeApps = Array.isArray(details.apps) ? details.apps.map(String).filter(Boolean) : []
  const scopePurpose = typeof details.purpose === 'string' ? details.purpose : ''
  const summaryLines = Array.isArray(details.summary) ? details.summary.map(String) : []
  const risk = details.risk === 'low' || details.risk === 'read' ? details.risk : 'high'
  const scopeNote =
    typeof details.scopeNote === 'string'
      ? details.scopeNote
      : '"Luôn cho phép" chỉ tự duyệt các thao tác ít rủi ro trong phiên này. Nhập văn bản, nhấp chuột, nhấn Enter/phím tắt, mở ứng dụng và xóa vẫn luôn hỏi lại.'
  const commandDetails = details.args ?? null

  const toggleOption = (opt: string): void => {
    if (req.allowMultiple) {
      setSelectedOptions((prev) =>
        prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]
      )
    } else {
      setSelectedOptions([opt])
    }
  }

  const handlePickFiles = async (): Promise<void> => {
    const picked = await window.googleAI.pickFiles(activeProject?.path)
    if (picked.length === 0) return
    setAttachedFiles((prev) => {
      const next = [...prev]
      for (const p of picked) {
        if (!next.includes(p)) next.push(p)
      }
      return next
    })
  }

  const submit = (approved: boolean, alwaysAllowSession = false): void => {
    void respondToInteraction({
      id: req.id,
      approved,
      alwaysAllowSession,
      selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
      contextNote: contextNote.trim() || undefined,
      attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined
    })
  }

  const canSendQuestion =
    selectedOptions.length > 0 || contextNote.trim().length > 0 || attachedFiles.length > 0

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-brand/40 bg-surface text-ink shadow-md ring-1 ring-brand/15">
      {/* Compact Header Strip */}
      <div className="flex items-start justify-between gap-2.5 border-b border-line bg-canvas/70 px-3.5 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
              isApproval ? 'bg-amber-500/15 text-amber-500' : 'bg-brand/12 text-brand'
            }`}
          >
            {isApproval ? (
              <ShieldAlert className="h-3.5 w-3.5" />
            ) : (
              <MessageCircleQuestion className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold">{req.title}</span>
              {pendingInteractions.length > 1 && (
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold text-muted">
                  +{pendingInteractions.length - 1} đang chờ
                </span>
              )}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug text-muted">
              {isScopeRequest && scopeApps.length > 0 ? (
                <>
                  eGovAI xin điều khiển{' '}
                  <strong className="font-semibold text-ink">{scopeApps.join(', ')}</strong>
                  {scopePurpose ? ` để: ${scopePurpose}` : ''}
                </>
              ) : (
                req.message
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => submit(false)}
          title="Từ chối / Bỏ qua (Esc)"
          className="shrink-0 rounded-md p-1 text-faint transition hover:bg-sunken hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Interactive Controls */}
      <div className="space-y-2.5 px-3.5 py-2.5">
        {/* Optional collapsible parameters for approval */}
        {isApproval && summaryLines.length > 0 && (
          <ul
            className={`space-y-0.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
              risk === 'high'
                ? 'border-amber-500/40 bg-amber-500/8 text-ink'
                : 'border-line bg-canvas text-muted'
            }`}
          >
            {summaryLines.map((line, i) => (
              <li key={i} className="whitespace-pre-wrap break-words">
                {line}
              </li>
            ))}
          </ul>
        )}

        {isApproval && !isScopeRequest && (
          <p className="text-[10.5px] leading-snug text-faint">{scopeNote}</p>
        )}

        {isApproval && commandDetails !== null && (
          <div>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-faint hover:text-ink"
            >
              {showDetails ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span>Chi tiết lệnh ({req.toolName})</span>
            </button>
            {showDetails && (
              <pre className="mt-1.5 max-h-28 overflow-auto rounded-lg border border-line bg-canvas p-2 font-mono text-[11px] text-muted">
                {JSON.stringify(commandDetails, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Quick Option Pills */}
        {req.options && req.options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {req.options.map((opt) => {
              const active = selectedOptions.includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleOption(opt)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    active
                      ? 'border-brand bg-brand/12 font-semibold text-brand'
                      : 'border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
                  }`}
                >
                  {active && <Check className="h-3 w-3" />}
                  <span>{opt}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Attached Files Preview */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachedFiles.map((filePath) => {
              const name = filePath.split(/[\\/]/).pop() || filePath
              return (
                <span
                  key={filePath}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2 py-0.5 text-[11px]"
                  title={filePath}
                >
                  <Paperclip className="h-3 w-3 text-brand" />
                  <span className="max-w-[180px] truncate">{name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedFiles((prev) => prev.filter((x) => x !== filePath))
                    }
                    className="rounded p-0.5 hover:bg-sunken"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Inline Input + Action Buttons Row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-1.5 focus-within:border-brand">
            <input
              type="text"
              value={contextNote}
              onChange={(e) => setContextNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  submit(false)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (isApproval) submit(true, false)
                  else if (canSendQuestion) submit(true, false)
                }
              }}
              placeholder={
                isApproval
                  ? 'Bổ sung ngữ cảnh / chỉ dẫn thêm cho AI (tùy chọn)...'
                  : 'Nhập câu trả lời hoặc bổ sung ngữ cảnh rồi nhấn Enter...'
              }
              className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
            />
            {req.allowAttachments && (
              <button
                type="button"
                onClick={() => void handlePickFiles()}
                title="Đính kèm tệp / hồ sơ bổ sung"
                className="rounded p-1 text-muted transition hover:bg-sunken hover:text-ink"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => submit(false)}
              className="press rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-sunken hover:text-ink"
            >
              {isApproval ? 'Từ chối' : 'Bỏ qua'}
            </button>

            {isApproval ? (
              isScopeRequest ? (
                <button
                  type="button"
                  onClick={() => submit(true, false)}
                  className="press flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Cho phép lần này</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => submit(true, true)}
                    title={`Phê duyệt thao tác này. ${scopeNote}`}
                    className="press flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/12 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Luôn cho phép (thao tác ít rủi ro)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => submit(true, false)}
                    className="press flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Phê duyệt</span>
                  </button>
                </>
              )
            ) : (
              <button
                type="button"
                onClick={() => submit(true, false)}
                disabled={!canSendQuestion}
                className="press flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Gửi</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
