import { useEffect, useState } from 'react'
import {
  ShieldAlert,
  MessageCircleQuestion,
  Check,
  X,
  Paperclip,
  ShieldCheck,
  Send
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'

export function InteractionModal(): React.JSX.Element | null {
  const { pendingInteractions, projects, activeProjectId, respondToInteraction } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const req = pendingInteractions[0] ?? null

  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [contextNote, setContextNote] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])

  useEffect(() => {
    setSelectedOptions([])
    setContextNote('')
    setAttachedFiles([])
  }, [req?.id])

  if (!req) return null

  const isApproval = req.kind === 'approval'

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface text-ink shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                isApproval
                  ? 'bg-amber-500/15 text-amber-500'
                  : 'bg-brand/12 text-brand'
              }`}
            >
              {isApproval ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <MessageCircleQuestion className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">{req.title}</h2>
                {pendingInteractions.length > 1 && (
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold text-muted">
                    +{pendingInteractions.length - 1} yêu cầu khác
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-faint">
                {isApproval
                  ? 'Trợ lý đang chờ bạn phê duyệt trước khi thực thi thao tác'
                  : 'Trợ lý cần bạn chọn phương án hoặc bổ sung ngữ cảnh để tiếp tục'}
              </p>
            </div>
          </div>

          <button
            onClick={() => submit(false)}
            title="Từ chối / Đóng"
            className="rounded-lg p-1 text-faint transition hover:bg-sunken hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas px-3.5 py-3 text-xs leading-relaxed">
            {req.message}
          </div>

          {/* Structured details for approval */}
          {isApproval && req.details && Object.keys(req.details).length > 0 && (
            <details className="rounded-xl border border-line bg-canvas text-xs">
              <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted">
                Xem chi tiết tham số lệnh ({req.toolName})
              </summary>
              <pre className="max-h-36 overflow-auto border-t border-line p-3 font-mono text-[11px] text-muted">
                {JSON.stringify(req.details, null, 2)}
              </pre>
            </details>
          )}

          {/* Multiple choice options (if AI provides choices) */}
          {req.options && req.options.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium">
                {req.allowMultiple ? 'Chọn một hoặc nhiều phương án:' : 'Chọn phương án:'}
              </div>
              <div className="space-y-1.5">
                {req.options.map((opt) => {
                  const active = selectedOptions.includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleOption(opt)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-xs transition ${
                        active
                          ? 'border-brand bg-brand/10 font-medium text-ink ring-1 ring-brand/30'
                          : 'border-line bg-canvas text-muted hover:bg-sunken hover:text-ink'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          active ? 'border-brand bg-brand text-white' : 'border-line-strong'
                        }`}
                      >
                        {active && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span>{opt}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Free-text context / instruction input */}
          <div>
            <label className="block text-xs font-medium">
              {isApproval
                ? 'Bổ sung ngữ cảnh / Ghi chú cho AI (tùy chọn)'
                : 'Nhập câu trả lời hoặc bổ sung ngữ cảnh / số liệu'}
            </label>
            <textarea
              value={contextNote}
              onChange={(e) => setContextNote(e.target.value)}
              rows={3}
              placeholder={
                isApproval
                  ? 'VD: Mở trang Cổng thông tin Chính phủ thay vì Google, hoặc chỉ tìm Luật năm 2024...'
                  : 'Nhập thông tin bổ sung, hướng dẫn chi tiết hoặc yêu cầu chỉnh sửa...'
              }
              className="mt-1.5 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-faint focus:border-brand"
            />
          </div>

          {/* Optional File Attachments for Question Mode */}
          {req.allowAttachments && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-faint">Đính kèm hồ sơ / tệp bổ sung (nếu có)</span>
                <button
                  type="button"
                  onClick={() => void handlePickFiles()}
                  className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-sunken"
                >
                  <Paperclip className="h-3 w-3" />
                  <span>Chọn tệp</span>
                </button>
              </div>
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachedFiles.map((filePath) => {
                    const name = filePath.split(/[\\/]/).pop() || filePath
                    return (
                      <span
                        key={filePath}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px]"
                        title={filePath}
                      >
                        <Paperclip className="h-3 w-3 text-blue-500" />
                        <span className="max-w-[200px] truncate">{name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedFiles((prev) => prev.filter((x) => x !== filePath))
                          }
                          className="rounded p-0.5 hover:bg-sunken"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button
            type="button"
            onClick={() => submit(false)}
            className="press rounded-xl border border-line-strong bg-surface px-3.5 py-2 text-xs font-medium text-muted transition hover:bg-sunken hover:text-ink"
          >
            {isApproval ? 'Từ chối' : 'Bỏ qua'}
          </button>

          {isApproval ? (
            <>
              <button
                type="button"
                onClick={() => submit(true, true)}
                title="Tự động phê duyệt các thao tác điều khiển máy tính còn lại trong phiên này"
                className="press flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/12 px-3.5 py-2 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Luôn cho phép phiên này</span>
              </button>
              <button
                type="button"
                onClick={() => submit(true, false)}
                className="press flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Phê duyệt lần này</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => submit(true, false)}
              disabled={
                selectedOptions.length === 0 && !contextNote.trim() && attachedFiles.length === 0
              }
              className="press flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Gửi phản hồi cho AI</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
