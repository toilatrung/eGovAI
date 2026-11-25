import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, FileDown, Loader2, Sparkles } from 'lucide-react'
import { useAppStore, type LiveDraftState } from '../../stores/useAppStore'
import { countVietnameseWords } from '../../utils/liveDraft'
import { markdownUrlTransform } from '../../utils/markdownSafety'

interface LiveDraftViewProps {
  draft: LiveDraftState
  isLight: boolean
}

function suggestDocxFilename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)
  return `${slug || 'ban-nhap-tai-lieu'}.docx`
}

export function LiveDraftView({ draft, isLight }: LiveDraftViewProps): React.JSX.Element {
  const { projects, activeProjectId, openFileInStudio } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const wordCount = countVietnameseWords(draft.content)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 72
  }

  useEffect(() => {
    if (!draft.streaming || !stickToBottomRef.current) return
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [draft.content, draft.streaming])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(draft.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleExportDocx = async (): Promise<void> => {
    if (!draft.content.trim() || exporting) return
    setExporting(true)
    setExportNote(null)
    try {
      const defaultName = suggestDocxFilename(draft.title)
      const defaultDir = activeProject?.path ?? ''
      const saved = await window.googleAI.exportDocx(defaultName, defaultDir, draft.content)
      if (saved?.path) {
        setExportNote(`Đã lưu ${saved.path}`)
        await openFileInStudio(saved.path)
      }
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'Không thể xuất tệp Word.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Realtime Status & Actions Bar */}
      <div
        className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 ${
          isLight ? 'bg-surface' : 'bg-surface/60'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {draft.streaming ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-medium text-brand">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              <span>Đang soạn thảo trực tiếp…</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-3 w-3" />
              <span>Hoàn tất bản nháp</span>
            </span>
          )}
          <span className="tabular text-[11px] text-faint">{wordCount.toLocaleString('vi-VN')} từ</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="press inline-flex h-7 items-center gap-1 rounded-md border border-line bg-canvas px-2 text-[11.5px] font-medium text-muted hover:text-ink"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
          </button>

          <button
            type="button"
            disabled={draft.streaming || exporting || !draft.content.trim()}
            onClick={() => void handleExportDocx()}
            title="Xuất bản nháp này thành tệp Word (.docx)"
            className="press inline-flex h-7 items-center gap-1 rounded-md bg-brand px-2.5 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileDown className="h-3 w-3" />
            )}
            <span>Xuất Word (.docx)</span>
          </button>
        </div>
      </div>

      {exportNote && (
        <div className="shrink-0 border-b border-line bg-sunken px-3 py-1.5 text-[11px] text-muted">
          {exportNote}
        </div>
      )}

      {/* Paper-style Realtime Document Canvas */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${
          isLight ? 'bg-sunken/60' : 'bg-canvas'
        }`}
      >
        <div
          className={`mx-auto min-h-full max-w-[740px] rounded-xl border border-line px-6 py-5 shadow-xs ${
            isLight ? 'bg-white text-ink' : 'bg-surface text-ink'
          }`}
        >
          <div className="prose prose-sm max-w-none break-words text-[13.5px] leading-relaxed dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>
              {draft.content}
            </ReactMarkdown>
            {draft.streaming && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-xs bg-brand align-middle"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
