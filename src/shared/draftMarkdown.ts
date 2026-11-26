/**
 * Pure helpers for AI-drafted Vietnamese administrative documents (Markdown).
 * Shared by the renderer (preview) and the main process (Word export).
 * NO npm imports here.
 */

/** Canonical line-break token kept inside GFM table cells. */
export const BR_TOKEN = '<br>'

const BR_RE = /<br\s*\/?>/gi
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/ /g, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/**
 * Cleans model output before rendering/exporting:
 * - `<br>` variants → `<br>` token inside table rows, Markdown hard break (`  \n`) elsewhere
 * - `&nbsp;` and common entities decoded; lines that are only whitespace become blank
 * - horizontal rules (`---`, `***`, `___`, `- - -`) removed (GFM table delimiter rows are kept)
 * - runs of blank lines collapsed to a single blank line; result trimmed
 * Fenced code blocks are left untouched.
 */
export function normalizeDraftMarkdown(md: string): string {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: string | null = null

  for (const raw of lines) {
    const fenceMatch = raw.match(FENCE_RE)
    if (fence) {
      out.push(raw)
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      out.push(raw)
      continue
    }

    let line = decodeEntities(raw)
    const isTableRow = line.trimStart().startsWith('|')
    if (isTableRow) {
      line = line.replace(BR_RE, BR_TOKEN)
    } else {
      if (HR_RE.test(line)) continue
      line = line.replace(BR_RE, '  \n')
    }
    // Split possible hard breaks into separate physical lines, blank-out whitespace-only ones.
    for (const part of line.split('\n')) {
      out.push(part.trim() === '' ? '' : part.replace(/[ \t]+$/, (m) => (m.length >= 2 ? '  ' : '')))
    }
  }

  return completeLoneTableRows(out)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const DELIMITER_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * Mô hình hay viết khối "Nơi nhận | Chữ ký" thành một hàng `| … | … |` đứng một mình, thiếu
 * hàng phân cách nên không được nhận là bảng (hiện ra dấu `|` thô). Bổ sung hàng phân cách
 * ngay sau hàng đầu của mọi nhóm hàng bảng chưa có.
 */
function completeLoneTableRows(lines: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    result.push(line)
    const isRow = TABLE_ROW_RE.test(line) && !DELIMITER_ROW_RE.test(line)
    const startsGroup = isRow && (i === 0 || !TABLE_ROW_RE.test(lines[i - 1]))
    if (!startsGroup) continue
    const next = lines[i + 1]
    if (next !== undefined && DELIMITER_ROW_RE.test(next)) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').length
    if (cells < 2) continue
    result.push(`| ${Array.from({ length: cells }, () => '---').join(' | ')} |`)
  }
  return result
}

export interface PlaceholderMatch {
  index: number
  text: string
}

const BRACKET_RE = /\[([^\[\]\n]{1,60})\](?!\()/g
const DOTS_RE = /\.{3,}|…{2,}|…/g

/** Finds placeholder ranges in a single text (bracketed fields and dotted blanks). */
export function scanPlaceholders(text: string): PlaceholderMatch[] {
  const found: PlaceholderMatch[] = []
  const covered: Array<[number, number]> = []
  const src = String(text ?? '')

  BRACKET_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BRACKET_RE.exec(src)) !== null) {
    const inner = m[1]
    const start = m.index
    if (start > 0 && src[start - 1] === '!') continue // image alt
    if (inner.startsWith('^')) continue // footnote
    if (/^[ xX]$/.test(inner)) continue // task-list checkbox
    if (src[start + m[0].length] === '[') continue // reference link
    if (src[start + m[0].length] === ':' && start === 0) continue // link definition
    if (!inner.trim()) continue
    found.push({ index: start, text: m[0] })
    covered.push([start, start + m[0].length])
  }

  DOTS_RE.lastIndex = 0
  while ((m = DOTS_RE.exec(src)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (covered.some(([a, b]) => start >= a && end <= b)) continue
    const tok = m[0]
    const isLong = (tok[0] === '.' && tok.length >= 5) || (tok[0] === '…' && tok.length >= 2)
    if (!isLong) {
      if (tok === '…') continue // a single ellipsis char is prose
      const prev = start > 0 ? src[start - 1] : ''
      const next = src[end] ?? ''
      const prevIsWord = /[\p{L}\p{N})]/u.test(prev)
      if (prevIsWord && next !== '/') continue // "đô thị..." is a prose ellipsis
    }
    found.push({ index: start, text: tok })
  }

  return found.sort((a, b) => a.index - b.index)
}

/**
 * Distinct placeholders left for the user to fill, in order of first appearance:
 * `[Tên xã]`, `[...]`, `[Họ và tên]`, and dotted blanks such as `...` in `.../UBND`
 * or `ngày ... tháng ... năm`, and `……`.
 */
export function findPlaceholders(md: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const p of scanPlaceholders(md)) {
    if (seen.has(p.text)) continue
    seen.add(p.text)
    result.push(p.text)
  }
  return result
}

/** Splits plain text into segments, flagging placeholder segments (for highlighting). */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  const parts: Array<{ text: string; placeholder: boolean }> = []
  let last = 0
  for (const p of scanPlaceholders(text)) {
    if (p.index < last) continue
    if (p.index > last) parts.push({ text: text.slice(last, p.index), placeholder: false })
    parts.push({ text: p.text, placeholder: true })
    last = p.index + p.text.length
  }
  if (last < text.length) parts.push({ text: text.slice(last), placeholder: false })
  return parts
}

/** Strips inline Markdown markers and `<br>` from a table cell for classification. */
export function stripCellMarkdown(cell: string): string {
  return String(cell ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when a Markdown table is a layout table (Quốc hiệu header block or signature
 * block) rather than a data table. Pass the cells of the table's first (header) row,
 * raw or already stripped.
 */
export function isLayoutTableHeader(firstRowCells: string[]): boolean {
  if (!Array.isArray(firstRowCells) || firstRowCells.length === 0) return false
  const cells = firstRowCells.map((c) => stripCellMarkdown(c).normalize('NFC'))
  const upper = cells.map((c) => c.toLocaleUpperCase('vi'))

  if (upper.some((c) => c.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA') || c.includes('CỘNG HOÀ XÃ HỘI CHỦ NGHĨA'))) {
    return true
  }
  if (upper.some((c) => c.startsWith('NƠI NHẬN'))) return true
  if (cells.length === 2) {
    // Signature titles are written in capitals; matching case-sensitively avoids
    // flagging data tables with e.g. a "Trưởng thôn" column.
    const titles = ['TM.', 'KT.', 'CHỦ TỊCH', 'GIÁM ĐỐC', 'TRƯỞNG']
    if (cells.some((c) => titles.some((t) => c.includes(t)))) return true
  }
  return false
}
