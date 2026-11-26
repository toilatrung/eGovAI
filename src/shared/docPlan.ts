/**
 * Chế độ "Theo kế hoạch" (góp ý U2): cán bộ lập danh sách nhiều văn bản cần soạn theo một
 * quy trình, AI soạn lần lượt; văn bản sau dựa vào kết quả văn bản trước.
 */

export type DocPlanStepStatus = 'pending' | 'running' | 'done' | 'error'
export type DocPlanStatus = 'drafting' | 'ready' | 'running' | 'paused' | 'done'

export interface DocPlanStep {
  id: string
  title: string
  /** Loại văn bản: Kế hoạch, Công văn, Tờ trình, Báo cáo, Giấy mời, Thông báo… */
  docType: string
  /** Yêu cầu nội dung riêng cho văn bản này. */
  instructions: string
  status: DocPlanStepStatus
  /** Tệp Word đã lưu. */
  outputPath?: string
  /** Tin nhắn trả lời chứa văn bản (để mở lại trong tab Tài liệu). */
  messageId?: string
  error?: string
}

export interface DocPlan {
  id: string
  projectId: string
  name: string
  /** Mục tiêu / bối cảnh chung cho cả quy trình. */
  goal: string
  /** Hội thoại dùng để soạn (giữ ngữ cảnh giữa các văn bản). */
  conversationId?: string
  steps: DocPlanStep[]
  status: DocPlanStatus
  createdAt: number
  updatedAt: number
}

export interface DocPlanTemplate {
  id: string
  name: string
  description: string
  steps: Array<Pick<DocPlanStep, 'title' | 'docType' | 'instructions'>>
}

export const DOC_PLAN_TEMPLATES: DocPlanTemplate[] = [
  {
    id: 'su-kien',
    name: 'Tổ chức sự kiện / hội nghị',
    description: 'Kế hoạch → Công văn triển khai → Giấy mời → Báo cáo kết quả',
    steps: [
      {
        title: 'Kế hoạch tổ chức',
        docType: 'Kế hoạch',
        instructions: 'Mục đích, yêu cầu; thời gian, địa điểm, thành phần; nội dung chương trình; phân công nhiệm vụ; kinh phí.'
      },
      {
        title: 'Công văn triển khai',
        docType: 'Công văn',
        instructions: 'Gửi các đơn vị liên quan đề nghị phối hợp thực hiện theo Kế hoạch đã soạn ở bước trước.'
      },
      {
        title: 'Giấy mời',
        docType: 'Giấy mời',
        instructions: 'Mời đại biểu dự; ghi rõ thời gian, địa điểm, nội dung, thành phần theo Kế hoạch.'
      },
      {
        title: 'Báo cáo kết quả',
        docType: 'Báo cáo',
        instructions: 'Báo cáo kết quả tổ chức (để trống số liệu chưa có), đánh giá ưu điểm, hạn chế, đề xuất.'
      }
    ]
  },
  {
    id: 'van-ban-chi-dao',
    name: 'Triển khai văn bản chỉ đạo của cấp trên',
    description: 'Kế hoạch triển khai → Công văn giao nhiệm vụ → Báo cáo kết quả',
    steps: [
      {
        title: 'Kế hoạch triển khai',
        docType: 'Kế hoạch',
        instructions: 'Cụ thể hóa văn bản chỉ đạo của cấp trên: mục tiêu, nhiệm vụ, giải pháp, phân công, tiến độ.'
      },
      {
        title: 'Công văn giao nhiệm vụ',
        docType: 'Công văn',
        instructions: 'Giao nhiệm vụ cho các bộ phận/đơn vị theo Kế hoạch triển khai, nêu thời hạn báo cáo.'
      },
      {
        title: 'Báo cáo kết quả thực hiện',
        docType: 'Báo cáo',
        instructions: 'Báo cáo cấp trên kết quả thực hiện theo mẫu: kết quả đạt được, tồn tại, nguyên nhân, kiến nghị.'
      }
    ]
  },
  {
    id: 'mua-sam',
    name: 'Đề xuất mua sắm tài sản',
    description: 'Tờ trình → Quyết định phê duyệt → Biên bản bàn giao',
    steps: [
      {
        title: 'Tờ trình đề nghị mua sắm',
        docType: 'Tờ trình',
        instructions: 'Sự cần thiết, căn cứ, danh mục, số lượng, dự toán kinh phí, nguồn kinh phí, đề xuất.'
      },
      {
        title: 'Quyết định phê duyệt',
        docType: 'Quyết định',
        instructions: 'Phê duyệt danh mục và dự toán theo Tờ trình; điều khoản thi hành.'
      },
      {
        title: 'Biên bản bàn giao tài sản',
        docType: 'Biên bản',
        instructions: 'Thành phần, danh mục tài sản bàn giao theo Quyết định, tình trạng, chữ ký các bên.'
      }
    ]
  }
]

export const PLAN_BLOCK_LANG = 'egov-plan'

const PLAN_BLOCK_RE = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[ \t]*egov-plan\b[^\n]*\n([\s\S]*?)(\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)/i

export interface ParsedPlanBlock {
  name?: string
  steps: Array<Pick<DocPlanStep, 'title' | 'docType' | 'instructions'>>
}

/** Đọc khối ```egov-plan {json}``` trong câu trả lời lập kế hoạch. */
export function parsePlanBlock(content: string): ParsedPlanBlock | null {
  const m = content.match(PLAN_BLOCK_RE)
  if (!m) return null
  const raw = m[3].trim()
  try {
    const data = JSON.parse(raw) as { name?: unknown; steps?: unknown }
    if (!Array.isArray(data.steps)) return null
    const steps = data.steps
      .map((st) => {
        const o = (st ?? {}) as Record<string, unknown>
        const title = String(o.title ?? '').trim()
        return {
          title,
          docType: String(o.docType ?? o.type ?? '').trim() || 'Văn bản',
          instructions: String(o.instructions ?? o.content ?? '').trim()
        }
      })
      .filter((st) => st.title)
      .slice(0, 12)
    if (steps.length === 0) return null
    return { name: typeof data.name === 'string' ? data.name.trim() : undefined, steps }
  } catch {
    return null
  }
}

/** Bỏ khối egov-plan khỏi nội dung hiển thị trong chat (hiện thẻ kế hoạch thay thế). */
export function stripPlanBlock(content: string): { text: string; hasPlan: boolean; closed: boolean } {
  const m = content.match(PLAN_BLOCK_RE)
  if (!m || m.index === undefined) return { text: content, hasPlan: false, closed: false }
  const closed = Boolean(m[4] && m[4].trim())
  const text = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim()
  return { text, hasPlan: true, closed }
}

/** Lời dặn khi người dùng gửi yêu cầu ở chế độ "Theo kế hoạch": chỉ lập danh sách, chưa soạn. */
export function buildPlanningPrompt(request: string): string {
  return [
    '[Chế độ Theo kế hoạch: Người dùng cần soạn NHIỀU văn bản theo một quy trình. Bây giờ CHƯA soạn văn bản nào.',
    'Hãy lập danh sách các văn bản cần soạn theo đúng thứ tự (văn bản sau có thể dựa vào văn bản trước), tối đa 8 văn bản.',
    'Trả lời bằng 1–2 câu ngắn, sau đó là ĐÚNG MỘT khối:',
    '```egov-plan',
    '{"name":"<tên kế hoạch ngắn>","steps":[{"title":"<tên văn bản>","docType":"<Kế hoạch|Công văn|Tờ trình|Báo cáo|Quyết định|Giấy mời|Thông báo|Biên bản>","instructions":"<yêu cầu nội dung cụ thể cho văn bản này>"}]}',
    '```',
    'Khối phải là JSON hợp lệ. Không dùng khối egov-doc ở lượt này.]',
    '',
    `Yêu cầu của người dùng: ${request}`
  ].join('\n')
}

/** Lời dặn cho từng bước khi chạy kế hoạch. */
export function buildStepPrompt(plan: DocPlan, step: DocPlanStep): string {
  const idx = plan.steps.findIndex((s) => s.id === step.id)
  const done = plan.steps.slice(0, idx).filter((s) => s.status === 'done')
  const lines = [
    `[Kế hoạch "${plan.name}" — văn bản ${idx + 1}/${plan.steps.length}.`,
    plan.goal ? `Bối cảnh chung: ${plan.goal}` : '',
    done.length > 0
      ? `Các văn bản đã soạn ở các lượt trước trong hội thoại này: ${done.map((s) => `"${s.title}"`).join(', ')} — dùng thống nhất số liệu, thời gian, tên đơn vị với các văn bản đó.`
      : '',
    'Soạn đầy đủ văn bản dưới đây trong một khối egov-doc, ngoài khối chỉ 1–2 câu.]',
    '',
    `Soạn ${step.docType.toLowerCase()}: ${step.title}.`,
    step.instructions ? `Yêu cầu: ${step.instructions}` : ''
  ]
  return lines.filter(Boolean).join('\n')
}
