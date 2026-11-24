import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Save,
  Check,
  AlertCircle,
  Building2,
  FileText,
  ShieldCheck,
  FileCode2,
  Sparkles,
  RefreshCw
} from 'lucide-react'
import {
  DEFAULT_AGENCY_PROFILE,
  type AgencyRulesProfile,
  type AntigravityCustomizations,
  type WritingTone
} from '../../../../shared/types'
import {
  formatAgencyProfileSummary,
  mergeAgencyBlockIntoMarkdown
} from '../../../../shared/agencyProfile'
import { useAppStore } from '../../stores/useAppStore'

type PageTab = 'form' | 'raw_rules'

const TONE_OPTIONS: { id: WritingTone; title: string; desc: string }[] = [
  {
    id: 'formal_admin',
    title: 'Hành chính công vụ chuẩn',
    desc: 'Trang trọng, chuẩn mực văn phong cơ quan nhà nước theo Nghị định 30.'
  },
  {
    id: 'concise_executive',
    title: 'Ngắn gọn cho lãnh đạo duyệt',
    desc: 'Súc tích, chia đầu mục rõ ràng, đi thẳng vào đề xuất và phương án.'
  },
  {
    id: 'detailed_legal',
    title: 'Chuyên sâu căn cứ pháp lý',
    desc: 'Phân tích kỹ điều khoản, trích dẫn rõ văn bản quy phạm pháp luật.'
  }
]

export function CustomizationsView(): React.JSX.Element {
  const { projects, activeProjectId, settings, setActiveView, updateSettings } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const isLight = settings.theme === 'light'

  const [tab, setTab] = useState<PageTab>('form')
  const [form, setForm] = useState<AgencyRulesProfile>({
    ...DEFAULT_AGENCY_PROFILE,
    ...(settings.agencyProfile ?? {})
  })
  const [savingForm, setSavingForm] = useState(false)
  const [savedFormNotice, setSavedFormNotice] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Advanced raw workspace rules (GEMINI.md / AGENTS.md)
  const [rawData, setRawData] = useState<AntigravityCustomizations | null>(null)
  const [selectedRuleIdx, setSelectedRuleIdx] = useState(0)
  const [editorText, setEditorText] = useState('')
  const [rawError, setRawError] = useState<string | null>(null)
  const [savedRawNotice, setSavedRawNotice] = useState(false)

  useEffect(() => {
    setForm({ ...DEFAULT_AGENCY_PROFILE, ...(settings.agencyProfile ?? {}) })
  }, [settings.agencyProfile])

  const loadRaw = useCallback(async () => {
    const res = await window.googleAI.loadCustomizations(activeProject?.path)
    setRawData(res)
    setSelectedRuleIdx(0)
    setEditorText(res.rulesFiles[0]?.content ?? '')
    setRawError(null)
  }, [activeProject?.path])

  useEffect(() => {
    void loadRaw()
  }, [loadRaw])

  const updateField = <K extends keyof AgencyRulesProfile>(
    key: K,
    value: AgencyRulesProfile[K]
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveForm = async (): Promise<void> => {
    setSavingForm(true)
    setFormError(null)
    try {
      await updateSettings({ agencyProfile: form })

      // Also sync cleanly into global ~/.gemini/GEMINI.md so official Antigravity CLI/IDE shares the same unit rules
      const latest = await window.googleAI.loadCustomizations(activeProject?.path)
      const globalRule = latest.rulesFiles.find((r) => r.scope === 'global')
      if (globalRule) {
        const merged = mergeAgencyBlockIntoMarkdown(globalRule.content, form)
        await window.googleAI.saveCustomizationFile(globalRule.path, merged, false)
      }

      setSavedFormNotice(true)
      setTimeout(() => setSavedFormNotice(false), 2200)
      await loadRaw()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không thể lưu cấu hình đơn vị.')
    } finally {
      setSavingForm(false)
    }
  }

  const handleSaveRawRule = async (): Promise<void> => {
    const rule = rawData?.rulesFiles[selectedRuleIdx]
    if (!rule) return
    setRawError(null)
    try {
      await window.googleAI.saveCustomizationFile(rule.path, editorText, false)
      setSavedRawNotice(true)
      setTimeout(() => setSavedRawNotice(false), 1800)
      await loadRaw()
    } catch (err) {
      setRawError(err instanceof Error ? err.message : 'Không thể lưu tệp quy tắc.')
    }
  }

  const cardClass = 'rounded-2xl border border-line bg-surface p-5 space-y-4'
  const inputClass = `mt-1 w-full rounded-xl border px-3 py-2 text-xs outline-none transition ${
    isLight
      ? 'border-line bg-canvas text-ink placeholder:text-faint focus:border-brand'
      : 'border-line-strong bg-canvas text-ink placeholder:text-faint focus:border-brand'
  }`

  const activeRawRule = rawData?.rulesFiles[selectedRuleIdx] ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView('chat')}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-sunken"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold">
              <Building2 className="h-4 w-4 text-blue-500" />
              <span>Quy tắc &amp; Cấu hình đơn vị</span>
            </h1>
            <p className="text-xs text-faint">
              Biểu mẫu thiết lập thông tin cơ quan, chuẩn thể thức văn bản và nguyên tắc làm việc cho cán bộ, công chức, viên chức
            </p>
          </div>
        </div>

        {tab === 'form' && (
          <button
            onClick={() => void handleSaveForm()}
            disabled={savingForm}
            className="press flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {savedFormNotice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            <span>{savedFormNotice ? 'Đã lưu & áp dụng' : 'Lưu & Áp dụng ngay'}</span>
          </button>
        )}
      </div>

      {/* Sub-tabs (Form vs Raw Rules) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-6 py-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTab('form')}
            className={`rounded-full px-3.5 py-1.5 font-medium transition ${
              tab === 'form'
                ? 'bg-brand text-white'
                : 'border border-line bg-surface text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            Biểu mẫu đơn vị công lập
          </button>
          <button
            onClick={() => setTab('raw_rules')}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${
              tab === 'raw_rules'
                ? 'bg-brand text-white'
                : 'border border-line bg-surface text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            <span>Tệp quy tắc nâng cao (GEMINI.md / AGENTS.md)</span>
          </button>
        </div>

        {tab === 'form' && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span>Đang kích hoạt bộ quy tắc này</span>
          </label>
        )}
      </div>

      {/* TAB 1: Structured Public Administration Form */}
      {tab === 'form' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {formError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-500">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Section 1: Agency & Staff Info */}
            <section className={cardClass}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-blue-500" />
                <span>1. Thông tin cơ quan &amp; cán bộ soạn thảo</span>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium">Cơ quan chủ quản cấp trên</label>
                  <input
                    type="text"
                    value={form.parentAgency}
                    onChange={(e) => updateField('parentAgency', e.target.value)}
                    placeholder="VD: ỦY BAN NHÂN DÂN TỈNH THANH HÓA"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Tên cơ quan / đơn vị ban hành</label>
                  <input
                    type="text"
                    value={form.agencyName}
                    onChange={(e) => updateField('agencyName', e.target.value)}
                    placeholder="VD: ỦY BAN NHÂN DÂN XÃ THIỆU TOÁN"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Phòng / Bộ phận chuyên môn</label>
                  <input
                    type="text"
                    value={form.departmentName}
                    onChange={(e) => updateField('departmentName', e.target.value)}
                    placeholder="VD: Phòng Văn hóa – Xã hội"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Địa danh ghi trên văn bản</label>
                  <input
                    type="text"
                    value={form.locationName}
                    onChange={(e) => updateField('locationName', e.target.value)}
                    placeholder="VD: Thiệu Toán"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Chức vụ người ký mặc định</label>
                  <input
                    type="text"
                    value={form.defaultSignerRole}
                    onChange={(e) => updateField('defaultSignerRole', e.target.value)}
                    placeholder="VD: CHỦ TỊCH hoặc KT. CHỦ TỊCH / PHÓ CHỦ TỊCH"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Họ tên người ký (tùy chọn)</label>
                  <input
                    type="text"
                    value={form.defaultSignerName}
                    onChange={(e) => updateField('defaultSignerName', e.target.value)}
                    placeholder="Để trống nếu muốn điền sau trên bản in"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Họ tên cán bộ sử dụng</label>
                  <input
                    type="text"
                    value={form.staffName}
                    onChange={(e) => updateField('staffName', e.target.value)}
                    placeholder="VD: Nguyễn Văn A"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium">Chức danh / Vị trí công tác</label>
                  <input
                    type="text"
                    value={form.staffRole}
                    onChange={(e) => updateField('staffRole', e.target.value)}
                    placeholder="VD: Công chức Văn hóa – Xã hội"
                    className={inputClass}
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Document Format & Tone */}
            <section className={cardClass}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-emerald-500" />
                <span>2. Thể thức văn bản &amp; Văn phong công vụ</span>
              </div>

              <div className="space-y-3">
                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium">
                      Tuân thủ thể thức Nghị định 30/2020/NĐ-CP về công tác văn thư
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Khổ A4, phông Times New Roman 13–14pt, lề 20/20/30/15mm, Quốc hiệu – Tiêu ngữ, số ký hiệu, nơi nhận chuẩn.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.enforceDecree30}
                    onChange={(e) => updateField('enforceDecree30', e.target.checked)}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium">
                      Áp dụng thể thức văn bản Đảng (Hướng dẫn 36-HD/VPTW) khi soạn hồ sơ Đảng
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Tự động dùng đúng tiêu đề &ldquo;ĐẢNG CỘNG SẢN VIỆT NAM&rdquo; cho bản kiểm điểm, tờ trình Chi bộ/Đảng ủy.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.supportPartyDocs}
                    onChange={(e) => updateField('supportPartyDocs', e.target.checked)}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium">Phong cách diễn đạt ưu tiên</div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {TONE_OPTIONS.map((opt) => {
                    const selected = form.writingTone === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateField('writingTone', opt.id)}
                        className={`rounded-xl border p-3 text-left transition ${
                          selected
                            ? 'border-brand bg-brand/10 ring-1 ring-brand/40'
                            : 'border-line bg-canvas hover:bg-sunken'
                        }`}
                      >
                        <div className="text-xs font-semibold">{opt.title}</div>
                        <div className="mt-1 text-[11px] leading-snug text-faint">{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium">
                  Căn cứ pháp lý thường xuyên viện dẫn tại đơn vị
                </label>
                <input
                  type="text"
                  value={form.commonLegalRefs}
                  onChange={(e) => updateField('commonLegalRefs', e.target.value)}
                  placeholder="VD: Nghị định 30/2020/NĐ-CP, Luật Tổ chức chính quyền địa phương, Nghị định 33/2023/NĐ-CP..."
                  className={inputClass}
                />
              </div>
            </section>

            {/* Section 3: Guardrails */}
            <section className={cardClass}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-amber-500" />
                <span>3. Nguyên tắc kiểm soát &amp; An toàn nghiệp vụ</span>
              </div>

              <div className="space-y-3">
                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium">
                      Luôn kiểm tra hiệu lực văn bản pháp luật trước khi viện dẫn
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Tránh dẫn nhầm văn bản đã hết hiệu lực hoặc đã bị sửa đổi, bổ sung.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.verifyLegalStatus}
                    onChange={(e) => updateField('verifyLegalStatus', e.target.checked)}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium">
                      Không tự bịa số liệu, mốc ngày hay tên người khi hồ sơ còn thiếu
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Khi thiếu thông tin từ hồ sơ gốc, AI phải đánh dấu rõ và yêu cầu cán bộ bổ sung.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.noFabricatedData}
                    onChange={(e) => updateField('noFabricatedData', e.target.checked)}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium">
                      Bắt buộc hỏi xác nhận trước khi gửi văn bản, xóa tệp hoặc ghi đè hồ sơ
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Đảm bảo cán bộ luôn kiểm soát mọi thao tác quan trọng trên máy tính và hồ sơ công vụ.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.askBeforeCritical}
                    onChange={(e) => updateField('askBeforeCritical', e.target.checked)}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>
              </div>
            </section>

            {/* Section 4: Custom Unit Notes + Live Preview */}
            <section className={cardClass}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  <span>4. Yêu cầu riêng của đơn vị / Lãnh đạo</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="text-xs font-medium text-blue-500 hover:underline"
                >
                  {showPreview ? 'Ẩn bản xem trước quy tắc' : 'Xem trước quy tắc gửi AI'}
                </button>
              </div>

              <textarea
                value={form.customRules}
                onChange={(e) => updateField('customRules', e.target.value)}
                rows={4}
                placeholder="VD: Khi lập bảng tổng hợp giáo dục luôn tách riêng 3 cấp (Mầm non, Tiểu học, THCS); ưu tiên dùng cụm từ 'báo cáo đồng chí Chủ tịch' trong tờ trình nội bộ..."
                className={`${inputClass} resize-y`}
              />

              {showPreview && (
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-3.5 font-mono text-[11px] leading-relaxed text-muted">
                  {formatAgencyProfileSummary(form) || '(Bộ quy tắc đang tạm tắt)'}
                </pre>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-faint">
                  Khi bấm Lưu, cấu hình sẽ tự áp dụng cho mọi cuộc hội thoại và đồng bộ vào tệp quy tắc toàn cục.
                </span>
                <button
                  onClick={() => void handleSaveForm()}
                  disabled={savingForm}
                  className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {savedFormNotice ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>{savedFormNotice ? 'Đã lưu & áp dụng' : 'Lưu & Áp dụng ngay'}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : (
        /* TAB 2: Advanced Raw Rules (GEMINI.md / AGENTS.md only — MCP moved to Settings) */
        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {rawData?.rulesFiles.map((rule, idx) => (
                <button
                  key={rule.path}
                  onClick={() => {
                    setSelectedRuleIdx(idx)
                    setEditorText(rule.content)
                    setRawError(null)
                  }}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    idx === selectedRuleIdx
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-line bg-surface text-muted hover:bg-sunken hover:text-ink'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span>{rule.name}</span>
                  {!rule.exists && <span className="text-[10px] opacity-60">(chưa tạo)</span>}
                </button>
              ))}
            </div>

            <button
              onClick={() => void loadRaw()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-sunken"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Tải lại</span>
            </button>
          </div>

          {activeRawRule && (
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold">{activeRawRule.name}</div>
                <div className="truncate font-mono text-[11px] text-faint">
                  {activeRawRule.path}
                </div>
              </div>

              <button
                onClick={() => void handleSaveRawRule()}
                className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
              >
                {savedRawNotice ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>{savedRawNotice ? 'Đã lưu tệp' : 'Lưu tệp quy tắc'}</span>
              </button>
            </div>
          )}

          {rawError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{rawError}</span>
            </div>
          )}

          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-line bg-surface p-4 font-mono text-xs leading-relaxed text-ink outline-none focus:border-brand"
          />
        </div>
      )}
    </div>
  )
}
