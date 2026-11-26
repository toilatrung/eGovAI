import { useState } from 'react'
import { Check, Copy, FileDown, FileText, Loader2, PanelRightOpen } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { countVietnameseWords } from '../../utils/liveDraft'
import { markdownToPlainText } from '../../utils/markdownBreaks'

interface DocumentCardProps {
  conversationId: string
  messageId: string
  /** Thứ tự khối egov-doc; undefined = cả câu trả lời là văn bản. */
  docIndex?: number
  title: string
  body: string
  streaming: boolean
}

/**
 * Thẻ gọn thay cho toàn văn trong chat: văn bản đầy đủ nằm ở tab Tài liệu
 * (góp ý: không lặp lại văn bản ở cả hai nơi).
 */
export function DocumentCard({
  conversationId,
  messageId,
  docIndex,
  title,
  body,
  streaming
}: DocumentCardProps): React.JSX.Element {
  const openMessageDocument = useAppStore((s) => s.openMessageDocument)
  const openFileInStudio = useAppStore((s) => s.openFileInStudio)
  const projectPath = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path)
  const isShown = useAppStore(
    (s) =>
      s.auxOpen &&
      s.auxTab === 'doc' &&
      s.liveDraft?.messageId === messageId &&
      (docIndex === undefined || s.liveDraft?.docIndex === docIndex)
  )
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const words = countVietnameseWords(markdownToPlainText(body))

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(markdownToPlainText(body))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const handleSave = async (): Promise<void> => {
    if (!projectPath || saving) return
    setSaving(true)
    setNote(null)
    try {
      const saved = await window.googleAI.saveDraftDocx(projectPath, title || 'Van ban', body)
      setNote(`Đã lưu: ${saved.path}`)
      await openFileInStudio(saved.path)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Không lưu được tệp Word.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink" title={title}>
            {title || 'Văn bản'}
          </div>
          <div className="mt-0.5 text-[12px] text-faint">
            {streaming ? 'Đang soạn trong tab Tài liệu…' : 'Đã soạn xong'} ·{' '}
            <span className="tabular">{words.toLocaleString('vi-VN')} từ</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-12">
        <button
          type="button"
          onClick={() => openMessageDocument(conversationId, messageId, docIndex)}
          className={`press inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${
            isShown
              ? 'bg-sunken text-muted'
              : 'bg-brand text-white hover:brightness-110'
          }`}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          <span>{isShown ? 'Đang mở trong Tài liệu' : 'Mở trong Tài liệu'}</span>
        </button>
        <button
          type="button"
          disabled={streaming || saving || !projectPath}
          onClick={() => void handleSave()}
          title="Lưu thành tệp Word trong thư mục Van-ban của dự án"
          className="press inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-[12px] text-muted hover:text-ink disabled:opacity-45"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          <span>Lưu Word</span>
        </button>
        <button
          type="button"
          disabled={streaming}
          onClick={handleCopy}
          className="press inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-[12px] text-muted hover:text-ink disabled:opacity-45"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
        </button>
      </div>
      {note && <div className="mt-2 break-all pl-12 text-[11.5px] text-faint">{note}</div>}
    </div>
  )
}
