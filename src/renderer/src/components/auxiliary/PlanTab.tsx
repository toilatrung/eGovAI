import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { usePlanStore } from '../../stores/usePlanStore'
import { DOC_PLAN_TEMPLATES, type DocPlan, type DocPlanStep } from '../../../../shared/docPlan'

const DOC_TYPES = [
  'Kế hoạch',
  'Công văn',
  'Tờ trình',
  'Báo cáo',
  'Quyết định',
  'Thông báo',
  'Giấy mời',
  'Biên bản',
  'Chương trình',
  'Văn bản'
]

const inputCls =
  'w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-brand/50 disabled:opacity-60'

function StatusIcon({ step }: { step: DocPlanStep }): React.JSX.Element {
  if (step.status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-brand" />
  if (step.status === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (step.status === 'error') return <AlertCircle className="h-4 w-4 text-red-500" />
  return <Circle className="h-4 w-4 text-faint" />
}

function NewPlanMenu({ onDone }: { onDone?: () => void }): React.JSX.Element {
  const createPlan = usePlanStore((s) => s.createPlan)
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => {
          createPlan()
          onDone?.()
        }}
        className="press flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12.5px] hover:border-brand/40"
      >
        <Plus className="h-4 w-4 text-brand" />
        <span className="font-medium">Kế hoạch trống</span>
        <span className="ml-auto text-[11.5px] text-faint">Tự thêm từng văn bản</span>
      </button>
      {DOC_PLAN_TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            createPlan({ templateId: t.id })
            onDone?.()
          }}
          className="press flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-brand/40"
        >
          <span className="text-[12.5px] font-medium text-ink">{t.name}</span>
          <span className="text-[11.5px] text-faint">{t.description}</span>
        </button>
      ))}
    </div>
  )
}

function StepRow({
  plan,
  step,
  index,
  locked
}: {
  plan: DocPlan
  step: DocPlanStep
  index: number
  locked: boolean
}): React.JSX.Element {
  const { updateStep, removeStep, moveStep, resetStep, runSingleStep } = usePlanStore()
  const openMessageDocument = useAppStore((s) => s.openMessageDocument)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const [open, setOpen] = useState(step.status !== 'done')
  const editable = !locked && step.status !== 'running'

  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="tabular w-5 shrink-0 text-center text-[12px] font-semibold text-faint">{index + 1}</span>
        <StatusIcon step={step} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink"
          title={step.title}
        >
          <span className="text-muted">{step.docType} – </span>
          {step.title}
        </button>
        {step.status === 'done' && plan.conversationId && step.messageId && (
          <button
            type="button"
            onClick={() => {
              selectConversation(plan.conversationId!)
              openMessageDocument(plan.conversationId!, step.messageId!)
            }}
            title="Xem văn bản trong tab Tài liệu"
            className="press rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        )}
        {step.outputPath && (
          <button
            type="button"
            onClick={() => void window.googleAI.openPath(step.outputPath!)}
            title={`Mở bằng Word: ${step.outputPath}`}
            className="press rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {step.error && (
        <div className="mx-2.5 mb-2 rounded-md bg-red-500/10 px-2 py-1 text-[11.5px] text-red-600 dark:text-red-300">
          {step.error}
        </div>
      )}

      {open && (
        <div className="space-y-1.5 border-t border-line px-2.5 py-2">
          <div className="flex min-w-0 gap-1.5">
            <select
              value={DOC_TYPES.includes(step.docType) ? step.docType : 'Văn bản'}
              disabled={!editable}
              onChange={(e) => updateStep(plan.id, step.id, { docType: e.target.value })}
              className={`${inputCls.replace("w-full ", "")} w-[120px] shrink-0`}
              aria-label="Loại văn bản"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={step.title}
              disabled={!editable}
              onChange={(e) => updateStep(plan.id, step.id, { title: e.target.value })}
              className={inputCls}
              aria-label="Tên văn bản"
              placeholder="Tên văn bản"
            />
          </div>
          <textarea
            value={step.instructions}
            disabled={!editable}
            onChange={(e) => updateStep(plan.id, step.id, { instructions: e.target.value })}
            rows={3}
            className={`${inputCls} resize-y`}
            placeholder="Yêu cầu nội dung cho văn bản này (thời gian, đối tượng, số liệu…)"
            aria-label="Yêu cầu nội dung"
          />
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => void runSingleStep(plan.id, step.id)}
              className="press inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-muted hover:text-ink disabled:opacity-45"
            >
              {step.status === 'done' || step.status === 'error' ? (
                <RotateCcw className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              <span>{step.status === 'done' || step.status === 'error' ? 'Soạn lại bước này' : 'Chỉ soạn bước này'}</span>
            </button>
            {step.status === 'done' && (
              <button
                type="button"
                disabled={locked}
                onClick={() => resetStep(plan.id, step.id)}
                className="press inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-45"
                title="Đánh dấu chưa soạn để lần chạy sau soạn lại"
              >
                Đặt lại
              </button>
            )}
            <span className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                disabled={!editable}
                onClick={() => moveStep(plan.id, step.id, -1)}
                title="Lên trên"
                className="press rounded-md p-1 text-faint hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!editable}
                onClick={() => moveStep(plan.id, step.id, 1)}
                title="Xuống dưới"
                className="press rounded-md p-1 text-faint hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!editable}
                onClick={() => removeStep(plan.id, step.id)}
                title="Xóa bước"
                className="press rounded-md p-1 text-faint hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}

export function PlanTab({ isLight }: { isLight: boolean }): React.JSX.Element {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const { plans, activePlanId, runningPlanId, setActivePlan, updatePlan, deletePlan, addStep, runPlan, pause } =
    usePlanStore()
  const [showNew, setShowNew] = useState(false)

  const projectPlans = useMemo(
    () => plans.filter((p) => p.projectId === activeProjectId),
    [plans, activeProjectId]
  )
  const plan = projectPlans.find((p) => p.id === activePlanId) ?? projectPlans[0]
  const running = runningPlanId !== null
  const thisRunning = plan !== undefined && runningPlanId === plan.id
  const doneCount = plan?.steps.filter((s) => s.status === 'done').length ?? 0
  const total = plan?.steps.length ?? 0

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted">
        Chọn một dự án để lập kế hoạch soạn văn bản.
      </div>
    )
  }

  if (!plan || showNew) {
    return (
      <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${isLight ? 'bg-sunken/40' : ''}`}>
        <div className="mx-auto max-w-md">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-brand" />
            <h2 className="text-[15px] font-semibold text-ink">Soạn nhiều văn bản theo kế hoạch</h2>
          </div>
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            Lập danh sách các văn bản cần soạn theo thứ tự, AI sẽ soạn lần lượt — văn bản sau dùng thông tin của
            văn bản trước. Mỗi văn bản xong được lưu thành tệp Word trong thư mục <b>Ke-hoach</b> của dự án.
          </p>
          <p className="mb-4 rounded-lg bg-brand-soft px-3 py-2 text-[12px] text-brand">
            Mẹo: ở ô chat, chọn <b>Cách làm → Theo kế hoạch</b> rồi mô tả công việc, AI sẽ tự lập danh sách văn bản.
          </p>
          <NewPlanMenu onDone={() => setShowNew(false)} />
          {plan && (
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="press mt-3 text-[12px] text-muted hover:text-ink"
            >
              ← Quay lại kế hoạch đang mở
            </button>
          )}
        </div>
      </div>
    )
  }

  const locked = running

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thanh chọn kế hoạch */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
        <select
          value={plan.id}
          onChange={(e) => setActivePlan(e.target.value)}
          className={`${inputCls} min-w-0 flex-1`}
          aria-label="Chọn kế hoạch"
        >
          {projectPlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          disabled={running}
          className="press inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-muted hover:text-ink disabled:opacity-45"
        >
          <Plus className="h-3 w-3" />
          <span>Mới</span>
        </button>
        <button
          type="button"
          disabled={thisRunning}
          onClick={() => {
            if (window.confirm(`Xóa kế hoạch "${plan.name}"? Các tệp Word đã lưu vẫn được giữ.`)) deletePlan(plan.id)
          }}
          title="Xóa kế hoạch"
          className="press rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 ${isLight ? 'bg-sunken/40' : ''}`}>
        <input
          value={plan.name}
          disabled={locked}
          onChange={(e) => updatePlan(plan.id, { name: e.target.value })}
          className="mb-1.5 w-full rounded-md bg-transparent px-1 text-[15px] font-semibold text-ink outline-none focus:bg-canvas"
          aria-label="Tên kế hoạch"
        />
        <textarea
          value={plan.goal}
          disabled={locked}
          onChange={(e) => updatePlan(plan.id, { goal: e.target.value })}
          rows={2}
          placeholder="Bối cảnh chung cho cả kế hoạch (đơn vị, thời gian, căn cứ, số liệu…)"
          className={`${inputCls} mb-3 resize-y`}
          aria-label="Bối cảnh chung"
        />

        {plan.status === 'drafting' ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-3 text-[12.5px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            AI đang lập danh sách văn bản… (xem tiến trình ở khung chat)
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: total ? `${(doneCount / total) * 100}%` : '0%' }}
                />
              </div>
              <span className="tabular text-[11.5px] text-faint">
                {doneCount}/{total} văn bản
              </span>
            </div>

            <ol className="space-y-1.5">
              {plan.steps.map((step, i) => (
                <StepRow key={step.id} plan={plan} step={step} index={i} locked={locked} />
              ))}
            </ol>

            <button
              type="button"
              disabled={locked}
              onClick={() => addStep(plan.id)}
              className="press mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[12px] text-muted hover:text-ink disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm văn bản
            </button>
          </>
        )}
      </div>

      {/* Thanh chạy */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
          {thisRunning
            ? 'Đang soạn lần lượt… bạn vẫn có thể trò chuyện ở hội thoại khác.'
            : plan.status === 'done'
              ? 'Đã soạn xong tất cả văn bản.'
              : running
                ? 'Một kế hoạch khác đang chạy.'
                : 'Kiểm tra danh sách rồi bấm Soạn.'}
        </span>
        {thisRunning ? (
          <button
            type="button"
            onClick={pause}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-medium text-surface hover:opacity-90"
          >
            <Pause className="h-3.5 w-3.5" />
            Tạm dừng
          </button>
        ) : (
          <button
            type="button"
            disabled={running || plan.status === 'drafting' || total === 0 || doneCount === total}
            onClick={() => void runPlan(plan.id)}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-[12.5px] font-medium text-white hover:brightness-110 disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {doneCount > 0 ? 'Soạn tiếp' : 'Soạn tất cả'}
          </button>
        )}
      </div>
    </div>
  )
}
