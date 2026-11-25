import { useState } from 'react'
import {
  FileText,
  FileSpreadsheet,
  FileCode2,
  FolderOpen,
  Plus,
  X,
  AlertCircle,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  RefreshCw
} from 'lucide-react'
import type { DocKind } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'
import { DocxViewer } from './DocxViewer'
import { ExcelEditor } from './ExcelEditor'
import { TextMarkdownEditor } from './TextMarkdownEditor'
import { LiveDraftView } from './LiveDraftView'
import { LIVE_DRAFT_TAB_ID } from '../../utils/liveDraft'

interface DocumentStudioTabProps {
  isLight: boolean
}

function getKindIcon(kind: DocKind): React.JSX.Element {
  if (kind === 'docx') return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
  if (kind === 'excel') return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
  if (kind === 'pdf') return <FileText className="h-3.5 w-3.5 shrink-0 text-red-400" />
  if (kind === 'image') return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-purple-400" />
  if (kind === 'json') return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
  return <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
}

export function DocumentStudioTab({ isLight }: DocumentStudioTabProps): React.JSX.Element {
  const {
    projects,
    activeProjectId,
    openedDocs,
    activeDocPath,
    liveDraft,
    dismissLiveDraft,
    docLoadingError,
    openLoadedDocInStudio,
    setActiveDocPath,
    setDocLoadingError,
    closeDocTab,
    openFileInStudio,
    refreshActiveDoc,
    sendFileToChatComposer
  } = useAppStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const isLiveDraftSelected = Boolean(liveDraft && activeDocPath === LIVE_DRAFT_TAB_ID)
  const activeDoc = isLiveDraftSelected
    ? null
    : (openedDocs.find((d) => d.path === activeDocPath) ?? null)

  const [opening, setOpening] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [creatingKind, setCreatingKind] = useState<'markdown' | 'docx' | 'excel' | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const handlePickOpen = async (): Promise<void> => {
    setOpening(true)
    setDocLoadingError(null)
    try {
      const docs = await window.googleAI.pickOpenDocument(activeProject?.path)
      if (docs && docs.length > 0) {
        for (const doc of docs) {
          openLoadedDocInStudio(doc)
        }
      }
    } catch (err) {
      setDocLoadingError(
        err instanceof Error ? err.message : 'Không thể mở tệp đã chọn.'
      )
    } finally {
      setOpening(false)
    }
  }

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      const filePath = (f as File & { path?: string }).path
      if (filePath) {
        await openFileInStudio(filePath)
      }
    }
  }

  const handleCreateDoc = async (): Promise<void> => {
    if (!creatingKind || !activeProject || !newFileName.trim()) return
    setCreateError(null)
    try {
      const doc = await window.googleAI.createDocument(
        activeProject.path,
        newFileName.trim(),
        creatingKind
      )
      openLoadedDocInStudio(doc)
      setCreatingKind(null)
      setNewFileName('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Không thể tạo tệp mới.')
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => void handleDropFiles(e)}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-xs">
          <div className="rounded-xl bg-surface px-4 py-2.5 text-xs font-medium text-blue-200 shadow-lg">
            Thả tệp Word, Excel, PDF hoặc Văn bản vào đây để mở ngay
          </div>
        </div>
      )}

      {/* Opened Document Tabs Strip */}
      <div
        className={`flex items-center justify-between gap-1 border-b px-2 py-1.5 ${
          isLight ? 'border-line bg-sunken' : 'border-line bg-canvas'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {liveDraft && (
            <div
              onClick={() => setActiveDocPath(LIVE_DRAFT_TAB_ID)}
              title={liveDraft.title}
              className={`group flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                isLiveDraftSelected
                  ? isLight
                    ? 'bg-surface text-ink ring-1 ring-brand/40'
                    : 'bg-sunken text-white ring-1 ring-brand/50'
                  : isLight
                    ? 'text-brand hover:bg-sunken'
                    : 'text-brand hover:bg-sunken'
              }`}
            >
              {liveDraft.streaming ? (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" />
              )}
              <span className="truncate">{liveDraft.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  dismissLiveDraft()
                }}
                title="Đóng bản nháp trực tiếp"
                className="press rounded p-0.5 opacity-60 hover:bg-black/15 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {openedDocs.map((doc) => {
            const selected = doc.path === activeDocPath
            return (
              <div
                key={doc.path}
                onClick={() => setActiveDocPath(doc.path)}
                title={doc.path}
                className={`group flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  selected
                    ? isLight
                      ? 'bg-surface text-ink ring-1 ring-line'
                      : 'bg-sunken text-white'
                    : isLight
                      ? 'text-muted hover:bg-sunken'
                      : 'text-faint hover:bg-sunken hover:text-ink'
                }`}
              >
                {getKindIcon(doc.kind)}
                <span className="truncate">{doc.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeDocTab(doc.path)
                  }}
                  className="press rounded p-0.5 opacity-60 hover:bg-black/15 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>

        <button
          onClick={() => void handlePickOpen()}
          disabled={opening}
          title="Mở tệp Word, Excel, PDF hoặc Văn bản..."
          className={`press flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
            isLight
              ? 'text-blue-700 hover:bg-blue-100'
              : 'text-blue-400 hover:bg-blue-500/15'
          }`}
        >
          {opening ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
          <span>Mở tệp</span>
        </button>
      </div>

      {/* Loading Error */}
      {docLoadingError && (
        <div className="m-3 flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{docLoadingError}</span>
          </div>
          <button
            onClick={() => setDocLoadingError(null)}
            className="press rounded p-0.5 hover:bg-red-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Active Document Content OR Live Realtime Draft OR Empty Studio Launcher */}
      {isLiveDraftSelected && liveDraft ? (
        <LiveDraftView draft={liveDraft} isLight={isLight} />
      ) : !activeDoc ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
          </div>
          <h3 className="text-sm font-semibold">Không gian Tài liệu, Word &amp; Excel</h3>
          <p className="mt-1 max-w-xs text-xs text-faint">
            Bấm <strong>Mở tệp</strong>, kéo-thả tệp vào đây, hoặc bấm vào tệp đính kèm / liên kết trong khung chat để xem &amp; chỉnh sửa trực tiếp.
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => void handlePickOpen()}
              disabled={opening}
              className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              {opening ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" />
              )}
              <span>Mở Word / Excel / Văn bản</span>
            </button>
          </div>

          {activeProject && (
            <div className="mt-5 w-full max-w-sm">
              <div className="mb-2 text-[11px] font-medium text-faint">
                Hoặc tạo nhanh tệp mới trong dự án:
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setCreatingKind('docx')
                    setNewFileName('bao-cao-moi.docx')
                  }}
                  className={`press flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[11px] font-medium transition ${
                    isLight
                      ? 'border-line bg-surface hover:border-blue-400'
                      : 'border-line bg-surface hover:border-blue-500/50'
                  }`}
                >
                  <FileText className="h-4 w-4 text-brand" />
                  <span>Word .docx</span>
                </button>
                <button
                  onClick={() => {
                    setCreatingKind('excel')
                    setNewFileName('bang-tong-hop.xlsx')
                  }}
                  className={`press flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[11px] font-medium transition ${
                    isLight
                      ? 'border-line bg-surface hover:border-emerald-400'
                      : 'border-line bg-surface hover:border-emerald-500/50'
                  }`}
                >
                  <FileSpreadsheet className="h-4 w-4 text-brand" />
                  <span>Excel .xlsx</span>
                </button>
                <button
                  onClick={() => {
                    setCreatingKind('markdown')
                    setNewFileName('ghi-chu.md')
                  }}
                  className={`press flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[11px] font-medium transition ${
                    isLight
                      ? 'border-line bg-surface hover:border-indigo-400'
                      : 'border-line bg-surface hover:border-indigo-500/50'
                  }`}
                >
                  <Plus className="h-4 w-4 text-brand" />
                  <span>Văn bản .md</span>
                </button>
              </div>

              {creatingKind && (
                <div
                  className={`mt-3 rounded-xl border p-3 text-left ${
                    isLight ? 'border-line bg-surface' : 'border-line-strong bg-surface'
                  }`}
                >
                  <div className="mb-1.5 text-[11px] font-medium">Nhập tên tệp mới:</div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateDoc()
                      }}
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                        isLight
                          ? 'border-line-strong bg-canvas text-ink'
                          : 'border-line-strong bg-canvas text-ink'
                      }`}
                    />
                    <button
                      onClick={() => void handleCreateDoc()}
                      className="press rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    >
                      Tạo
                    </button>
                    <button
                      onClick={() => setCreatingKind(null)}
                      className="press rounded-lg px-2 py-1.5 text-xs text-faint hover:bg-sunken"
                    >
                      Hủy
                    </button>
                  </div>
                  {createError && <div className="mt-1 text-[11px] text-red-400">{createError}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeDoc.parseError ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="mb-2 h-8 w-8 text-amber-400" />
          <div className="text-sm font-semibold">{activeDoc.name}</div>
          <p className="mt-1.5 max-w-sm text-xs text-faint">{activeDoc.parseError}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => void refreshActiveDoc()}
              className={`press flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                isLight
                  ? 'border-line-strong bg-surface text-muted hover:bg-sunken'
                  : 'border-line-strong text-ink hover:bg-sunken'
              }`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Thử tải lại</span>
            </button>
            <button
              onClick={() => void window.googleAI.openPath(activeDoc.path)}
              className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Mở bằng ứng dụng Windows</span>
            </button>
            <button
              onClick={() =>
                sendFileToChatComposer(
                  { type: 'file', path: activeDoc.path, name: activeDoc.name },
                  `Hãy đọc và phân tích tệp "${activeDoc.name}" giúp tôi.`
                )
              }
              className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Gửi eGovAI xử lý</span>
            </button>
          </div>
        </div>
      ) : activeDoc.kind === 'excel' ? (
        <ExcelEditor doc={activeDoc} isLight={isLight} />
      ) : activeDoc.kind === 'docx' ? (
        <DocxViewer doc={activeDoc} isLight={isLight} />
      ) : activeDoc.kind === 'pdf' && activeDoc.dataUrl ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={`flex items-center justify-between border-b px-3 py-2 ${
              isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
            }`}
          >
            <span className="truncate text-xs font-medium">{activeDoc.name}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void window.googleAI.openPath(activeDoc.path)}
                className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition ${
                  isLight
                    ? 'border-line-strong bg-surface text-muted hover:bg-sunken'
                    : 'border-line-strong text-ink hover:bg-sunken'
                }`}
              >
                <ExternalLink className="h-3 w-3" />
                <span>Mở ngoài</span>
              </button>
              <button
                onClick={() =>
                  sendFileToChatComposer(
                    { type: 'file', path: activeDoc.path, name: activeDoc.name },
                    `Hãy đọc và tóm tắt tài liệu PDF "${activeDoc.name}" giúp tôi.`
                  )
                }
                className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
              >
                <Sparkles className="h-3 w-3" />
                <span>Hỏi AI</span>
              </button>
            </div>
          </div>
          <iframe src={activeDoc.dataUrl} title={activeDoc.name} className="min-h-0 flex-1 w-full bg-surface" />
        </div>
      ) : activeDoc.kind === 'image' && activeDoc.dataUrl ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={`flex items-center justify-between border-b px-3 py-2 ${
              isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
            }`}
          >
            <span className="truncate text-xs font-medium">{activeDoc.name}</span>
            <button
              onClick={() =>
                sendFileToChatComposer(
                  { type: 'image', path: activeDoc.path, name: activeDoc.name },
                  `Hãy phân tích nội dung hình ảnh "${activeDoc.name}" giúp tôi.`
                )
              }
              className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
            >
              <Sparkles className="h-3 w-3" />
              <span>Hỏi AI</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={activeDoc.dataUrl}
              alt={activeDoc.name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-md"
            />
          </div>
        </div>
      ) : activeDoc.kind === 'markdown' || activeDoc.kind === 'text' || activeDoc.kind === 'json' ? (
        <TextMarkdownEditor doc={activeDoc} isLight={isLight} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <FileText className="mb-2 h-8 w-8 text-faint" />
          <div className="text-sm font-medium">{activeDoc.name}</div>
          <p className="mt-1 text-xs text-faint">
            Định dạng {activeDoc.ext || 'tệp này'} chưa hỗ trợ xem trực tiếp trong ứng dụng.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void window.googleAI.openPath(activeDoc.path)}
              className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Mở trên Windows</span>
            </button>
            <button
              onClick={() =>
                sendFileToChatComposer(
                  { type: 'file', path: activeDoc.path, name: activeDoc.name },
                  `Hãy hỗ trợ xử lý tệp "${activeDoc.name}".`
                )
              }
              className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Gửi AI</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
