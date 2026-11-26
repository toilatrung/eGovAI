import { describe, expect, it } from 'vitest'
import {
  findPlaceholders,
  isLayoutTableHeader,
  normalizeDraftMarkdown,
  splitPlaceholders
} from '../src/shared/draftMarkdown'

describe('normalizeDraftMarkdown', () => {
  it('keeps <br> as a canonical token inside table rows', () => {
    const md = '| A<br/>B | C<BR />D |\n| --- | :---: |\n| x<br>y | z |'
    const out = normalizeDraftMarkdown(md)
    expect(out).toBe('| A<br>B | C<br>D |\n| --- | :---: |\n| x<br>y | z |')
  })

  it('turns <br> outside tables into a Markdown hard break', () => {
    expect(normalizeDraftMarkdown('Dòng 1<br>Dòng 2')).toBe('Dòng 1  \nDòng 2')
    expect(normalizeDraftMarkdown('- mục<br />tiếp')).toBe('- mục  \ntiếp')
  })

  it('decodes &nbsp; and entities and drops &nbsp;-only paragraphs', () => {
    const md = 'Số: &nbsp;&nbsp;/UBND\n\n&nbsp;\n\n&nbsp; &nbsp;\n\nA &amp; B &lt;x&gt; &quot;q&quot; &#39;s'
    const out = normalizeDraftMarkdown(md)
    expect(out).not.toContain('&nbsp;')
    expect(out).toBe('Số:   /UBND\n\nA & B <x> "q" \'s')
  })

  it('removes horizontal rules but keeps table delimiter rows', () => {
    const md = 'Trên\n\n---\n\n-------\n\n***\n\n_ _ _\n\n| a | b |\n|---|:---:|\n| 1 | 2 |\n\nDưới'
    const out = normalizeDraftMarkdown(md)
    expect(out).toBe('Trên\n\n| a | b |\n|---|:---:|\n| 1 | 2 |\n\nDưới')
  })

  it('collapses blank lines, trims and leaves fenced code untouched', () => {
    expect(normalizeDraftMarkdown('\n\nA\n\n\n\n\nB\n\n')).toBe('A\n\nB')
    const code = '```\n---\n&nbsp;<br>\n```'
    expect(normalizeDraftMarkdown(code)).toBe(code)
  })
})

describe('findPlaceholders', () => {
  it('finds bracketed fields in order, distinct, ignoring links', () => {
    const md =
      'Phường [Tên phường], [Tên phường] và [Họ và tên]; ngày [...] và […]. Xem [luật](https://x.vn) ![ảnh](a.png) - [x] xong'
    expect(findPlaceholders(md)).toEqual(['[Tên phường]', '[Họ và tên]', '[...]', '[…]'])
  })

  it('finds dotted blanks but not prose ellipses', () => {
    expect(findPlaceholders('Số: .../UBND')).toEqual(['...'])
    expect(findPlaceholders('ngày ... tháng ... năm 2026')).toEqual(['...'])
    expect(findPlaceholders('Họ tên: ……')).toEqual(['……'])
    expect(findPlaceholders('Ông/bà.............. ký')).toEqual(['..............'])
    expect(findPlaceholders('chỉnh trang cảnh quan đô thị... và …')).toEqual([])
  })

  it('ignores over-long brackets and returns mixed placeholders by position', () => {
    const long = '[' + 'a'.repeat(61) + ']'
    expect(findPlaceholders(long)).toEqual([])
    expect(findPlaceholders('[A] ... [B]')).toEqual(['[A]', '...', '[B]'])
  })

  it('splitPlaceholders flags the placeholder segments', () => {
    expect(splitPlaceholders('ngày [..] tháng 11')).toEqual([
      { text: 'ngày ', placeholder: false },
      { text: '[..]', placeholder: true },
      { text: ' tháng 11', placeholder: false }
    ])
  })
})

describe('isLayoutTableHeader', () => {
  it('detects the Quốc hiệu header block', () => {
    expect(
      isLayoutTableHeader([
        'ỦY BAN NHÂN DÂN<br>**PHƯỜNG [TÊN PHƯỜNG]**',
        '**CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**<br>**Độc lập - Tự do - Hạnh phúc**'
      ])
    ).toBe(true)
    expect(isLayoutTableHeader(['UBND', 'Cộng hoà xã hội chủ nghĩa Việt Nam'])).toBe(true)
  })

  it('detects signature blocks', () => {
    expect(isLayoutTableHeader(['**Nơi nhận:**', '**TM. ỦY BAN NHÂN DÂN**'])).toBe(true)
    expect(isLayoutTableHeader(['*nơi nhận:*', ''])).toBe(true)
    expect(isLayoutTableHeader(['', '**KT. CHỦ TỊCH**'])).toBe(true)
    expect(isLayoutTableHeader(['', 'GIÁM ĐỐC'])).toBe(true)
  })

  it('does not flag ordinary data tables', () => {
    expect(isLayoutTableHeader(['STT', 'Nội dung', 'Kết quả'])).toBe(false)
    expect(isLayoutTableHeader(['Họ tên', 'Chức vụ'])).toBe(false)
    expect(isLayoutTableHeader(['STT', 'TM.', 'x'])).toBe(false)
    expect(isLayoutTableHeader([])).toBe(false)
  })
})
