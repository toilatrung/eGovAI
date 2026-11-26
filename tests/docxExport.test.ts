import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import mammoth from 'mammoth'
import { readZipEntries } from '../src/main/services/security/classificationGuard'
import { AI_DRAFT_MARK, exportMarkdownToDocx } from '../src/main/services/document/documentService'

const CONG_VAN = `| ỦY BAN NHÂN DÂN<br>**PHƯỜNG [TÊN PHƯỜNG]** | **CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**<br>**Độc lập - Tự do - Hạnh phúc** |
| :---: | :---: |
| Số: &nbsp;&nbsp;&nbsp;&nbsp;/UBND-[Ký hiệu BP tham mưu]<br>*V/v tổ chức đợt tổng vệ sinh môi trường<br>cuối năm 2026* | *[Địa danh], ngày [..] tháng 11 năm 2026* |

&nbsp;

**Kính gửi:** Các Tổ dân phố trên địa bàn phường [Tên phường].

Nhằm thiết thực chỉnh trang cảnh quan đô thị, bảo đảm vệ sinh môi trường...

**1. Thời gian thực hiện**
- Đợt cao điểm ra quân vào **sáng thứ Bảy và Chủ nhật hàng tuần**, bắt đầu từ ngày **[...]/11/2026**.
- Chi tiết tại \`Kế hoạch\` và _Phụ lục_ kèm theo.

---

| **Nơi nhận:** | **TM. ỦY BAN NHÂN DÂN** |
| :--- | :---: |
| - Như trên;<br>- Lưu: VT, [Ký hiệu BP]. | **CHỦ TỊCH**<br>*(hoặc KT. CHỦ TỊCH / PHÓ CHỦ TỊCH)*<br><br><br><br>**[Họ và tên]** |
`

const BAO_CAO = `# BÁO CÁO

## Kết quả thực hiện nhiệm vụ năm 2026

### III. NHIỆM VỤ

1. Hoàn thành chỉ tiêu ***thu ngân sách***.
2. Đẩy mạnh chuyển đổi số:
   - Cấp xã triển khai ~~cũ~~ dịch vụ công trực tuyến;
     - Nhánh con cấp 3.
   - Tuyên truyền người dân.
3. Tổng kết cuối năm.

#### 1.1. Chi tiết

-------

> Ghi chú: số liệu tạm tính.

| STT | Đơn vị | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Thôn 1 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | *Đạt* |
| **Tổng** | | **1** | **2** | 3 | 4 | 5 | 6 | 7 | 8 | 9 | |
`

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'egovai-docx-export-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function exportAndRead(name: string, md: string) {
  const target = join(dir, name)
  const res = await exportMarkdownToDocx(target, md)
  expect(res.path).toBe(target)
  expect(res.mtimeMs).toBeGreaterThan(0)
  const buf = readFileSync(target)
  const entries = readZipEntries(buf, (n) =>
    ['word/document.xml', 'word/numbering.xml', 'word/styles.xml', 'docProps/core.xml'].includes(n)
  )
  const xml = entries.get('word/document.xml')!.toString('utf8')
  const numbering = entries.get('word/numbering.xml')?.toString('utf8') ?? ''
  const styles = entries.get('word/styles.xml')!.toString('utf8')
  const core = entries.get('docProps/core.xml')!.toString('utf8')
  const { value: text } = await mammoth.extractRawText({ buffer: buf })
  return { xml, numbering, styles, core, text }
}

function tables(xml: string): string[] {
  return xml.split('<w:tbl>').slice(1).map((t) => t.split('</w:tbl>')[0])
}

function tblBorders(tbl: string): string {
  return tbl.match(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/)?.[0] ?? ''
}

function expectNoMarkdownArtifacts(text: string, xml: string) {
  for (const s of [text, xml]) {
    expect(s).not.toContain('**')
    expect(s).not.toContain('&nbsp;')
    expect(s).not.toContain('&amp;nbsp;')
    expect(s).not.toMatch(/&lt;br\s*\/?&gt;|<br>/i)
    expect(s).not.toContain('---')
    expect(s).not.toContain('~~')
  }
  expect(text).not.toMatch(/(^|\s)\*[^\s*]/)
  expect(text).not.toContain('`')
}

describe('exportMarkdownToDocx — công văn sample (NĐ 30/2020)', () => {
  it('produces clean text with no Markdown/HTML artifacts and keeps metadata', async () => {
    const { xml, text, core } = await exportAndRead('cong-van.docx', CONG_VAN)
    expectNoMarkdownArtifacts(text, xml)
    expect(text).toContain('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM')
    expect(text).toContain('Độc lập - Tự do - Hạnh phúc')
    expect(text).toContain('Kính gửi:')
    expect(text).toContain('Kế hoạch')
    expect(text).toContain('Phụ lục')
    expect(text).not.toContain('_Phụ lục_')
    expect(core).toContain(`<dc:creator>${AI_DRAFT_MARK}</dc:creator>`)
    expect(xml).not.toContain('Consolas')
    expect(xml).toContain('Times New Roman')
  })

  it('exports the Quốc hiệu and signature tables as borderless layout tables', async () => {
    const { xml } = await exportAndRead('cong-van-layout.docx', CONG_VAN)
    const tbls = tables(xml)
    expect(tbls).toHaveLength(2)
    for (const tbl of tbls) {
      const borders = tblBorders(tbl)
      expect(borders).toMatch(/w:val="(none|nil)"/)
      expect(borders).not.toContain('w:val="single"')
      expect(tbl).not.toContain('w:val="single"')
      // two equal columns
      const grid = [...tbl.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
      expect(grid).toHaveLength(2)
      expect(grid[0]).toBe(grid[1])
    }
    expect(tbls[0]).toContain('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM')
    expect(tbls[1]).toContain('Nơi nhận:')
    // each <br> line became its own paragraph; the blank signing space is kept
    expect((tbls[1].match(/<w:p>|<w:p /g) ?? []).length).toBeGreaterThanOrEqual(9)
    expect(tbls[0]).toContain('V/v tổ chức đợt tổng vệ sinh môi trường')
  })

  it('highlights placeholders in yellow', async () => {
    const { xml } = await exportAndRead('cong-van-ph.docx', CONG_VAN)
    expect(xml).toContain('<w:highlight w:val="yellow"/>')
    const highlighted = [...xml.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:highlight w:val="yellow"\/>[\s\S]*?<w:t[^>]*>([^<]*)<\/w:t>/g)].map(
      (m) => m[1]
    )
    expect(highlighted).toEqual(
      expect.arrayContaining(['[TÊN PHƯỜNG]', '[Họ và tên]', '[Tên phường]', '[...]', '[..]'])
    )
  })
})

describe('exportMarkdownToDocx — báo cáo sample', () => {
  it('keeps ordered-list numbering, nested bullets and black headings', async () => {
    const { xml, numbering, styles, text } = await exportAndRead('bao-cao.docx', BAO_CAO)
    expectNoMarkdownArtifacts(text, xml)
    expect(text).toContain('NHIỆM VỤ')
    expect(text).toContain('Chi tiết')
    expect(text).not.toMatch(/#/)

    // ordered list → real Word numbering with "%1." decimal
    expect(numbering).toContain('w:val="decimal"')
    expect(numbering).toContain('w:val="%1."')
    expect(numbering).toMatch(/<w:lvlText w:val="-"\/>/)
    const numbered = xml.match(/<w:numPr>[\s\S]*?<\/w:numPr>/g) ?? []
    // 3 ordered items + 3 bullets (2 level-1 and 1 level-2)
    expect(numbered.length).toBe(6)
    expect(xml).toMatch(/<w:ilvl w:val="1"\/>/)
    expect(xml).toMatch(/<w:ilvl w:val="2"\/>/)
    expect(text).not.toMatch(/^\s*1\.\s/m) // numbers come from numbering, not literal text

    // headings: built-in heading styles redefined black Times New Roman
    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('w:val="Heading4"')
    const h1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)?.[0] ?? ''
    expect(h1).toContain('w:val="000000"')
    expect(h1).toContain('Times New Roman')
    // "BÁO CÁO" is centered
    const baoCaoPara = xml.split('<w:p>').find((p) => p.includes('>BÁO CÁO<')) ?? ''
    expect(baoCaoPara).toContain('<w:jc w:val="center"/>')
  })

  it('exports the 12-column table as a bordered data table with bold header and Tổng row', async () => {
    const { xml } = await exportAndRead('bao-cao-table.docx', BAO_CAO)
    const tbls = tables(xml)
    expect(tbls).toHaveLength(1)
    const tbl = tbls[0]
    expect(tblBorders(tbl)).toContain('w:val="single"')
    expect([...tbl.matchAll(/<w:gridCol /g)]).toHaveLength(12)
    expect(tbl).toContain('<w:tblHeader/>')
    expect(tbl).toContain('w:val="26"') // 13pt cell font
    const tongRun = tbl.match(/<w:r>(?:(?!<\/w:r>)[\s\S])*?>Tổng</)?.[0] ?? ''
    expect(tongRun).toContain('<w:b/>')
  })

  it('renders blockquotes as italic indented paragraphs', async () => {
    const { xml } = await exportAndRead('bao-cao-quote.docx', BAO_CAO)
    const para = xml.split('<w:p>').find((p) => p.includes('Ghi chú: số liệu tạm tính.')) ?? ''
    expect(para).toContain('<w:i/>')
    expect(para).toMatch(/<w:ind w:left="\d+"/)
  })
})
