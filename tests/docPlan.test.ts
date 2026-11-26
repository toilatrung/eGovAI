import { describe, expect, it } from 'vitest'
import { join } from 'path'
import {
  DOC_PLAN_TEMPLATES,
  buildPlanningPrompt,
  buildStepPrompt,
  parsePlanBlock,
  stripPlanBlock,
  type DocPlan
} from '../src/shared/docPlan'
import { buildDraftDocxPath, draftFileBaseName } from '../src/main/services/draftFiles'
import { toStandardChromeUserAgent } from '../src/main/services/inAppBrowserService'

const REPLY = [
  'Tôi đề xuất 3 văn bản theo thứ tự:',
  '```egov-plan',
  '{"name":"Hội nghị tổng kết 2026","steps":[',
  '{"title":"Kế hoạch tổ chức hội nghị","docType":"Kế hoạch","instructions":"Thời gian 20/12"},',
  '{"title":"Giấy mời đại biểu","docType":"Giấy mời","instructions":""},',
  '{"title":"","docType":"Báo cáo"}',
  ']}',
  '```'
].join('\n')

describe('docPlan', () => {
  it('đọc khối egov-plan, bỏ bước không có tên', () => {
    const parsed = parsePlanBlock(REPLY)
    expect(parsed?.name).toBe('Hội nghị tổng kết 2026')
    expect(parsed?.steps.map((s) => s.title)).toEqual(['Kế hoạch tổ chức hội nghị', 'Giấy mời đại biểu'])
  })

  it('JSON hỏng thì trả null', () => {
    expect(parsePlanBlock('```egov-plan\n{"steps": [\n```')).toBeNull()
    expect(parsePlanBlock('không có khối')).toBeNull()
  })

  it('ẩn khối kế hoạch khỏi chat, kể cả khi đang stream', () => {
    expect(stripPlanBlock(REPLY)).toEqual({ text: 'Tôi đề xuất 3 văn bản theo thứ tự:', hasPlan: true, closed: true })
    const partial = REPLY.slice(0, REPLY.indexOf('"Giấy mời'))
    const r = stripPlanBlock(partial)
    expect(r.hasPlan).toBe(true)
    expect(r.closed).toBe(false)
    expect(r.text).toBe('Tôi đề xuất 3 văn bản theo thứ tự:')
  })

  it('lời dặn lập kế hoạch không cho soạn ngay', () => {
    const p = buildPlanningPrompt('Tổ chức hội nghị tổng kết')
    expect(p).toContain('CHƯA soạn')
    expect(p).toContain('egov-plan')
    expect(p).toContain('Tổ chức hội nghị tổng kết')
  })

  it('lời dặn từng bước nhắc các văn bản đã soạn trước', () => {
    const plan: DocPlan = {
      id: 'p',
      projectId: 'x',
      name: 'Hội nghị',
      goal: 'UBND xã Thiệu Toán, 20/12/2026',
      status: 'running',
      createdAt: 0,
      updatedAt: 0,
      steps: DOC_PLAN_TEMPLATES[0].steps.map((s, i) => ({
        ...s,
        id: `s${i}`,
        status: i === 0 ? 'done' : 'pending'
      }))
    }
    const p = buildStepPrompt(plan, plan.steps[1])
    expect(p).toContain('văn bản 2/4')
    expect(p).toContain('"Kế hoạch tổ chức"')
    expect(p).toContain('UBND xã Thiệu Toán')
    expect(p).toContain('egov-doc')
  })
})

describe('lưu tệp Word trong dự án', () => {
  it('tên tệp giữ tiếng Việt, bỏ ký tự cấm', () => {
    expect(draftFileBaseName('Công văn – V/v tổng vệ sinh: "đợt 1"?')).toBe('Công văn - V v tổng vệ sinh đợt 1')
    expect(draftFileBaseName('   ')).toBe('Van ban')
  })

  it('không ghi đè tệp đã có, thư mục con an toàn', () => {
    const taken = new Set([join('D:/du-an', 'Van-ban', 'Báo cáo.docx'), join('D:/du-an', 'Van-ban', 'Báo cáo (2).docx')])
    expect(buildDraftDocxPath('D:/du-an', 'Báo cáo', undefined, (p) => taken.has(p))).toBe(
      join('D:/du-an', 'Van-ban', 'Báo cáo (3).docx')
    )
    expect(buildDraftDocxPath('D:/du-an', 'A', '../../Windows', () => false)).toBe(
      join('D:/du-an', 'Windows', 'A.docx')
    )
    expect(buildDraftDocxPath('D:/du-an', 'A', 'Ke-hoach/Hội nghị', () => false)).toBe(
      join('D:/du-an', 'Ke-hoach', 'Hội nghị', 'A.docx')
    )
  })
})

describe('User-Agent trình duyệt tích hợp', () => {
  it('bỏ GoogleAI/ và Electron/ để cổng nhà nước không chặn', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) GoogleAI/0.2.0 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36'
    expect(toStandardChromeUserAgent(ua)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.205 Safari/537.36'
    )
  })
})
