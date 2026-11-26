import { describe, expect, it } from 'vitest'
import { getLatestDocSegment, splitDocBlocks } from '../src/shared/docBlocks'
import { AI_PRESETS, detectAiPreset, resolveAiPreset } from '../src/shared/aiPresets'

const FULL = [
  'Tôi đã soạn công văn bên dưới.',
  '',
  '```egov-doc title="Công văn – V/v tổng vệ sinh"',
  '| ỦY BAN NHÂN DÂN | CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM |',
  '| :---: | :---: |',
  '',
  '**Kính gửi:** Các thôn.',
  '```',
  '',
  'Còn thiếu: họ tên người ký.'
].join('\n')

describe('splitDocBlocks', () => {
  it('tách lời trao đổi và khối văn bản', () => {
    const segs = splitDocBlocks(FULL)
    expect(segs.map((s) => s.type)).toEqual(['text', 'doc', 'text'])
    const doc = segs[1]
    expect(doc.type === 'doc' && doc.title).toBe('Công văn – V/v tổng vệ sinh')
    expect(doc.type === 'doc' && doc.closed).toBe(true)
    expect(doc.type === 'doc' && doc.body.startsWith('| ỦY BAN NHÂN DÂN')).toBe(true)
    expect(doc.type === 'doc' && doc.body.includes('```')).toBe(false)
  })

  it('chịu được khối đang stream chưa đóng', () => {
    const partial = FULL.slice(0, FULL.indexOf('**Kính gửi'))
    const segs = splitDocBlocks(partial)
    const doc = segs.find((s) => s.type === 'doc')
    expect(doc && doc.type === 'doc' && doc.closed).toBe(false)
  })

  it('ẩn dấu mở khối bị cắt dở ở cuối luồng', () => {
    for (const cut of ['Đây là văn bản:\n```', 'Đây là văn bản:\n```egov', 'Đây là văn bản:\n```egov-d']) {
      const segs = splitDocBlocks(cut)
      expect(segs).toEqual([{ type: 'text', text: 'Đây là văn bản:' }])
    }
  })

  it('không đụng tới mã nội dòng ở cuối câu', () => {
    const segs = splitDocBlocks('Dùng lệnh `abc`')
    expect(segs).toEqual([{ type: 'text', text: 'Dùng lệnh `abc`' }])
  })

  it('lấy khối văn bản mới nhất khi có nhiều khối', () => {
    const two = '```egov-doc title="Bản 1"\nA\n```\nsửa lại:\n```egov-doc title="Bản 2"\nB\n```'
    expect(getLatestDocSegment(two)?.title).toBe('Bản 2')
    expect(getLatestDocSegment(two)?.index).toBe(1)
  })

  it('không có khối thì chỉ có lời trao đổi', () => {
    expect(splitDocBlocks('Xin chào')).toEqual([{ type: 'text', text: 'Xin chào' }])
  })
})

describe('aiPresets', () => {
  const models = [
    { id: 'gemini-4-hydrogen-high' },
    { id: 'gemini-4-hydrogen-medium' },
    { id: 'gemini-3.8-flash-medium' },
    { id: 'claude-sonnet-4-6' }
  ]

  it('ánh xạ 3 chế độ sang mô hình có thật', () => {
    expect(resolveAiPreset('fast', models)).toEqual({ modelId: 'gemini-3.8-flash-medium', effort: 'low' })
    expect(resolveAiPreset('balanced', models)).toEqual({ modelId: 'gemini-4-hydrogen-medium', effort: 'medium' })
    expect(resolveAiPreset('deep', models)).toEqual({ modelId: 'gemini-4-hydrogen-high', effort: 'high' })
  })

  it('không có danh sách mô hình thì để lõi tự chọn', () => {
    expect(resolveAiPreset('balanced', [])).toEqual({ modelId: '', effort: 'medium' })
  })

  it('nhận lại chế độ từ cặp mô hình/mức suy luận', () => {
    for (const p of AI_PRESETS) {
      const r = resolveAiPreset(p.id, models)
      expect(detectAiPreset(r.modelId, r.effort, models)).toBe(p.id)
    }
    expect(detectAiPreset('claude-sonnet-4-6', 'medium', models)).toBeNull()
  })
})

import { deriveLiveDraftTitle, looksLikeDocumentDraft } from '../src/renderer/src/utils/liveDraft'

describe('nhận diện & đặt tên văn bản (B4, B5)', () => {
  it('câu trả lời tra cứu dài có tiêu đề đánh số không bị coi là văn bản', () => {
    const lookup =
      'Theo quy định hiện hành:\n\n### 1. Mức lương cơ sở hiện hành\n- Mức áp dụng: 2.530.000 đồng/tháng.\n\n### 2. Văn bản quy phạm\n- Nghị định ... ngày 15/5/2026 của Chính phủ quy định mức lương cơ sở và chế độ tiền thưởng.\n\n### 3. Nguồn\n- chinhphu.vn'
    expect(looksLikeDocumentDraft(lookup)).toBe(false)
  })

  it('văn bản có Quốc hiệu + Kính gửi là văn bản', () => {
    const doc =
      '| ỦY BAN NHÂN DÂN<br>XÃ THIỆU TOÁN | CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br>Độc lập - Tự do - Hạnh phúc |\n| :-: | :-: |\n\n**Kính gửi:** Trưởng các thôn trên địa bàn xã.'
    expect(looksLikeDocumentDraft(doc)).toBe(true)
  })

  it('không lấy tiêu đề phụ "Các thông tin còn thiếu" hay mục "1."', () => {
    const doc =
      'ỦY BAN NHÂN DÂN\nSố: 125/UBND-VP\nV/v tổ chức tổng vệ sinh môi trường đón Tết\n\n### Các thông tin còn thiếu cần bổ sung\n1. Họ tên'
    expect(deriveLiveDraftTitle(doc)).toBe('Công văn – V/v tổ chức tổng vệ sinh môi trường đón Tết')
    expect(deriveLiveDraftTitle('### 1. Giấy tờ cần chuẩn bị\nabc')).toBe('Bản nháp văn bản')
  })

  it('loại văn bản + trích yếu dòng kế tiếp', () => {
    expect(deriveLiveDraftTitle('## BÁO CÁO\n**Kết quả thực hiện công tác giảm nghèo năm 2026**')).toBe(
      'Báo cáo – Kết quả thực hiện công tác giảm nghèo năm 2026'
    )
  })
})

import { normalizeDraftMarkdown } from '../src/shared/draftMarkdown'

describe('bảng chữ ký một hàng (thiếu hàng phân cách)', () => {
  it('tự bổ sung hàng phân cách để thành bảng', () => {
    const md = 'Đề nghị thực hiện./.\n\n| **Nơi nhận:**<br>- Như trên;<br>- Lưu: VT. | **CHỦ TỊCH**<br><br>**Lê Văn Nam** |'
    const out = normalizeDraftMarkdown(md).split('\n')
    expect(out.at(-1)).toBe('| --- | --- |')
    expect(out.at(-2)?.startsWith('| **Nơi nhận:**')).toBe(true)
  })

  it('không đụng tới bảng đã đúng chuẩn', () => {
    const md = '| A | B |\n| :-: | :-: |\n| 1 | 2 |'
    expect(normalizeDraftMarkdown(md)).toBe(md)
  })
})

import { curateModels, resolveModelChoice } from '../src/shared/aiPresets'

describe('danh sách mô hình rút gọn', () => {
  const real = [
    { id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)' },
    { id: 'gemini-4-hydrogen-xhigh', name: 'Gemini 4 Hydrogen (XHigh)' },
    { id: 'gemini-4-hydrogen-medium', name: 'Gemini 4 Hydrogen (Medium)' },
    { id: 'gemini-4-hydrogen-low', name: 'Gemini 4 Hydrogen (Low)' },
    { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.5-flash-medium', name: 'Gemini 3.5 Flash (Medium)' },
    { id: 'gemini-3-hydrogen-high', name: 'Gemini 3 Hydrogen (High)' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Thinking)' },
    { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
  ]

  it('gộp mức suy luận và bỏ phiên bản cũ', () => {
    expect(curateModels(real).map((f) => f.label)).toEqual([
      'Gemini 4 Hydrogen',
      'Gemini 3.8 Flash',
      'Claude Sonnet 4.6 (Thinking)',
      'Claude Opus 4.6 (Thinking)',
      'GPT-OSS 120B'
    ])
  })

  it('chọn đúng biến thể theo Chế độ AI', () => {
    expect(resolveModelChoice('fast', 'gemini-4-hydrogen', real)).toEqual({
      modelId: 'gemini-4-hydrogen-low',
      effort: 'low'
    })
    expect(resolveModelChoice('deep', 'gemini-3.8-flash', real).modelId).toBe('gemini-3.8-flash-high')
    expect(resolveModelChoice('balanced', 'claude-sonnet-4-6', real)).toEqual({
      modelId: 'claude-sonnet-4-6',
      effort: 'medium'
    })
    // mô hình không có mức "high" → lấy mức gần nhất
    expect(resolveModelChoice('deep', 'gpt-oss-120b', real).modelId).toBe('gpt-oss-120b-medium')
    // bỏ trống = để Chế độ AI tự chọn
    expect(resolveModelChoice('balanced', '', real).modelId).toBe('gemini-4-hydrogen-medium')
  })
})
