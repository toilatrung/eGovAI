import { useEffect, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Lock, ShieldCheck, Trash2 } from 'lucide-react'
import type { StorageSecurityStatus } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 ngày' },
  { value: 90, label: '90 ngày (mặc định)' },
  { value: 180, label: '180 ngày' },
  { value: 365, label: '1 năm' },
  { value: 0, label: 'Giữ vĩnh viễn' }
]

export function DataProtectionSection({
  cardClass,
  isLight
}: {
  cardClass: string
  isLight: boolean
}): React.JSX.Element {
  const { settings, updateSettings, conversations } = useAppStore()
  const [status, setStatus] = useState<StorageSecurityStatus | null>(null)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    void window.googleAI
      .getSecurityStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  const retention = settings.historyRetentionDays ?? 90
  const selectClass = `mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none ${
    isLight ? 'border-line bg-canvas text-ink' : 'border-line-strong bg-surface text-ink'
  }`
  const buttonClass = `press flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
    isLight ? 'border-line bg-canvas hover:bg-sunken' : 'border-line-strong bg-surface hover:bg-sunken'
  }`

  const handleWipe = async (): Promise<void> => {
    setWiping(true)
    setNotice(null)
    try {
      const count = await window.googleAI.clearAllHistory()
      useAppStore.setState({ conversations: [], activeConversationId: null })
      setNotice({ kind: 'ok', text: `Đã xoá ${count} hội thoại đã lưu trên máy này.` })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `Không xoá được lịch sử: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setWiping(false)
      setConfirmingWipe(false)
    }
  }

  const handleExportAudit = async (): Promise<void> => {
    setExporting(true)
    setNotice(null)
    try {
      const res = await window.googleAI.exportAuditLogXlsx()
      if (res) {
        setNotice({
          kind: 'ok',
          text:
            `Đã xuất ${res.rows} dòng nhật ký ra ${res.path}` +
            (res.unreadable ? ` (${res.unreadable} dòng không giải mã được)` : '')
        })
      }
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `Không xuất được nhật ký: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-brand" />
          <span>Bảo vệ dữ liệu &amp; nhật ký hoạt động</span>
        </div>
        {status && (
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              status.encrypted
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'bg-amber-500/15 text-amber-500'
            }`}
          >
            <Lock aria-hidden="true" className="h-3 w-3" />
            {status.encrypted ? 'Lịch sử đã được mã hoá' : 'Lịch sử chưa được mã hoá'}
          </span>
        )}
      </div>

      <p className="text-[11px] text-faint">
        Lịch sử hội thoại được mã hoá bằng tài khoản Windows của bạn (DPAPI). Tệp đính kèm có dấu
        độ mật (MẬT, TỐI MẬT, TUYỆT MẬT) sẽ bị chặn, không gửi tới AI. Mọi yêu cầu, bước công cụ,
        tệp AI ghi và thao tác điều khiển máy tính được ghi vào nhật ký (không lưu toàn văn tài liệu).
      </p>

      {status?.writesBlocked && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px]">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            {status.loadError ??
              'Không đọc được tệp lịch sử; ứng dụng đang tạm không ghi để tránh mất dữ liệu.'}
          </span>
        </div>
      )}

      <div>
        <label htmlFor="history-retention" className="block text-xs font-medium">
          Thời gian lưu lịch sử hội thoại
        </label>
        <select
          id="history-retention"
          value={retention}
          onChange={(e) => void updateSettings({ historyRetentionDays: Number(e.target.value) })}
          className={selectClass}
        >
          {RETENTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-1 text-[11px] text-faint">
          Hội thoại không cập nhật quá thời hạn sẽ tự xoá khi khởi động ứng dụng (trừ hội thoại đã
          ghim).
          {status && status.prunedOnStartup > 0
            ? ` Lần khởi động này đã xoá ${status.prunedOnStartup} hội thoại quá hạn.`
            : ''}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void handleExportAudit()} disabled={exporting} className={buttonClass}>
          <FileSpreadsheet aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{exporting ? 'Đang xuất...' : 'Xuất nhật ký (Excel)'}</span>
        </button>

        {!confirmingWipe && (
          <button
            onClick={() => {
              setNotice(null)
              setConfirmingWipe(true)
            }}
            className="press flex items-center gap-1.5 rounded-xl border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-500/10"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Xoá toàn bộ lịch sử hội thoại</span>
          </button>
        )}
      </div>

      {confirmingWipe && (
        <div
          role="alertdialog"
          aria-labelledby="wipe-confirm-title"
          className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs"
        >
          <div id="wipe-confirm-title" className="font-semibold text-red-500">
            Xoá vĩnh viễn {conversations.length} hội thoại đã lưu?
          </div>
          <div className="text-[11px]">
            Toàn bộ lịch sử trò chuyện trên máy này sẽ bị xoá và không thể khôi phục. Tệp văn bản
            đã xuất và nhật ký hoạt động vẫn được giữ.
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => void handleWipe()}
              disabled={wiping}
              className="press rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
            >
              {wiping ? 'Đang xoá...' : 'Xoá vĩnh viễn'}
            </button>
            <button
              onClick={() => setConfirmingWipe(false)}
              disabled={wiping}
              className={buttonClass}
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`break-all text-[11px] ${notice.kind === 'ok' ? 'text-emerald-500' : 'text-red-500'}`}
        >
          {notice.text}
        </div>
      )}
    </section>
  )
}
