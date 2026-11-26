import { create } from 'zustand'
import type { AttachedItem, ChatMessage, ReasoningEffort } from '../../../shared/types'
import {
  DOC_PLAN_TEMPLATES,
  buildPlanningPrompt,
  buildStepPrompt,
  parsePlanBlock,
  type DocPlan,
  type DocPlanStep
} from '../../../shared/docPlan'
import { getLatestDocSegment } from '../../../shared/docBlocks'
import { resolveAiPreset } from '../../../shared/aiPresets'
import { useAppStore } from './useAppStore'
import { looksLikeDocumentDraft } from '../utils/liveDraft'

const STORAGE_KEY = 'egovai.docPlans.v1'

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clip(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function loadPlans(): DocPlan[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const plans = JSON.parse(raw) as DocPlan[]
    if (!Array.isArray(plans)) return []
    // Ứng dụng đóng giữa chừng: bước đang chạy trở về "chờ", kế hoạch chuyển "tạm dừng".
    return plans.map((p) => ({
      ...p,
      status: p.status === 'running' || p.status === 'drafting' ? (p.steps.length ? 'paused' : 'ready') : p.status,
      steps: p.steps.map((s) => (s.status === 'running' ? { ...s, status: 'pending' as const } : s))
    }))
  } catch {
    return []
  }
}

function savePlans(plans: DocPlan[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans))
  } catch {
    // bộ nhớ trình duyệt không dùng được: kế hoạch chỉ còn trong phiên này
  }
}

/** Chờ lượt trả lời của một hội thoại kết thúc; trả về tin nhắn trả lời cuối. */
function waitForTurnEnd(conversationId: string): Promise<ChatMessage | undefined> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      const st = useAppStore.getState()
      if (st.streamingConversationIds[conversationId]) return false
      const conv = st.conversations.find((c) => c.id === conversationId)
      const last = conv?.messages[conv.messages.length - 1]
      resolve(last && last.role === 'assistant' ? last : undefined)
      return true
    }
    if (check()) return
    const unsub = useAppStore.subscribe(() => {
      if (check()) unsub()
    })
  })
}

function currentModelChoice(): { modelId?: string; effort: ReasoningEffort } {
  const st = useAppStore.getState()
  if (st.settings.defaultModelId) return { modelId: st.settings.defaultModelId, effort: st.settings.effort }
  const r = resolveAiPreset(st.settings.aiPreset ?? 'balanced', st.agyStatus?.models ?? [])
  return { modelId: r.modelId || undefined, effort: r.effort }
}

function openPlanTab(): void {
  useAppStore.setState({ auxOpen: true, auxTab: 'plan' })
}

interface PlanState {
  plans: DocPlan[]
  activePlanId: string | null
  runningPlanId: string | null
  stopRequested: boolean

  setActivePlan: (planId: string | null) => void
  createPlan: (init?: { name?: string; goal?: string; templateId?: string }) => DocPlan | null
  updatePlan: (planId: string, patch: Partial<Pick<DocPlan, 'name' | 'goal'>>) => void
  deletePlan: (planId: string) => void
  addStep: (planId: string) => void
  updateStep: (
    planId: string,
    stepId: string,
    patch: Partial<Pick<DocPlanStep, 'title' | 'docType' | 'instructions'>>
  ) => void
  removeStep: (planId: string, stepId: string) => void
  moveStep: (planId: string, stepId: string, delta: -1 | 1) => void
  resetStep: (planId: string, stepId: string) => void
  /** Chế độ "Theo kế hoạch": AI lập danh sách văn bản từ một yêu cầu tổng. */
  createPlanFromRequest: (
    text: string,
    attachments: AttachedItem[],
    opts?: { modelId?: string; effort?: ReasoningEffort }
  ) => Promise<void>
  runPlan: (planId: string) => Promise<void>
  runSingleStep: (planId: string, stepId: string) => Promise<void>
  pause: () => void
}

export const usePlanStore = create<PlanState>((set, get) => {
  const mutatePlan = (planId: string, fn: (p: DocPlan) => DocPlan): void => {
    set((s) => ({
      plans: s.plans.map((p) => (p.id === planId ? { ...fn(p), updatedAt: Date.now() } : p))
    }))
  }
  const mutateStep = (planId: string, stepId: string, patch: Partial<DocPlanStep>): void => {
    mutatePlan(planId, (p) => ({
      ...p,
      steps: p.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st))
    }))
  }
  const getPlan = (planId: string): DocPlan | undefined => get().plans.find((p) => p.id === planId)

  /** Soạn một bước: gửi lượt trong hội thoại của kế hoạch, lưu văn bản thành Word. */
  const executeStep = async (planId: string, stepId: string): Promise<boolean> => {
    const plan = getPlan(planId)
    const step = plan?.steps.find((s) => s.id === stepId)
    if (!plan || !step) return false
    const app = useAppStore.getState()
    const project = app.projects.find((p) => p.id === plan.projectId)
    if (!project) {
      mutateStep(planId, stepId, { status: 'error', error: 'Không tìm thấy dự án của kế hoạch.' })
      return false
    }
    mutateStep(planId, stepId, { status: 'running', error: undefined })
    const idx = plan.steps.findIndex((s) => s.id === stepId)
    const choice = currentModelChoice()
    const viewingPlanConv =
      !app.activeConversationId || app.activeConversationId === plan.conversationId
    try {
      const convId = await app.sendMessage({
        text: `Kế hoạch "${plan.name}" · Văn bản ${idx + 1}/${plan.steps.length}: ${step.docType} – ${step.title}`,
        promptText: buildStepPrompt(plan, step),
        targetConversationId: plan.conversationId ?? null,
        projectId: plan.projectId,
        activate: viewingPlanConv,
        newConversationTitle: `Kế hoạch: ${plan.name}`,
        overrideSkill: null,
        modelId: choice.modelId,
        effort: choice.effort,
        mode: 'default'
      })
      if (!convId) throw new Error('Không gửi được yêu cầu cho AI.')
      if (plan.conversationId !== convId) mutatePlan(planId, (p) => ({ ...p, conversationId: convId }))

      const msg = await waitForTurnEnd(convId)
      if (!msg || msg.status !== 'done') {
        throw new Error(msg?.status === 'aborted' ? 'Đã dừng.' : (msg?.error ?? 'AI không trả lời được.'))
      }
      const doc = getLatestDocSegment(msg.content)
      const body = doc?.body ?? (looksLikeDocumentDraft(msg.content, true) ? msg.content : '')
      if (!body.trim()) throw new Error('AI chưa trả về văn bản. Bấm "Chạy lại bước này".')

      const saved = await window.googleAI.saveDraftDocx(
        project.path,
        `${String(idx + 1).padStart(2, '0')}. ${doc?.title || step.title}`,
        body,
        `Ke-hoach/${plan.name}`
      )
      mutateStep(planId, stepId, { status: 'done', outputPath: saved.path, messageId: msg.id })
      return true
    } catch (err) {
      mutateStep(planId, stepId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }

  return {
    plans: loadPlans(),
    activePlanId: null,
    runningPlanId: null,
    stopRequested: false,

    setActivePlan: (planId) => set({ activePlanId: planId }),

    createPlan: (init) => {
      const app = useAppStore.getState()
      if (!app.activeProjectId) return null
      const template = init?.templateId
        ? DOC_PLAN_TEMPLATES.find((t) => t.id === init.templateId)
        : undefined
      const now = Date.now()
      const plan: DocPlan = {
        id: genId(),
        projectId: app.activeProjectId,
        name: init?.name?.trim() || template?.name || 'Kế hoạch mới',
        goal: init?.goal ?? '',
        steps: (template?.steps ?? []).map((st) => ({ ...st, id: genId(), status: 'pending' as const })),
        status: 'ready',
        createdAt: now,
        updatedAt: now
      }
      set((s) => ({ plans: [plan, ...s.plans], activePlanId: plan.id }))
      openPlanTab()
      return plan
    },

    updatePlan: (planId, patch) => mutatePlan(planId, (p) => ({ ...p, ...patch })),

    deletePlan: (planId) =>
      set((s) => ({
        plans: s.plans.filter((p) => p.id !== planId),
        activePlanId: s.activePlanId === planId ? null : s.activePlanId
      })),

    addStep: (planId) =>
      mutatePlan(planId, (p) => ({
        ...p,
        steps: [
          ...p.steps,
          { id: genId(), title: 'Văn bản mới', docType: 'Công văn', instructions: '', status: 'pending' }
        ]
      })),

    updateStep: (planId, stepId, patch) => mutateStep(planId, stepId, patch),

    removeStep: (planId, stepId) =>
      mutatePlan(planId, (p) => ({ ...p, steps: p.steps.filter((s) => s.id !== stepId) })),

    moveStep: (planId, stepId, delta) =>
      mutatePlan(planId, (p) => {
        const i = p.steps.findIndex((s) => s.id === stepId)
        const j = i + delta
        if (i < 0 || j < 0 || j >= p.steps.length) return p
        const steps = [...p.steps]
        ;[steps[i], steps[j]] = [steps[j], steps[i]]
        return { ...p, steps }
      }),

    resetStep: (planId, stepId) =>
      mutateStep(planId, stepId, { status: 'pending', error: undefined, outputPath: undefined }),

    createPlanFromRequest: async (text, attachments, opts) => {
      const app = useAppStore.getState()
      const project = app.projects.find((p) => p.id === app.activeProjectId)
      if (!project) return
      const now = Date.now()
      const plan: DocPlan = {
        id: genId(),
        projectId: project.id,
        name: clip(text, 50),
        goal: text,
        steps: [],
        status: 'drafting',
        createdAt: now,
        updatedAt: now
      }
      set((s) => ({ plans: [plan, ...s.plans], activePlanId: plan.id }))
      openPlanTab()

      const convId = await app.sendMessage({
        text,
        promptText: buildPlanningPrompt(text),
        attachments,
        targetConversationId: null,
        projectId: project.id,
        newConversationTitle: `Kế hoạch: ${clip(text, 40)}`,
        overrideSkill: null,
        modelId: opts?.modelId,
        effort: opts?.effort,
        mode: 'default'
      })
      if (!convId) {
        mutatePlan(plan.id, (p) => ({ ...p, status: 'ready' }))
        return
      }
      mutatePlan(plan.id, (p) => ({ ...p, conversationId: convId }))
      const msg = await waitForTurnEnd(convId)
      const parsed = msg?.status === 'done' ? parsePlanBlock(msg.content) : null
      mutatePlan(plan.id, (p) => ({
        ...p,
        name: parsed?.name || p.name,
        status: 'ready',
        steps:
          parsed?.steps.map((st) => ({ ...st, id: genId(), status: 'pending' as const })) ??
          (p.steps.length > 0
            ? p.steps
            : [{ id: genId(), title: clip(text, 60), docType: 'Văn bản', instructions: text, status: 'pending' as const }])
      }))
      openPlanTab()
    },

    runPlan: async (planId) => {
      if (get().runningPlanId) return
      set({ runningPlanId: planId, stopRequested: false, activePlanId: planId })
      mutatePlan(planId, (p) => ({ ...p, status: 'running' }))
      let ok = true
      for (;;) {
        if (get().stopRequested) break
        const plan = getPlan(planId)
        const next = plan?.steps.find((s) => s.status === 'pending' || s.status === 'error')
        if (!plan || !next) break
        ok = await executeStep(planId, next.id)
        if (!ok) break
      }
      const plan = getPlan(planId)
      const allDone = Boolean(plan && plan.steps.length > 0 && plan.steps.every((s) => s.status === 'done'))
      mutatePlan(planId, (p) => ({ ...p, status: allDone ? 'done' : 'paused' }))
      set({ runningPlanId: null, stopRequested: false })
      if (!ok) openPlanTab()
    },

    runSingleStep: async (planId, stepId) => {
      if (get().runningPlanId) return
      set({ runningPlanId: planId, stopRequested: false })
      mutatePlan(planId, (p) => ({ ...p, status: 'running' }))
      await executeStep(planId, stepId)
      const plan = getPlan(planId)
      const allDone = Boolean(plan && plan.steps.every((s) => s.status === 'done'))
      mutatePlan(planId, (p) => ({ ...p, status: allDone ? 'done' : 'paused' }))
      set({ runningPlanId: null })
    },

    pause: () => {
      set({ stopRequested: true })
      const running = get().runningPlanId
      const plan = running ? getPlan(running) : undefined
      if (plan?.conversationId) {
        const app = useAppStore.getState()
        if (app.streamingConversationIds[plan.conversationId]) {
          void window.googleAI.abortConversation(plan.conversationId)
        }
      }
    }
  }
})

usePlanStore.subscribe((state, prev) => {
  if (state.plans !== prev.plans) savePlans(state.plans)
})
