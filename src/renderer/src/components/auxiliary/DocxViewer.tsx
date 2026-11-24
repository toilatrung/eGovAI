import { useEffect, useState } from 'react'
import {
  ExternalLink,
  RefreshCw,
  Sparkles,
  FileDown,
  Eye,
  Edit3,
  FolderOpen,
  Check
} from 'lucide-react'
import type { OpenedDocument } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

interface DocxViewerProps {
  doc: OpenedDocument
  isLight: boolean
}

export function DocxViewer({ doc, isLight }: DocxViewerProps): React.JSX.Element {
  const { refreshActiveDoc, openFileInStudio, sendFileToChatComposer } = useAppStore()
  const [mode, setMode] = useState<'preview' | 'quick-edit'>('preview')
  const [draftText, setDraftText] = useState(doc.docxPlainText ?? '')
  const [exporting, setExporting] = useState(false)
  const [exportedNotice, setExportedNotice] = useState<string | null>(null)

  useEffect(() => {
    setDraftText(doc.docxPlainText ?? '')
    setMode('preview')
  }, [doc.path, doc.mtimeMs, doc.docxPlainText])

  const wordCount = draftText.trim() ? draftText.trim().split(/\s+/).length : 0

  const handleExportNewDocx = async (): Promise<void> => {
    setExporting(true)
    try {
      const dir = doc.path.replace(/[\\/][^\\/]+$/, '')
      const base = doc.name.replace(/\.docx$/i, '')
      const res = await window.googleAI.exportDocx(`${base}-ban-sua.docx`, dir, draftText)
      if (res) {
        setExportedNotice(`Đã xuất: ${res.path.split(/[\\/]/).pop()}`)
        setTimeout(() => setExportedNotice(null), 2500)
        await openFileInStudio(res.path)
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div
          className={`flex items-center gap-1 rounded-lg p-0.5 text-[11px] ${
            isLight ? 'bg-sunken' : 'bg-black/25'
          }`}
        >
          <button
            onClick={() => setMode('preview')}
            className={`press flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
              mode === 'preview'
                ? 'bg-blue-600 text-white'
                : isLight
                  ? 'text-muted hover:text-ink'
                  : 'text-faint hover:text-ink'
            }`}
          >
            <Eye className="h-3 w-3" />
            <span>Bản in A4</span>
          </button>
          <button
            onClick={() => setMode('quick-edit')}
            className={`press flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
              mode === 'quick-edit'
                ? 'bg-blue-600 text-white'
                : isLight
                  ? 'text-muted hover:text-ink'
                  : 'text-faint hover:text-ink'
            }`}
          >
            <Edit3 className="h-3 w-3" />
            <span>Sửa nhanh</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {mode === 'quick-edit' && (
            <button
              onClick={() => void handleExportNewDocx()}
              disabled={exporting}
              className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-500"
            >
              {exportedNotice ? <Check className="h-3 w-3" /> : <FileDown className="h-3 w-3" />}
              <span>{exportedNotice ?? 'Xuất .docx (NĐ 30)'}</span>
            </button>
          )}

          <button
            onClick={() => void refreshActiveDoc()}
            title="Tải lại sau khi chỉnh sửa trong Word"
            className={`press rounded-lg p-1.5 transition ${
              isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5 text-faint" />
          </button>

          <button
            onClick={() => void window.googleAI.revealInExplorer(doc.path)}
            title="Hiển thị trong File Explorer"
            className={`press rounded-lg p-1.5 transition ${
              isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5 text-faint" />
          </button>

          <button
            onClick={() => void window.googleAI.openPath(doc.path)}
            title="Mở tệp bằng Microsoft Word (giữ nguyên 100% định dạng)"
            className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
              isLight
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
            }`}
          >
            <ExternalLink className="h-3 w-3" />
            <span>Mở Word</span>
          </button>

          <button
            onClick={() =>
              sendFileToChatComposer(
                { type: 'file', path: doc.path, name: doc.name },
                `Hãy rà soát nội dung, văn phong, căn cứ pháp lý và thể thức Nghị định 30/2020/NĐ-CP của văn bản "${doc.name}".`
              )
            }
            className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-500"
          >
            <Sparkles className="h-3 w-3" />
            <span>AI rà soát</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {mode === 'preview' ? (
        <div
          className={`min-h-0 flex-1 overflow-y-auto p-4 ${
            isLight ? 'bg-sunken' : 'bg-canvas'
          }`}
        >
          <div className="mx-auto min-h-[620px] max-w-[740px] rounded-md bg-white px-10 py-9 text-slate-900 shadow-lg ring-1 ring-slate-300/60">
            <div
              className="docx-paper"
              dangerouslySetInnerHTML={{
                __html:
                  doc.htmlPreview ||
                  '<p style="color:#64748b">Tệp Word chưa có nội dung văn bản.</p>'
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={`border-b px-3 py-1.5 text-[11px] ${
              isLight
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
            }`}
          >
            Chỉnh sửa nhanh nội dung rồi nhấn <strong>Xuất .docx (NĐ 30)</strong> (Times New Roman 14pt, lề A4 20/20/30/15mm), hoặc mở trực tiếp bằng <strong>Microsoft Word</strong> để giữ nguyên bố cục phức tạp.
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            className={`min-h-0 flex-1 resize-none p-4 font-serif text-sm leading-relaxed outline-none ${
              isLight ? 'bg-surface text-ink' : 'bg-canvas text-ink'
            }`}
          />
        </div>
      )}

      {/* Status footer */}
      <div
        className={`flex items-center justify-between border-t px-3 py-1 text-[10px] text-faint ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-canvas'
        }`}
      >
        <span className="truncate">{doc.path}</span>
        <span className="shrink-0">{wordCount.toLocaleString('vi-VN')} từ</span>
      </div>
    </div>
  )
}
