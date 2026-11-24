import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Save,
  Eye,
  Edit3,
  Columns2,
  FileDown,
  RefreshCw,
  Sparkles,
  Check,
  AlertCircle
} from 'lucide-react'
import type { OpenedDocument } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

interface TextMarkdownEditorProps {
  doc: OpenedDocument
  isLight: boolean
}

export function TextMarkdownEditor({ doc, isLight }: TextMarkdownEditorProps): React.JSX.Element {
  const { refreshActiveDoc, openFileInStudio, sendFileToChatComposer } = useAppStore()
  const [content, setContent] = useState(doc.textContent ?? '')
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>(
    doc.kind === 'markdown' ? 'split' : 'edit'
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    setContent(doc.textContent ?? '')
    setDirty(false)
    setJsonError(null)
    setViewMode(doc.kind === 'markdown' ? 'split' : 'edit')
  }, [doc.path, doc.mtimeMs, doc.textContent, doc.kind])

  const handleChange = (val: string): void => {
    setContent(val)
    setDirty(true)
    if (doc.kind === 'json') {
      try {
        JSON.parse(val)
        setJsonError(null)
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'JSON không hợp lệ')
      }
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.googleAI.saveTextDocument(doc.path, content)
      setDirty(false)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  const handleExportDocx = async (): Promise<void> => {
    const dir = doc.path.replace(/[\\/][^\\/]+$/, '')
    const base = doc.name.replace(/\.[^.]+$/, '')
    const res = await window.googleAI.exportDocx(`${base}.docx`, dir, content)
    if (res) {
      await openFileInStudio(res.path)
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const lineCount = content.split(/\r?\n/).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`press flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              dirty
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : isLight
                  ? 'border border-line bg-surface text-muted hover:bg-sunken'
                  : 'border border-line-strong bg-sunken text-ink hover:bg-line-strong'
            }`}
          >
            {savedToast ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            <span>{savedToast ? 'Đã lưu' : dirty ? 'Lưu*' : 'Lưu'}</span>
          </button>

          {doc.kind === 'markdown' && (
            <div
              className={`flex items-center gap-0.5 rounded-lg p-0.5 text-[11px] ${
                isLight ? 'bg-sunken' : 'bg-black/25'
              }`}
            >
              <button
                onClick={() => setViewMode('edit')}
                title="Chỉ soạn thảo"
                className={`press rounded-md p-1 transition ${
                  viewMode === 'edit'
                    ? 'bg-blue-600 text-white'
                    : isLight
                      ? 'text-muted hover:text-ink'
                      : 'text-faint hover:text-ink'
                }`}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('split')}
                title="Chia đôi soạn thảo & xem trước"
                className={`press rounded-md p-1 transition ${
                  viewMode === 'split'
                    ? 'bg-blue-600 text-white'
                    : isLight
                      ? 'text-muted hover:text-ink'
                      : 'text-faint hover:text-ink'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('preview')}
                title="Chỉ xem trước"
                className={`press rounded-md p-1 transition ${
                  viewMode === 'preview'
                    ? 'bg-blue-600 text-white'
                    : isLight
                      ? 'text-muted hover:text-ink'
                      : 'text-faint hover:text-ink'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {(doc.kind === 'markdown' || doc.kind === 'text') && (
            <button
              onClick={() => void handleExportDocx()}
              title="Xuất sang tệp Word (.docx) chuẩn Times New Roman 14pt, lề Nghị định 30"
              className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                isLight
                  ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
              }`}
            >
              <FileDown className="h-3 w-3" />
              <span>Xuất Word</span>
            </button>
          )}

          <button
            onClick={() => void refreshActiveDoc()}
            title="Tải lại từ đĩa"
            className={`press rounded-lg p-1.5 transition ${
              isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5 text-faint" />
          </button>

          <button
            onClick={() =>
              sendFileToChatComposer(
                { type: 'file', path: doc.path, name: doc.name },
                `Hãy rà soát và góp ý chỉnh sửa cho tài liệu "${doc.name}" giúp tôi.`
              )
            }
            className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-500"
          >
            <Sparkles className="h-3 w-3" />
            <span>Hỏi AI</span>
          </button>
        </div>
      </div>

      {/* JSON syntax warning */}
      {jsonError && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Lỗi cú pháp JSON: {jsonError}</span>
        </div>
      )}

      {/* Editor / Preview Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            className={`min-h-0 flex-1 resize-none p-3.5 text-xs leading-relaxed outline-none ${
              doc.kind === 'json' ? 'font-mono' : 'font-sans text-[13px]'
            } ${
              isLight
                ? 'bg-surface text-ink'
                : 'bg-surface text-ink'
            } ${viewMode === 'split' ? 'border-r border-line' : ''}`}
          />
        )}

        {(viewMode === 'preview' || viewMode === 'split') && doc.kind === 'markdown' && (
          <div
            className={`min-h-0 flex-1 overflow-y-auto p-4 ${
              isLight ? 'bg-canvas' : 'bg-canvas'
            }`}
          >
            <div className="markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`flex items-center justify-between border-t px-3 py-1 text-[10px] text-faint ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-canvas'
        }`}
      >
        <span className="truncate">{doc.path}</span>
        <span className="shrink-0">
          {lineCount} dòng · {wordCount.toLocaleString('vi-VN')} từ
        </span>
      </div>
    </div>
  )
}
