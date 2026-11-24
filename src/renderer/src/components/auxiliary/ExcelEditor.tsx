import { useEffect, useState } from 'react'
import {
  Save,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Search,
  Columns3,
  Check
} from 'lucide-react'
import type { ExcelSheetData, OpenedDocument } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

interface ExcelEditorProps {
  doc: OpenedDocument
  isLight: boolean
}

function colIndexToLetter(index: number): string {
  let n = index
  let label = ''
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

export function ExcelEditor({ doc, isLight }: ExcelEditorProps): React.JSX.Element {
  const { refreshActiveDoc, sendFileToChatComposer } = useAppStore()
  const [sheets, setSheets] = useState<ExcelSheetData[]>(
    doc.sheets && doc.sheets.length > 0 ? doc.sheets : [{ name: 'Sheet1', rows: [Array(6).fill('')] }]
  )
  const [activeSheetIdx, setActiveSheetIdx] = useState(0)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedToast, setSavedToast] = useState(false)

  useEffect(() => {
    setSheets(
      doc.sheets && doc.sheets.length > 0
        ? doc.sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => [...r]) }))
        : [{ name: 'Sheet1', rows: [Array(6).fill('')] }]
    )
    setActiveSheetIdx(0)
    setSelectedRow(null)
    setDirty(false)
  }, [doc.path, doc.mtimeMs, doc.sheets])

  const activeSheet = sheets[activeSheetIdx] ?? sheets[0]
  const colCount = activeSheet?.rows[0]?.length ?? 6

  const handleCellChange = (rowIdx: number, colIdx: number, value: string): void => {
    setSheets((prev) =>
      prev.map((sheet, sIdx) => {
        if (sIdx !== activeSheetIdx) return sheet
        const nextRows = sheet.rows.map((r, rIdx) => {
          if (rIdx !== rowIdx) return r
          const copy = [...r]
          copy[colIdx] = value
          return copy
        })
        return { ...sheet, rows: nextRows }
      })
    )
    setDirty(true)
  }

  const handleAddRow = (): void => {
    setSheets((prev) =>
      prev.map((sheet, sIdx) =>
        sIdx === activeSheetIdx
          ? { ...sheet, rows: [...sheet.rows, Array(colCount).fill('')] }
          : sheet
      )
    )
    setDirty(true)
  }

  const handleAddCol = (): void => {
    setSheets((prev) =>
      prev.map((sheet, sIdx) =>
        sIdx === activeSheetIdx
          ? { ...sheet, rows: sheet.rows.map((r) => [...r, '']) }
          : sheet
      )
    )
    setDirty(true)
  }

  const handleDeleteSelectedRow = (): void => {
    if (selectedRow === null || activeSheet.rows.length <= 1) return
    setSheets((prev) =>
      prev.map((sheet, sIdx) =>
        sIdx === activeSheetIdx
          ? { ...sheet, rows: sheet.rows.filter((_, idx) => idx !== selectedRow) }
          : sheet
      )
    )
    setSelectedRow(null)
    setDirty(true)
  }

  const handleAddSheet = (): void => {
    const nextName = `Trang ${sheets.length + 1}`
    setSheets((prev) => [
      ...prev,
      { name: nextName, rows: [Array(6).fill(''), Array(6).fill('')] }
    ])
    setActiveSheetIdx(sheets.length)
    setDirty(true)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.googleAI.saveExcelDocument(doc.path, sheets)
      setDirty(false)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 1800)
    } finally {
      setSaving(false)
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

  const normalizedSearch = search.trim().toLowerCase()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
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
            <span>{savedToast ? 'Đã lưu' : dirty ? 'Lưu Excel*' : 'Lưu'}</span>
          </button>

          <button
            onClick={handleAddRow}
            title="Thêm dòng mới"
            className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
              isLight
                ? 'border-line bg-surface text-muted hover:bg-sunken'
                : 'border-line-strong bg-surface text-muted hover:bg-sunken'
            }`}
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            <span>Dòng</span>
          </button>

          <button
            onClick={handleAddCol}
            title="Thêm cột mới"
            className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
              isLight
                ? 'border-line bg-surface text-muted hover:bg-sunken'
                : 'border-line-strong bg-surface text-muted hover:bg-sunken'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5 text-sky-400" />
            <span>Cột</span>
          </button>

          {selectedRow !== null && (
            <button
              onClick={handleDeleteSelectedRow}
              title="Xóa dòng đang chọn"
              className="press flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Xóa dòng {selectedRow + 1}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Lọc ô..."
              className={`w-28 rounded-lg border py-1 pl-6 pr-2 text-[11px] outline-none ${
                isLight
                  ? 'border-line bg-surface text-ink'
                  : 'border-line-strong bg-surface text-ink'
              }`}
            />
          </div>

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
            onClick={() => void window.googleAI.openPath(doc.path)}
            title="Mở bằng Microsoft Excel"
            className={`press flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
              isLight
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            <ExternalLink className="h-3 w-3" />
            <span>Excel</span>
          </button>

          <button
            onClick={() =>
              sendFileToChatComposer(
                { type: 'file', path: doc.path, name: doc.name },
                `Hãy kiểm tra, đối chiếu số liệu và rà soát bảng tính "${doc.name}" này giúp tôi.`
              )
            }
            title="Đưa bảng tính này vào khung chat để eGovAI xử lý"
            className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-500"
          >
            <Sparkles className="h-3 w-3" />
            <span>Hỏi AI</span>
          </button>
        </div>
      </div>

      {/* Spreadsheet Grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr
              className={
                isLight ? 'bg-sunken text-muted' : 'bg-surface text-faint'
              }
            >
              <th className="w-10 border border-line px-2 py-1.5 text-center font-mono text-[10px]">
                #
              </th>
              {Array.from({ length: colCount }).map((_, cIdx) => (
                <th
                  key={cIdx}
                  className="min-w-[120px] border border-line px-2 py-1.5 text-center font-mono text-[10px] font-semibold"
                >
                  {colIndexToLetter(cIdx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeSheet.rows.map((row, rIdx) => {
              const rowMatches =
                !normalizedSearch ||
                row.some((cell) => cell.toLowerCase().includes(normalizedSearch))
              if (!rowMatches) return null

              const isSelected = selectedRow === rIdx
              const isHeaderRow = rIdx === 0

              return (
                <tr
                  key={rIdx}
                  className={
                    isSelected
                      ? isLight
                        ? 'bg-blue-50'
                        : 'bg-blue-500/10'
                      : isHeaderRow
                        ? isLight
                          ? 'bg-canvas font-semibold'
                          : 'bg-sunken font-semibold'
                        : ''
                  }
                >
                  <td
                    onClick={() => setSelectedRow(isSelected ? null : rIdx)}
                    className={`cursor-pointer select-none border border-line px-2 py-1 text-center font-mono text-[10px] ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : isLight
                          ? 'bg-sunken text-faint hover:bg-sunken'
                          : 'bg-surface text-faint hover:bg-sunken'
                    }`}
                  >
                    {rIdx + 1}
                  </td>
                  {row.map((cell, cIdx) => {
                    const isHit =
                      normalizedSearch.length > 0 &&
                      cell.toLowerCase().includes(normalizedSearch)
                    return (
                      <td
                        key={cIdx}
                        className={`border border-line p-0 ${
                          isHit ? 'bg-amber-500/20' : ''
                        }`}
                      >
                        <input
                          type="text"
                          value={cell}
                          onFocus={() => setSelectedRow(rIdx)}
                          onChange={(e) => handleCellChange(rIdx, cIdx, e.target.value)}
                          className={`w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                            isLight ? 'text-ink' : 'text-ink'
                          }`}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom Sheet Tabs */}
      <div
        className={`flex items-center justify-between gap-2 border-t px-2.5 py-1.5 text-[11px] ${
          isLight ? 'border-line bg-sunken' : 'border-line bg-canvas'
        }`}
      >
        <div className="flex items-center gap-1 overflow-x-auto">
          {sheets.map((sheet, idx) => (
            <button
              key={`${sheet.name}-${idx}`}
              onClick={() => {
                setActiveSheetIdx(idx)
                setSelectedRow(null)
              }}
              className={`press rounded-md px-2.5 py-1 font-medium transition ${
                idx === activeSheetIdx
                  ? 'bg-blue-600 text-white'
                  : isLight
                    ? 'bg-surface text-muted hover:bg-sunken'
                    : 'bg-surface text-faint hover:bg-sunken hover:text-ink'
              }`}
            >
              {sheet.name}
            </button>
          ))}
          <button
            onClick={handleAddSheet}
            title="Thêm trang tính (Sheet) mới"
            className={`press rounded-md p-1 transition ${
              isLight ? 'text-muted hover:bg-sunken' : 'text-faint hover:bg-sunken'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="shrink-0 text-[10px] text-faint">
          {activeSheet.rows.length} dòng × {colCount} cột
        </span>
      </div>
    </div>
  )
}
