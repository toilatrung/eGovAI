import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Check,
  Copy,
  ExternalLink,
  FileDown,
  Loader2,
  PenLine,
  Save,
  Sparkles
} from 'lucide-react'
import { useAppStore, type LiveDraftState } from '../../stores/useAppStore'
import { countVietnameseWords } from '../../utils/liveDraft'
import { markdownUrlTransform } from '../../utils/markdownSafety'
import { markdownToPlainText } from '../../utils/markdownBreaks'
import {
  findPlaceholders,
  isLayoutTableHeader,
  normalizeDraftMarkdown,
  splitPlaceholders
} from '../../../../shared/draftMarkdown'

interface LiveDraftViewProps {
  draft: LiveDraftState
  isLight: boolean
}

function suggestDocxFilename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)
  return `${slug || 'ban-nhap-tai-lieu'}.docx`
}

const BR_SPLIT = /<br\s*\/?>/i

/** Chuỗi → ngắt dòng `<br>` + tô vàng chỗ trống cần điền. */
function decorateText(text: string, keyBase: string): ReactNode {
  const lines = text.replace(/&nbsp;/gi, ' ').split(BR_SPLIT)
  return lines.map((line, li) => (
    <Fragment key={`${keyBase}-${li}`}>
      {li > 0 && <br />}
      {splitPlaceholders(line).map((part, pi) =>
        part.placeholder ? (
          <mark key={pi} className="egov-placeholder" title="Chỗ cần điền">
            {part.text}
          </mark>
        ) : (
          <Fragment key={pi}>{part.text}</Fragment>
        )
      )}
    </Fragment>
  ))
}

function decorate(children: ReactNode, keyBase = 'k'): ReactNode {
  if (typeof children === 'string') return decorateText(children, keyBase)
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === 'string' ? <Fragment key={i}>{decorateText(c, `${keyBase}-${i}`)}</Fragment> : c
    )
  }
  return children
}

interface HastLike {
  type?: string
  tagName?: string
  value?: string
  children?: HastLike[]
}

function hastText(node: HastLike | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/** Các ô của hàng đầu tiên trong bảng (để nhận biết bảng Quốc hiệu / Nơi nhận). */
function firstRowCells(table: HastLike | undefined): string[] {
  const findTr = (n: HastLike | undefined): HastLike | undefined => {
    if (!n) return undefined
    if (n.tagName === 'tr') return n
    for (const c of n.children ?? []) {
      const hit = findTr(c)
      if (hit) return hit
    }
    return undefined
  }
  const tr = findTr(table)
  return (tr?.children ?? [])
    .filter((c) => c.tagName === 'td' || c.tagName === 'th')
    .map((c) => hastText(c))
}

const paperComponents: Components = {
  p: ({ children }) => <p>{decorate(children, 'p')}</p>,
  li: ({ children }) => <li>{decorate(children, 'li')}</li>,
  td: ({ children, style }) => <td style={style}>{decorate(children, 'td')}</td>,
  th: ({ children, style }) => <th style={style}>{decorate(children, 'th')}</th>,
  strong: ({ children }) => <strong>{decorate(children, 'b')}</strong>,
  em: ({ children }) => <em>{decorate(children, 'i')}</em>,
  h1: ({ children }) => <h1>{decorate(children, 'h1')}</h1>,
  h2: ({ children }) => <h2>{decorate(children, 'h2')}</h2>,
  h3: ({ children }) => <h3>{decorate(children, 'h3')}</h3>,
  h4: ({ children }) => <h4>{decorate(children, 'h4')}</h4>,
  table: ({ node, children }) => {
    const cells = firstRowCells(node as HastLike)
    const layout = isLayoutTableHeader(cells)
    const signature = layout && /^\s*nơi\s+nhận/i.test(cells[0] ?? '')
    return (
      <div
        className={
          layout ? `egov-layout-table${signature ? ' egov-sign-table' : ''}` : 'egov-data-table'
        }
      >
        <table>{children}</table>
      </div>
    )
  },
  hr: () => null
}

export function LiveDraftView({ draft, isLight }: LiveDraftViewProps): React.JSX.Element {
  const { projects, activeProjectId, openFileInStudio, updateLiveDraftContent } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'word' | 'export'>(null)
  const [note, setNote] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [fillTarget, setFillTarget] = useState<string | null>(null)
  const [fillValue, setFillValue] = useState('')

  const content = useMemo(() => normalizeDraftMarkdown(draft.content), [draft.content])
  const placeholders = useMemo(
    () => (draft.streaming ? [] : findPlaceholders(content)),
    [content, draft.streaming]
  )
  const wordCount = countVietnameseWords(markdownToPlainText(content))

  useEffect(() => {
    setSavedPath(null)
    setNote(null)
    setFillTarget(null)
  }, [draft.messageId, draft.docIndex])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72
  }

  useEffect(() => {
    if (!draft.streaming || !stickToBottomRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [draft.content, draft.streaming])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(markdownToPlainText(content))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  /** Lưu .docx vào <dự án>/Van-ban/ (không hỏi nơi lưu). */
  const saveToProject = async (): Promise<string | null> => {
    if (!activeProject?.path) {
      setNote('Chưa chọn thư mục dự án để lưu.')
      return null
    }
    const saved = await window.googleAI.saveDraftDocx(activeProject.path, draft.title, draft.content)
    setSavedPath(saved.path)
    return saved.path
  }

  const run = async (kind: 'save' | 'word' | 'export'): Promise<void> => {
    if (busy || draft.streaming || !draft.content.trim()) return
    setBusy(kind)
    setNote(null)
    try {
      if (kind === 'export') {
        const saved = await window.googleAI.exportDocx(
          suggestDocxFilename(draft.title),
          activeProject?.path ?? '',
          draft.content
        )
        if (saved?.path) setNote(`Đã lưu ${saved.path}`)
        return
      }
      const path = await saveToProject()
      if (!path) return
      if (kind === 'word') {
        await window.googleAI.openPath(path)
        setNote(`Đã mở bằng Word: ${path}`)
      } else {
        setNote(`Đã lưu: ${path}`)
        await openFileInStudio(path)
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Không thể lưu tệp Word.')
    } finally {
      setBusy(null)
    }
  }

  const applyFill = (): void => {
    if (!fillTarget) return
    const value = fillValue.trim()
    if (!value) return
    updateLiveDraftContent(content.split(fillTarget).join(value))
    setFillTarget(null)
    setFillValue('')
  }

  const pillBtn =
    'press inline-flex h-7 items-center gap-1 rounded-md border border-line bg-canvas px-2 text-[11.5px] font-medium text-muted hover:text-ink disabled:opacity-45'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 ${
          isLight ? 'bg-surface' : 'bg-surface/60'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {draft.streaming ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-medium text-brand">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              <span>Đang soạn…</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-3 w-3" />
              <span>{draft.edited ? 'Đã chỉnh sửa' : 'Đã soạn xong'}</span>
            </span>
          )}
          <span className="tabular text-[11px] text-faint">{wordCount.toLocaleString('vi-VN')} từ</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={handleCopy} disabled={draft.streaming} className={pillBtn}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
          </button>
          <button
            type="button"
            disabled={draft.streaming || busy !== null}
            onClick={() => void run('export')}
            title="Chọn nơi lưu tệp Word"
            className={pillBtn}
          >
            {busy === 'export' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            <span>Lưu ở nơi khác…</span>
          </button>
          <button
            type="button"
            disabled={draft.streaming || busy !== null}
            onClick={() => void run('word')}
            title="Lưu vào thư mục Van-ban của dự án rồi mở bằng Microsoft Word để chỉnh sửa"
            className={pillBtn}
          >
            {busy === 'word' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            <span>Mở bằng Word</span>
          </button>
          <button
            type="button"
            disabled={draft.streaming || busy !== null || !draft.content.trim()}
            onClick={() => void run('save')}
            title="Lưu thành tệp Word (.docx) trong thư mục Van-ban của dự án"
            className="press inline-flex h-7 items-center gap-1 rounded-md bg-brand px-2.5 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {busy === 'save' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
            <span>{savedPath ? 'Lưu lại Word' : 'Lưu Word'}</span>
          </button>
        </div>
      </div>

      {placeholders.length > 0 && (
        <div className="shrink-0 border-b border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex flex-wrap items-center gap-1.5">
            <PenLine className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">Còn {placeholders.length} chỗ cần điền:</span>
            {placeholders.slice(0, 12).map((ph) => (
              <button
                key={ph}
                type="button"
                onClick={() => {
                  setFillTarget(ph)
                  setFillValue('')
                }}
                className={`press rounded-md border px-1.5 py-0.5 text-[11.5px] ${
                  fillTarget === ph
                    ? 'border-amber-500 bg-amber-200/70 dark:bg-amber-500/30'
                    : 'border-amber-300 bg-white/70 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent'
                }`}
                title="Bấm để điền"
              >
                {ph.length > 28 ? `${ph.slice(0, 27)}…` : ph}
              </button>
            ))}
          </div>
          {fillTarget && (
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                applyFill()
              }}
            >
              <span className="shrink-0">Thay “{fillTarget.length > 24 ? `${fillTarget.slice(0, 23)}…` : fillTarget}” bằng:</span>
              <input
                autoFocus
                value={fillValue}
                onChange={(e) => setFillValue(e.target.value)}
                className="h-7 min-w-0 flex-1 rounded-md border border-amber-300 bg-white px-2 text-[12.5px] text-ink outline-none focus:border-amber-500 dark:bg-canvas"
                placeholder="Nhập nội dung…"
              />
              <button
                type="submit"
                className="press h-7 shrink-0 rounded-md bg-amber-600 px-2.5 text-[11.5px] font-medium text-white hover:brightness-110"
              >
                Điền tất cả
              </button>
              <button
                type="button"
                onClick={() => setFillTarget(null)}
                className="press h-7 shrink-0 rounded-md px-2 text-[11.5px] hover:bg-amber-100 dark:hover:bg-amber-500/20"
              >
                Hủy
              </button>
            </form>
          )}
        </div>
      )}

      {note && (
        <div className="shrink-0 break-all border-b border-line bg-sunken px-3 py-1.5 text-[11px] text-muted">
          {note}
        </div>
      )}

      {/* Trang văn bản kiểu A4 theo thể thức NĐ 30 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${isLight ? 'bg-sunken/60' : 'bg-canvas'}`}
      >
        <div className="egov-paper mx-auto min-h-full max-w-[760px] rounded-md border border-line shadow-xs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={markdownUrlTransform}
            components={paperComponents}
          >
            {content}
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
  )
}
