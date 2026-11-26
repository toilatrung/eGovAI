/**
 * Markdown → Word (.docx) exporter for AI-drafted Vietnamese administrative documents.
 * Formatting follows Nghị định 30/2020/NĐ-CP: A4, Times New Roman 14pt, black headings,
 * borderless layout tables for the Quốc hiệu header block and the signature block.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type {
  Blockquote,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable
} from 'mdast'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType
} from 'docx'
import type { ILevelsOptions, INumberingOptions } from 'docx'
import {
  isLayoutTableHeader,
  normalizeDraftMarkdown,
  splitPlaceholders,
  stripCellMarkdown
} from '../../../shared/draftMarkdown'

/** Document-properties label for AI-assisted drafts exported by the app. */
export const AI_DRAFT_MARK = 'Dự thảo – có sự hỗ trợ của AI (eGovAI)'

const FONT = 'Times New Roman'
const BODY_SIZE = 28 // 14pt
const TABLE_SIZE = 26 // 13pt
const LINE = 276 // 1.15 line spacing
const FIRST_LINE_INDENT = 567 // 1 cm
const PAGE_WIDTH = 11906
const MARGIN = { top: 1134, bottom: 1134, left: 1701, right: 851 }
const TEXT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right // 9354 twips

type Align = (typeof AlignmentType)[keyof typeof AlignmentType]
type Block = Paragraph | Table

// ------------------------------------------------------------------ inline flattening

interface TextSeg {
  kind: 'text'
  text: string
  bold: boolean
  italics: boolean
}
interface BreakSeg {
  kind: 'break'
}
type Seg = TextSeg | BreakSeg

interface InlineStyle {
  bold: boolean
  italics: boolean
}

const BR_ONLY = /^<br\s*\/?>$/i

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, '&')
}

function flatten(nodes: readonly PhrasingContent[], style: InlineStyle, out: Seg[] = []): Seg[] {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        // Soft line breaks inside a paragraph render as spaces (as in the preview).
        out.push({ kind: 'text', text: node.value.replace(/[ \t]*\n[ \t]*/g, ' '), ...style })
        break
      case 'inlineCode':
        out.push({ kind: 'text', text: node.value, ...style })
        break
      case 'strong':
        flatten(node.children, { ...style, bold: true }, out)
        break
      case 'emphasis':
        flatten(node.children, { ...style, italics: true }, out)
        break
      case 'delete':
      case 'link':
      case 'linkReference':
        flatten(node.children, style, out)
        break
      case 'break':
        out.push({ kind: 'break' })
        break
      case 'html': {
        const parts = node.value.split(/(<br\s*\/?>)/i)
        for (const part of parts) {
          if (!part) continue
          if (BR_ONLY.test(part)) out.push({ kind: 'break' })
          else {
            const text = stripHtml(part)
            if (text) out.push({ kind: 'text', text, ...style })
          }
        }
        break
      }
      case 'image':
      case 'imageReference':
        if (node.alt) out.push({ kind: 'text', text: node.alt, ...style })
        break
      default:
        // footnoteReference and anything unknown: drop markers, keep any text children
        if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
          flatten((node as { children: PhrasingContent[] }).children, style, out)
        }
    }
  }
  return out
}

function segsText(segs: Seg[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : '\n')).join('')
}

/** Splits flattened segments into lines at hard breaks. */
function splitLines(segs: Seg[]): TextSeg[][] {
  const lines: TextSeg[][] = [[]]
  for (const s of segs) {
    if (s.kind === 'break') lines.push([])
    else lines[lines.length - 1].push(s)
  }
  return lines
}

interface RunOptions {
  size: number
  bold?: boolean // force bold
  italics?: boolean // force italics
}

function textRuns(segs: Seg[], opts: RunOptions): TextRun[] {
  const runs: TextRun[] = []
  let pendingBreak = 0
  for (const s of segs) {
    if (s.kind === 'break') {
      pendingBreak++
      continue
    }
    for (const part of splitPlaceholders(s.text)) {
      if (!part.text) continue
      runs.push(
        new TextRun({
          text: part.text,
          font: FONT,
          size: opts.size,
          color: '000000',
          bold: opts.bold || s.bold || undefined,
          italics: opts.italics || s.italics || undefined,
          highlight: part.placeholder ? 'yellow' : undefined,
          break: pendingBreak || undefined
        })
      )
      pendingBreak = 0
    }
  }
  // Breaks with no text after them (e.g. signing space before an empty line).
  for (let i = 0; i < pendingBreak; i++) runs.push(new TextRun({ break: 1, font: FONT, size: opts.size }))
  return runs
}

function trimSegs(segs: TextSeg[]): TextSeg[] {
  const copy = segs.map((s) => ({ ...s }))
  while (copy.length && !copy[0].text.trim()) copy.shift()
  while (copy.length && !copy[copy.length - 1].text.trim()) copy.pop()
  if (copy.length) {
    copy[0].text = copy[0].text.replace(/^\s+/, '')
    copy[copy.length - 1].text = copy[copy.length - 1].text.replace(/\s+$/, '')
  }
  return copy
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '')
  return letters.length > 1 && letters === letters.toLocaleUpperCase('vi')
}

// ------------------------------------------------------------------ numbering

class NumberingRegistry {
  private configs: INumberingOptions['config'][number][] = []
  private counter = 0
  readonly bulletRef = 'egov-bullet'

  constructor() {
    const bullets = ['-', '+', '•', '-', '+', '•', '-', '+', '•']
    this.configs.push({
      reference: this.bulletRef,
      levels: bullets.map(
        (text, level): ILevelsOptions => ({
          level,
          format: LevelFormat.BULLET,
          text,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: FIRST_LINE_INDENT + 284 + level * 567, hanging: 284 } },
            run: { font: FONT }
          }
        })
      )
    })
  }

  /** Each ordered list gets its own definition so numbering restarts and honours `start`. */
  ordered(depth: number, start: number): string {
    const reference = `egov-ordered-${++this.counter}`
    const formats: Array<[ILevelsOptions['format'], string]> = [
      [LevelFormat.DECIMAL, '%1.'],
      [LevelFormat.LOWER_LETTER, '%2)'],
      [LevelFormat.LOWER_ROMAN, '%3.'],
      [LevelFormat.DECIMAL, '%4.'],
      [LevelFormat.LOWER_LETTER, '%5)'],
      [LevelFormat.LOWER_ROMAN, '%6.'],
      [LevelFormat.DECIMAL, '%7.'],
      [LevelFormat.LOWER_LETTER, '%8)'],
      [LevelFormat.LOWER_ROMAN, '%9.']
    ]
    this.configs.push({
      reference,
      levels: formats.map(
        ([format, text], level): ILevelsOptions => ({
          level,
          format,
          text,
          start: level === depth ? Math.max(0, start) : 1,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: FIRST_LINE_INDENT + 425 + level * 567, hanging: 425 } },
            run: { font: FONT }
          }
        })
      )
    })
    return reference
  }

  get all(): INumberingOptions['config'] {
    return this.configs
  }
}

// ------------------------------------------------------------------ blocks

interface BlockCtx {
  numbering: NumberingRegistry
  italics: boolean
  indentLeft: number
}

function bodyParagraph(segs: Seg[], ctx: BlockCtx): Paragraph | null {
  if (!segsText(segs).trim()) return null
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: ctx.indentLeft ? { left: ctx.indentLeft } : { firstLine: FIRST_LINE_INDENT },
    spacing: { after: 120, line: LINE },
    children: textRuns(segs, { size: BODY_SIZE, italics: ctx.italics })
  })
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
]

function convertList(list: List, depth: number, ctx: BlockCtx): Block[] {
  const out: Block[] = []
  const ordered = Boolean(list.ordered)
  const reference = ordered ? ctx.numbering.ordered(Math.min(depth, 8), list.start ?? 1) : ctx.numbering.bulletRef
  const level = Math.min(depth, 8)
  const textIndent = FIRST_LINE_INDENT + (ordered ? 425 : 284) + level * 567

  for (const item of list.children as ListItem[]) {
    let first = true
    for (const child of item.children) {
      if (child.type === 'list') {
        out.push(...convertList(child, depth + 1, ctx))
        continue
      }
      if (child.type === 'paragraph') {
        let segs = flatten(child.children, { bold: false, italics: false })
        if (first && typeof item.checked === 'boolean') {
          segs = [{ kind: 'text', text: item.checked ? '☑ ' : '☐ ', bold: false, italics: false }, ...segs]
        }
        if (!segsText(segs).trim()) continue
        out.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            ...(first ? { numbering: { reference, level } } : { indent: { left: textIndent } }),
            spacing: { after: 60, line: LINE },
            children: textRuns(segs, { size: BODY_SIZE, italics: ctx.italics })
          })
        )
        first = false
        continue
      }
      out.push(...convertBlock(child, { ...ctx, indentLeft: textIndent }))
      first = false
    }
  }
  return out
}

function convertBlockquote(node: Blockquote, ctx: BlockCtx): Block[] {
  const inner: BlockCtx = { ...ctx, italics: true, indentLeft: (ctx.indentLeft || 0) + FIRST_LINE_INDENT }
  return node.children.flatMap((c) => convertBlock(c, inner))
}

function convertBlock(node: RootContent, ctx: BlockCtx): Block[] {
  switch (node.type) {
    case 'heading': {
      const segs = flatten(node.children, { bold: true, italics: false })
      const text = segsText(segs).trim()
      if (!text) return []
      const depth = Math.min(Math.max(node.depth, 1), 6)
      // Tiêu đề cấp 1–2 trong văn bản hành chính là tên loại văn bản + trích yếu: luôn căn giữa.
      const centered = depth <= 2 || isAllCaps(text)
      return [
        new Paragraph({
          heading: HEADINGS[depth - 1],
          alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: centered ? undefined : { firstLine: depth >= 3 ? FIRST_LINE_INDENT : 0 },
          spacing: { before: 120, after: 120, line: LINE },
          keepNext: true,
          children: textRuns(segs, { size: BODY_SIZE, bold: true, italics: depth >= 5 || undefined })
        })
      ]
    }
    case 'paragraph': {
      const p = bodyParagraph(flatten(node.children, { bold: false, italics: false }), ctx)
      return p ? [p] : []
    }
    case 'list':
      return convertList(node, 0, ctx)
    case 'blockquote':
      return convertBlockquote(node, ctx)
    case 'thematicBreak':
    case 'definition':
    case 'yaml' as RootContent['type']:
      return []
    case 'code':
      return node.value.split('\n').map(
        (line) =>
          new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { left: ctx.indentLeft || 0 },
            spacing: { after: 0, line: LINE },
            children: textRuns([{ kind: 'text', text: line, bold: false, italics: false }], {
              size: BODY_SIZE
            })
          })
      )
    case 'html': {
      const segs = flatten([{ type: 'html', value: node.value }], { bold: false, italics: false })
      const p = bodyParagraph(segs, ctx)
      return p ? [p] : []
    }
    case 'table':
      return convertTable(node)
    case 'footnoteDefinition':
      return node.children.flatMap((c) => convertBlock(c, ctx))
    default:
      return []
  }
}

// ------------------------------------------------------------------ tables

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const CELL_NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
const LINE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const CELL_BORDERS = { top: LINE_BORDER, bottom: LINE_BORDER, left: LINE_BORDER, right: LINE_BORDER }

function cellSegs(cell: MdTable['children'][number]['children'][number]): Seg[] {
  return flatten(cell.children, { bold: false, italics: false })
}

function columnCount(table: MdTable): number {
  return Math.max(1, ...table.children.map((r) => r.children.length))
}

function cellParagraph(
  segs: Seg[],
  alignment: Align,
  size: number,
  extra: { bold?: boolean; italics?: boolean; after?: number } = {}
): Paragraph {
  return new Paragraph({
    alignment,
    spacing: { before: 0, after: extra.after ?? 0, line: 240 },
    children: textRuns(segs, { size, bold: extra.bold, italics: extra.italics })
  })
}

function layoutTable(table: MdTable): Table {
  const cols = columnCount(table)
  const colWidth = Math.floor(TEXT_WIDTH / cols)
  const firstRow = table.children[0]?.children.map((c) => stripCellMarkdown(segsText(cellSegs(c)))) ?? []
  const isMotto = firstRow.some((c) => /CỘNG HO?[ÒÀ]A?\s*XÃ HỘI/i.test(c.toLocaleUpperCase('vi')))

  const rows = table.children.map((row, rowIdx) => {
    const cells: TableCell[] = []
    for (let col = 0; col < cols; col++) {
      const mdCell = row.children[col]
      const lines = mdCell ? splitLines(cellSegs(mdCell)) : [[]]
      const paragraphs: Paragraph[] = []
      lines.forEach((rawLine) => {
        const line = trimSegs(rawLine)
        const text = line.map((s) => s.text).join('')
        if (isMotto) {
          // Quốc hiệu block: left = agency/number/trích yếu (13pt), right = Quốc hiệu, tiêu ngữ, địa danh.
          const size = col === 0 || rowIdx === 0 ? TABLE_SIZE : BODY_SIZE
          paragraphs.push(cellParagraph(line, AlignmentType.CENTER, size))
          return
        }
        // Signature block
        if (col === 0) {
          const isLabel = /^nơi nhận/i.test(text.trim())
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 0, after: 0, line: 240 },
              children: isLabel
                ? textRuns(line, { size: 24, bold: true, italics: true })
                : textRuns(line, { size: 22 })
            })
          )
        } else {
          paragraphs.push(cellParagraph(line, AlignmentType.CENTER, BODY_SIZE, { bold: isAllCaps(text) }))
        }
      })
      if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [] }))
      cells.push(
        new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          borders: CELL_NO_BORDERS,
          children: paragraphs
        })
      )
    }
    return new TableRow({ children: cells, cantSplit: true })
  })

  return new Table({
    width: { size: colWidth * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colWidth),
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
    rows
  })
}

function dataColumnWidths(table: MdTable, cols: number): number[] {
  const weights = Array.from({ length: cols }, (_, col) => {
    let max = 0
    for (const row of table.children) {
      const cell = row.children[col]
      if (!cell) continue
      const lines = segsText(cellSegs(cell)).split('\n')
      for (const l of lines) max = Math.max(max, l.trim().length)
    }
    return Math.min(Math.max(max, 3), 40)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  const min = Math.min(567, Math.floor(TEXT_WIDTH / cols))
  let widths = weights.map((w) => Math.max(min, Math.round((TEXT_WIDTH * w) / total)))
  const sum = widths.reduce((a, b) => a + b, 0)
  widths = widths.map((w) => Math.floor((w * TEXT_WIDTH) / sum))
  return widths
}

function dataTable(table: MdTable): Table {
  const cols = columnCount(table)
  const widths = dataColumnWidths(table, cols)
  const aligns = table.align ?? []
  const toAlign = (a: string | null | undefined, header: boolean): Align =>
    header || a === 'center'
      ? AlignmentType.CENTER
      : a === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT

  const rows = table.children.map((row, rowIdx) => {
    const header = rowIdx === 0
    const cells: TableCell[] = []
    for (let col = 0; col < cols; col++) {
      const mdCell = row.children[col]
      const segs = mdCell ? cellSegs(mdCell) : []
      const text = segsText(segs).trim()
      const numeric = /^[\d.,%\s+-]+$/.test(text) && /\d/.test(text)
      const align = numeric && !header && !aligns[col] ? AlignmentType.CENTER : toAlign(aligns[col], header)
      const lines = splitLines(segs).map(trimSegs)
      cells.push(
        new TableCell({
          width: { size: widths[col], type: WidthType.DXA },
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlignTable.CENTER,
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: lines.map((line) => cellParagraph(line, align, TABLE_SIZE, { bold: header }))
        })
      )
    }
    return new TableRow({ children: cells, tableHeader: header })
  })

  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: LINE_BORDER,
      bottom: LINE_BORDER,
      left: LINE_BORDER,
      right: LINE_BORDER,
      insideHorizontal: LINE_BORDER,
      insideVertical: LINE_BORDER
    },
    rows
  })
}

function convertTable(table: MdTable): Block[] {
  if (!table.children.length) return []
  const headerCells = table.children[0].children.map((c) => segsText(cellSegs(c)).replace(/\n/g, '<br>'))
  const built = isLayoutTableHeader(headerCells) ? layoutTable(table) : dataTable(table)
  return [built, new Paragraph({ spacing: { after: 120 }, children: [] })]
}

// ------------------------------------------------------------------ public API

const processor = unified().use(remarkParse).use(remarkGfm)

/** Parses (normalized) draft Markdown into docx body blocks. */
export function markdownToDocxBlocks(markdownText: string): {
  children: Block[]
  numbering: INumberingOptions['config']
} {
  const md = normalizeDraftMarkdown(markdownText)
  const tree = processor.parse(md) as Root
  const numbering = new NumberingRegistry()
  const ctx: BlockCtx = { numbering, italics: false, indentLeft: 0 }
  const children = tree.children.flatMap((node) => convertBlock(node, ctx))
  return { children, numbering: numbering.all }
}

function headingStyle(size = BODY_SIZE) {
  return {
    run: { font: FONT, size, bold: true, color: '000000' },
    paragraph: { spacing: { before: 120, after: 120 } }
  }
}

export async function exportMarkdownToDocx(
  targetDocxPath: string,
  markdownText: string
): Promise<{ path: string; mtimeMs: number }> {
  const { children, numbering } = markdownToDocxBlocks(markdownText)

  const doc = new Document({
    // Metadata only (File > Info > Properties): marks the file as an AI-assisted draft
    // without changing the visible NĐ 30/2020 body formatting.
    creator: AI_DRAFT_MARK,
    lastModifiedBy: 'eGovAI',
    description: AI_DRAFT_MARK,
    keywords: `${AI_DRAFT_MARK}; eGovAI; AI-assisted draft`,
    subject: 'Dự thảo văn bản',
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE, color: '000000' } },
        title: headingStyle(),
        heading1: headingStyle(),
        heading2: headingStyle(),
        heading3: headingStyle(),
        heading4: headingStyle(),
        heading5: headingStyle(),
        heading6: headingStyle(),
        listParagraph: { run: { font: FONT, size: BODY_SIZE, color: '000000' } },
        hyperlink: { run: { color: '000000' } }
      }
    },
    numbering: { config: numbering },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: 16838 },
            margin: MARGIN
          }
        },
        children: children.length ? children : [new Paragraph({ children: [] })]
      }
    ]
  })

  const dir = dirname(targetDocxPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const buf = await Packer.toBuffer(doc)
  writeFileSync(targetDocxPath, buf)
  return { path: targetDocxPath, mtimeMs: statSync(targetDocxPath).mtimeMs }
}
