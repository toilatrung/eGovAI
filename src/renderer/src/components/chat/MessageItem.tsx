import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  User,
  Copy,
  Check,
  Brain,
  Paperclip,
  AlertCircle,
  Loader2,
  Bookmark,
  FileText,
  FileSpreadsheet,
  Pencil,
  RotateCcw,
  Globe,
  Scale
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EgovMark } from '../brand/EgovLogo'
import type { ChatMessage } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'
import {
  extractLocalFilesFromMarkdown,
  resolveLocalFileHref
} from '../../utils/fileLinks'
import { ToolTimeline } from './ToolCallCard'
import { classifyImageSrc, markdownUrlTransform } from '../../utils/markdownSafety'
import { extractLegalReferences, vbplSearchUrl } from '../../utils/legalRefs'

const actionBtn =
  'press flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-faint hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40'

interface MessageItemProps {
  message: ChatMessage
  isLight: boolean
  /** Last message of the conversation — gets "Tạo lại" / "Thử lại" */
  isLast?: boolean
}

export function MessageItem({ message, isLight, isLast = false }: MessageItemProps): React.JSX.Element {
  const { t } = useTranslation()
  const openFileInStudio = useAppStore((s) => s.openFileInStudio)
  const activeProject = useAppStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  )
  const [copied, setCopied] = useState(false)
  const regenerateMessage = useAppStore((s) => s.regenerateMessage)
  const editAndResend = useAppStore((s) => s.editAndResend)
  const convBusy = useAppStore((s) =>
    s.activeConversationId ? Boolean(s.streamingConversationIds[s.activeConversationId]) : false
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const legalRefs = useMemo(() => {
    if (message.role !== 'assistant' || message.status === 'streaming' || !message.content) return []
    return extractLegalReferences(message.content)
  }, [message.role, message.status, message.content])

  const cancelEdit = (): void => {
    setEditing(false)
    setDraft(message.content)
  }

  const submitEdit = (): void => {
    const text = draft.trim()
    if (!text || convBusy) return
    setEditing(false)
    // Same text still re-runs the turn: "Gửi lại" doubles as a retry.
    void editAndResend(message.id, text)
  }

  const linkedFiles = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return []
    return extractLocalFilesFromMarkdown(message.content, activeProject?.path)
  }, [message.role, message.content, activeProject?.path])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className={`${editing ? 'w-full' : ''} max-w-[82%] space-y-1.5`}>
          {(message.activeSkill || (message.attachments && message.attachments.length > 0)) && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.activeSkill && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    isLight
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                  }`}
                >
                  <Bookmark className="h-3 w-3" />
                  {message.activeSkill.code ? `[${message.activeSkill.code}] ` : ''}
                  {message.activeSkill.title}
                </span>
              )}
              {message.attachments?.map((att) => (
                <button
                  key={att.path}
                  onClick={() => att.type !== 'folder' && void openFileInStudio(att.path)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] transition ${
                    isLight
                      ? 'bg-sunken text-muted hover:bg-blue-100 hover:text-blue-700'
                      : 'bg-sunken text-muted ring-1 ring-line-strong hover:bg-blue-500/20 hover:text-blue-300'
                  }`}
                  title={`Bấm để mở trong Tài liệu & Excel: ${att.path}`}
                >
                  <Paperclip className="h-3 w-3 text-blue-400" />
                  <span className="max-w-[180px] truncate">{att.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="group flex items-start justify-end gap-2.5">
            {editing ? (
              <div className="w-full rounded-xl border border-line-strong bg-surface p-2 focus-within:border-brand/45 focus-within:shadow-[0_0_0_3px_var(--egov-brand-soft)]">
                <textarea
                  ref={editRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitEdit()
                    }
                  }}
                  rows={Math.min(10, Math.max(2, draft.split('\n').length))}
                  aria-label="Sửa yêu cầu"
                  className="block w-full resize-none bg-transparent px-2 py-1 text-[14px] leading-relaxed text-ink outline-none"
                />
                <div className="flex items-center gap-1.5 border-t border-line px-1 pt-2">
                  <span className="min-w-0 flex-1 px-1 text-[12px] leading-snug text-faint">
                    {convBusy
                      ? 'Đang có câu trả lời chạy dở. Hãy dừng hoặc chờ xong rồi gửi lại.'
                      : 'Các tin nhắn phía sau sẽ được thay bằng câu trả lời mới.'}
                  </span>
                  <button
                    onClick={cancelEdit}
                    className="press h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] text-muted hover:bg-sunken hover:text-ink"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={submitEdit}
                    disabled={!draft.trim() || convBusy}
                    className="press h-8 shrink-0 whitespace-nowrap rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:brightness-110 disabled:bg-sunken disabled:text-faint"
                  >
                    Gửi lại
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    setDraft(message.content)
                    setEditing(true)
                  }}
                  disabled={convBusy}
                  title="Sửa yêu cầu và gửi lại"
                  className={`${actionBtn} mt-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
                >
                  <Pencil className="h-3 w-3" />
                  <span>Sửa</span>
                </button>
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-sunken px-4 py-2.5 text-[14px] leading-relaxed text-ink">
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                </div>
              </>
            )}
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                isLight ? 'bg-sunken text-muted' : 'bg-sunken text-muted'
              }`}
            >
              <User className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isStreaming = message.status === 'streaming'
  const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0)

  return (
    <div className="flex flex-col gap-2.5">
      {/* Header: mark, name and status share one baseline row */}
      <div className="flex h-7 items-center gap-2.5">
        <EgovMark size={26} />
        <span className="font-brand text-[14px] font-bold tracking-[-0.01em] text-ink">eGovAI</span>
        {isStreaming && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            <span>{hasTools ? t('chat.runningTools') : t('chat.thinking')}</span>
          </span>
        )}
        {!isStreaming && message.thinkingSeconds && message.thinkingSeconds > 0.2 && (
          <span className="tabular inline-flex items-center gap-1.5 text-[13px] text-faint">
            <Brain className="h-3.5 w-3.5" />
            <span>{t('chat.thoughtFor', { seconds: message.thinkingSeconds.toFixed(1) })}</span>
          </span>
        )}
      </div>

      {/* Body lines up with the name, not the mark */}
      <div className="min-w-0 space-y-3 pl-9">
        {hasTools && <ToolTimeline toolCalls={message.toolCalls!} isStreaming={isStreaming} />}

        {/* Markdown Response */}
        {message.content && (
          <div className="markdown-body text-[14.5px] text-ink">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={markdownUrlTransform}
              components={{
                img: ({ src, alt }) => {
                  const cls = classifyImageSrc(typeof src === 'string' ? src : '')
                  if (cls.kind === 'local') {
                    return (
                      <img
                        src={cls.src}
                        alt={alt ?? ''}
                        loading="lazy"
                        className="my-2 max-h-[420px] max-w-full rounded-lg border border-line"
                      />
                    )
                  }
                  if (cls.kind === 'remote') {
                    return (
                      <a
                        href={cls.url}
                        onClick={(e) => {
                          e.preventDefault()
                          void window.googleAI.openExternalUrl(cls.url)
                        }}
                        title={`Ảnh không tự tải để tránh lộ dữ liệu. Bấm để mở bằng trình duyệt: ${cls.url}`}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-px text-[12.5px] text-muted no-underline hover:text-ink"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        <span>
                          Ảnh từ Internet: {cls.host}
                          {alt ? ` — ${alt}` : ''}
                        </span>
                      </a>
                    )
                  }
                  return (
                    <span className="text-[12.5px] text-faint">[Ảnh bị chặn{alt ? `: ${alt}` : ''}]</span>
                  )
                },
                a: ({ href, children, ...props }) => {
                  const localPath = href
                    ? resolveLocalFileHref(href, activeProject?.path)
                    : null
                  if (localPath) {
                    return (
                      <a
                        href={href}
                        onClick={(e) => {
                          e.preventDefault()
                          void openFileInStudio(localPath)
                        }}
                        title={`Mở trong Tài liệu & Excel: ${localPath}`}
                        className="cursor-pointer font-medium"
                        {...props}
                      >
                        {children}
                      </a>
                    )
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer" {...props}>
                      {children}
                    </a>
                  )
                }
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Quick Open File Buttons for any local files referenced in the AI response */}
        {!isStreaming && linkedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {linkedFiles.map((f) => {
              const lower = f.path.toLowerCase()
              const isExcel =
                lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
              return (
                <button
                  key={f.path}
                  onClick={() => void openFileInStudio(f.path)}
                  title={`Mở trực tiếp trong Tài liệu & Excel: ${f.path}`}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    isExcel
                      ? isLight
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                      : isLight
                        ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                        : 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
                  }`}
                >
                  {isExcel ? (
                    <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="max-w-[240px] truncate">Mở {f.label}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Legal documents cited in the answer — detection only, no validity claim */}
        {legalRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="mr-0.5 inline-flex items-center gap-1 text-[12px] text-faint">
              <Scale className="h-3.5 w-3.5" />
              Văn bản được viện dẫn
            </span>
            {legalRefs.map((ref) => (
              <button
                key={ref.number}
                onClick={() => void window.googleAI.openExternalUrl(vbplSearchUrl(ref))}
                title={`Tra cứu "${ref.number}" trên vbpl.vn (Cơ sở dữ liệu quốc gia về văn bản pháp luật)`}
                className="press inline-flex h-6 items-center rounded-md border border-line px-2 text-[12px] text-muted hover:border-line-strong hover:bg-sunken hover:text-ink"
              >
                {ref.label}
              </button>
            ))}
          </div>
        )}

        {/* Error Box */}
        {message.status === 'error' && message.error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message.error}</div>
            {isLast && (
              <button
                onClick={() => void regenerateMessage(message.id)}
                disabled={convBusy}
                className="press flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 px-2 py-0.5 text-[11.5px] font-medium hover:bg-red-500/10 disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Thử lại</span>
              </button>
            )}
          </div>
        )}

        {/* Aborted notice */}
        {message.status === 'aborted' && (
          <div className="text-xs italic text-faint">{t('chat.aborted')}</div>
        )}

        {/* Footer Actions & Token Usage */}
        {!isStreaming && (message.content || (isLast && message.status === 'aborted')) && (
          <div className="flex items-center gap-1 pt-1 text-[11px] text-faint">
            {message.content && (
              <button onClick={handleCopy} className={actionBtn}>
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-ok" />
                    <span className="text-ok">{t('chat.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>{t('chat.copy')}</span>
                  </>
                )}
              </button>
            )}

            {isLast && message.status !== 'error' && (
              <button
                onClick={() => void regenerateMessage(message.id)}
                disabled={convBusy}
                title="Tạo lại câu trả lời này"
                className={actionBtn}
              >
                <RotateCcw className="h-3 w-3" />
                <span>Tạo lại</span>
              </button>
            )}

            {message.usage && message.usage.totalTokens > 0 && (
              <span className="ml-2 opacity-70">
                {message.usage.totalTokens.toLocaleString('vi-VN')} token
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
