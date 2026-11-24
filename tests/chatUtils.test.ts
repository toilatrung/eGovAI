import { describe, expect, it } from 'vitest'
import { classifyImageSrc, markdownUrlTransform } from '../src/renderer/src/utils/markdownSafety'
import { extractLegalReferences, vbplSearchUrl } from '../src/renderer/src/utils/legalRefs'
import {
  buildReplayPrompt,
  conversationToMarkdown,
  exportFileBaseName,
  searchConversations
} from '../src/renderer/src/utils/conversationTools'
import type { ChatMessage, Conversation } from '../src/shared/types'

describe('classifyImageSrc', () => {
  it('treats http(s) and protocol-relative URLs as remote', () => {
    expect(classifyImageSrc('https://evil.example/x.png?q=secret')).toEqual({
      kind: 'remote',
      url: 'https://evil.example/x.png?q=secret',
      host: 'evil.example'
    })
    expect(classifyImageSrc('HTTP://a.b:8080/p')).toMatchObject({ kind: 'remote', host: 'a.b:8080' })
    expect(classifyImageSrc('//cdn.example/a.gif')).toMatchObject({ kind: 'remote', host: 'cdn.example' })
    expect(classifyImageSrc('  https://x.y/ ')).toMatchObject({ kind: 'remote', host: 'x.y' })
  })

  it('renders local, data:image, blob and file:/// sources', () => {
    expect(classifyImageSrc('data:image/png;base64,AAAA')).toMatchObject({ kind: 'local' })
    expect(classifyImageSrc('blob:http://localhost/123')).toMatchObject({ kind: 'local' })
    expect(classifyImageSrc('file:///C:/Users/a/b.png')).toMatchObject({ kind: 'local' })
    expect(classifyImageSrc('images/chart.png')).toEqual({ kind: 'local', src: 'images/chart.png' })
    expect(classifyImageSrc('C:\\Ho so\\anh.png')).toEqual({
      kind: 'local',
      src: 'file:///C:/Ho%20so/anh.png'
    })
  })

  it('blocks network shares, non-image data and other schemes', () => {
    expect(classifyImageSrc('\\\\server\\share\\a.png').kind).toBe('blocked')
    expect(classifyImageSrc('file://server/share/a.png').kind).toBe('blocked')
    expect(classifyImageSrc('data:text/html,<script>').kind).toBe('blocked')
    expect(classifyImageSrc('javascript:alert(1)').kind).toBe('blocked')
    expect(classifyImageSrc('ftp://x/y.png').kind).toBe('blocked')
    expect(classifyImageSrc('').kind).toBe('blocked')
    expect(classifyImageSrc(undefined).kind).toBe('blocked')
  })

  it('keeps data:image only for img src in the markdown transform', () => {
    expect(markdownUrlTransform('data:image/png;base64,AA', 'src', { tagName: 'img' })).toBe(
      'data:image/png;base64,AA'
    )
    expect(markdownUrlTransform('data:image/png;base64,AA', 'href', { tagName: 'a' })).toBe('')
    expect(markdownUrlTransform('javascript:x', 'src', { tagName: 'img' })).toBe('')
  })
})

describe('extractLegalReferences', () => {
  it('finds realistic citations with their type', () => {
    const text =
      'Căn cứ Luật Cán bộ, công chức và Luật Viên chức sửa đổi số 52/2019/QH14; ' +
      'Nghị định 30/2020/NĐ-CP ngày 05/3/2020 của Chính phủ về công tác văn thư; ' +
      'Thông tư 01/2011/TT-BNV hướng dẫn thể thức văn bản và Quyết định số 1234/QĐ-UBND.'
    const refs = extractLegalReferences(text)
    expect(refs.map((r) => r.label)).toEqual([
      'Luật 52/2019/QH14',
      'Nghị định 30/2020/NĐ-CP',
      'Thông tư 01/2011/TT-BNV',
      'Quyết định 1234/QĐ-UBND'
    ])
  })

  it('does not treat dates or fractions as documents', () => {
    expect(extractLegalReferences('ngày 12/05/2023, tỷ lệ 3/4, mục 2/A')).toEqual([])
  })

  it('infers type from code when no type word precedes', () => {
    const refs = extractLegalReferences('Xem 45/2019/QH14, 10/2022/QĐ-TTg và 24/2023/TTLT-BTC-BNV.')
    expect(refs.map((r) => r.label)).toEqual([
      'Luật 45/2019/QH14',
      'Quyết định 10/2022/QĐ-TTg',
      'Thông tư liên tịch 24/2023/TTLT-BTC-BNV'
    ])
  })

  it('does not carry a type word over to the next citation', () => {
    const refs = extractLegalReferences('Theo Nghị định 30/2020/NĐ-CP, 01/2011/TT-BNV')
    expect(refs[1].label).toBe('Thông tư 01/2011/TT-BNV')
  })

  it('dedupes, handles markdown emphasis and lowercase type words', () => {
    const refs = extractLegalReferences(
      '**Nghị định số 30/2020/NĐ-CP** … theo nghị định 30/2020/NĐ-CP và Bộ luật Lao động số 45/2019/QH14'
    )
    expect(refs.map((r) => r.label)).toEqual([
      'Nghị định 30/2020/NĐ-CP',
      'Bộ luật 45/2019/QH14'
    ])
  })

  it('builds a vbpl.vn search URL', () => {
    const [ref] = extractLegalReferences('Nghị định 30/2020/NĐ-CP')
    expect(vbplSearchUrl(ref)).toBe(
      'https://vbpl.vn/pages/vbpq-timkiem.aspx?Keyword=30%2F2020%2FN%C4%90-CP'
    )
  })
})

function msg(role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: Math.random().toString(36), role, content, createdAt: 0, ...extra }
}

function conv(id: string, title: string, messages: ChatMessage[]): Conversation {
  return { id, projectId: 'p', title, createdAt: 0, updatedAt: 0, messages }
}

describe('searchConversations', () => {
  const list = [
    conv('a', 'Soạn kế hoạch tuyển sinh', [msg('user', 'xin chào')]),
    conv('b', 'Báo cáo quý', [
      msg('user', 'Hãy soạn công văn'),
      msg('assistant', 'Dưới đây là dự thảo công văn gửi Phòng Giáo dục và Đào tạo huyện về việc tổ chức thi.')
    ]),
    conv('c', 'Khác', [msg('user', 'không liên quan')])
  ]

  it('returns everything for an empty query', () => {
    expect(searchConversations(list, '  ')).toHaveLength(3)
  })

  it('matches titles first, then content with a snippet, ignoring diacritics', () => {
    const hits = searchConversations(list, 'giao duc')
    expect(hits).toHaveLength(1)
    expect(hits[0].conversation.id).toBe('b')
    expect(hits[0].snippet?.match).toBe('Giáo dục')
    expect(hits[0].snippet?.before.endsWith('Phòng ')).toBe(true)

    const titleHit = searchConversations(list, 'tuyen sinh')
    expect(titleHit[0].conversation.id).toBe('a')
    expect(titleHit[0].snippet).toBeUndefined()
  })
})

describe('export helpers', () => {
  it('renders markdown with role headings', () => {
    const md = conversationToMarkdown(
      conv('x', 'Thử', [msg('user', 'Câu hỏi'), msg('assistant', 'Trả lời'), msg('assistant', '', { status: 'error', error: 'hỏng' })])
    )
    expect(md).toContain('# Thử')
    expect(md).toContain('Câu hỏi')
    expect(md).toContain('Trả lời')
    expect(md).toContain('> Lỗi: hỏng')
  })

  it('sanitises file names', () => {
    expect(exportFileBaseName('Kế hoạch: 2025/2026?')).toBe('Kế hoạch 2025 2026')
    expect(exportFileBaseName('***')).toBe('hoi-thoai')
  })
})

describe('buildReplayPrompt', () => {
  it('returns the text unchanged without history', () => {
    expect(buildReplayPrompt([], 'abc')).toBe('abc')
  })

  it('inlines kept history and skips failed answers', () => {
    const prompt = buildReplayPrompt(
      [msg('user', 'Q1'), msg('assistant', 'A1'), msg('assistant', 'bad', { status: 'error' })],
      'Q2'
    )
    expect(prompt).toContain('Người dùng: Q1')
    expect(prompt).toContain('eGovAI: A1')
    expect(prompt).not.toContain('bad')
    expect(prompt.endsWith('Yêu cầu hiện tại:\nQ2')).toBe(true)
  })
})
