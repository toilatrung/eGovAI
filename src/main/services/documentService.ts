import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { DocKind, ExcelSheetData, OpenedDocument } from '../../shared/types'

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx'])
const JSON_EXTS = new Set(['.json'])
const DOCX_EXTS = new Set(['.docx'])
const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv'])
const PDF_EXTS = new Set(['.pdf'])
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}
const TEXT_EXTS = new Set([
  '.txt',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.ps1',
  '.cmd',
  '.bat',
  '.sh',
  '.ini',
  '.env',
  '.log'
])

export function detectDocKind(filePath: string): DocKind {
  const ext = extname(filePath).toLowerCase()
  if (DOCX_EXTS.has(ext)) return 'docx'
  if (EXCEL_EXTS.has(ext)) return 'excel'
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (ext in IMAGE_MIME) return 'image'
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (JSON_EXTS.has(ext)) return 'json'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'unknown'
}

export function normalizeSheetRows(rawRows: unknown[][]): string[][] {
  let maxCols = 0
  for (const row of rawRows) {
    if (Array.isArray(row) && row.length > maxCols) {
      maxCols = row.length
    }
  }
  const colCount = Math.max(maxCols, 6)
  const normalized: string[][] = rawRows.map((row) => {
    const out: string[] = []
    for (let i = 0; i < colCount; i++) {
      const val = Array.isArray(row) ? row[i] : ''
      out.push(val === null || val === undefined ? '' : String(val))
    }
    return out
  })
  if (normalized.length === 0) {
    normalized.push(Array(colCount).fill(''))
  }
  return normalized
}

export async function openDocumentFile(filePath: string): Promise<OpenedDocument> {
  if (!existsSync(filePath)) {
    throw new Error(`Không tìm thấy tệp: ${filePath}`)
  }

  const stat = statSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath)
  const kind = detectDocKind(filePath)

  if (kind === 'docx') {
    try {
      const buffer = readFileSync(filePath)
      const [htmlRes, rawRes] = await Promise.all([
        mammoth.convertToHtml({ buffer }),
        mammoth.extractRawText({ buffer })
      ])
      return {
        path: filePath,
        name,
        ext,
        kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        htmlPreview: htmlRes.value,
        docxPlainText: rawRes.value,
        warnings: htmlRes.messages.map((m) => m.message)
      }
    } catch (err) {
      return {
        path: filePath,
        name,
        ext,
        kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        parseError: `Không thể đọc nội dung tệp Word (${err instanceof Error ? err.message : String(err)}). Tệp có thể đang bị khóa bởi Microsoft Word, có mật khẩu hoặc là định dạng .doc cũ.`
      }
    }
  }

  if (kind === 'excel') {
    try {
      // Read buffer directly via Node fs so Vietnamese Unicode paths on Windows never fail
      const buffer = readFileSync(filePath)
      const workbook =
        ext === '.csv'
          ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
              type: 'string',
              cellDates: true
            })
          : XLSX.read(buffer, { type: 'buffer', cellDates: true })

      const sheets: ExcelSheetData[] = workbook.SheetNames.map((sheetName) => {
        const ws = workbook.Sheets[sheetName]
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: '',
          raw: false
        })
        return {
          name: sheetName,
          rows: normalizeSheetRows(raw)
        }
      })
      return {
        path: filePath,
        name,
        ext,
        kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        sheets: sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [Array(6).fill('')] }]
      }
    } catch (err) {
      return {
        path: filePath,
        name,
        ext,
        kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        parseError: `Không thể đọc bảng tính (${err instanceof Error ? err.message : String(err)}). Tệp có thể đang mở độc quyền trong Excel hoặc có mật khẩu bảo vệ.`
      }
    }
  }

  if (kind === 'pdf') {
    if (stat.size <= 25 * 1024 * 1024) {
      const b64 = readFileSync(filePath).toString('base64')
      return {
        path: filePath,
        name,
        ext,
        kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        dataUrl: `data:application/pdf;base64,${b64}`
      }
    }
    return {
      path: filePath,
      name,
      ext,
      kind,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      parseError: 'Tệp PDF lớn hơn 25MB — vui lòng mở bằng ứng dụng đọc PDF trên Windows.'
    }
  }

  if (kind === 'image') {
    const mime = IMAGE_MIME[ext] ?? 'image/png'
    const b64 = readFileSync(filePath).toString('base64')
    return {
      path: filePath,
      name,
      ext,
      kind,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      dataUrl: `data:${mime};base64,${b64}`
    }
  }

  if (kind === 'markdown' || kind === 'text' || kind === 'json') {
    const textContent = readFileSync(filePath, 'utf8')
    return {
      path: filePath,
      name,
      ext,
      kind,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      textContent
    }
  }

  if (stat.size < 512 * 1024) {
    try {
      const textContent = readFileSync(filePath, 'utf8')
      if (!textContent.includes('\u0000')) {
        return {
          path: filePath,
          name,
          ext,
          kind: 'text',
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          textContent
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    path: filePath,
    name,
    ext,
    kind: 'unknown',
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size
  }
}

export function saveTextDocumentFile(filePath: string, content: string): { mtimeMs: number } {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return { mtimeMs: statSync(filePath).mtimeMs }
}

export function saveExcelDocumentFile(
  filePath: string,
  sheets: ExcelSheetData[]
): { mtimeMs: number } {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const cleanRows = sheet.rows.map((r) => [...r])
    const ws = XLSX.utils.aoa_to_sheet(cleanRows)
    const safeName = (sheet.name || 'Sheet1').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }

  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') {
    const firstSheet = wb.Sheets[wb.SheetNames[0]]
    const csv = XLSX.utils.sheet_to_csv(firstSheet)
    writeFileSync(filePath, '\uFEFF' + csv, 'utf8')
  } else {
    // Write buffer directly via Node fs so Unicode paths on Windows never fail
    const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    writeFileSync(filePath, outBuffer)
  }

  return { mtimeMs: statSync(filePath).mtimeMs }
}

function parseInlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({
          text: text.slice(lastIndex, match.index),
          font: 'Times New Roman',
          size: 28
        })
      )
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(
        new TextRun({
          text: token.slice(2, -2),
          bold: true,
          font: 'Times New Roman',
          size: 28
        })
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          italics: true,
          font: 'Times New Roman',
          size: 28
        })
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          font: 'Consolas',
          size: 24
        })
      )
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        font: 'Times New Roman',
        size: 28
      })
    )
  }

  return runs.length > 0 ? runs : [new TextRun({ text: '', font: 'Times New Roman', size: 28 })]
}

/** Document-properties label for AI-assisted drafts exported by the app. */
export const AI_DRAFT_MARK = 'Dự thảo – có sự hỗ trợ của AI (eGovAI)'

export async function exportMarkdownToDocx(
  targetDocxPath: string,
  markdownText: string
): Promise<{ path: string; mtimeMs: number }> {
  const lines = markdownText.split(/\r?\n/)
  const children: (Paragraph | Table)[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim()
      if (/^\|[\s:|-]+\|$/.test(nextTrimmed)) {
        const tableLines: string[] = [trimmed]
        i += 2
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i].trim())
          i++
        }
        const rows = tableLines.map((rowStr, rowIdx) => {
          const cells = rowStr
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
          return new TableRow({
            children: cells.map(
              (cellText) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cellText,
                          bold: rowIdx === 0,
                          font: 'Times New Roman',
                          size: 26
                        })
                      ]
                    })
                  ],
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: '475569' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: '475569' },
                    left: { style: BorderStyle.SINGLE, size: 4, color: '475569' },
                    right: { style: BorderStyle.SINGLE, size: 4, color: '475569' }
                  }
                })
            )
          })
        })
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          })
        )
        children.push(new Paragraph({ text: '' }))
        continue
      }
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      children.push(
        new Paragraph({
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 160, after: 100 },
          children: [
            new TextRun({
              text,
              bold: true,
              font: 'Times New Roman',
              size: level === 1 ? 30 : 28
            })
          ]
        })
      )
      i++
      continue
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/)
    if (bulletMatch) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80, line: 276 },
          children: parseInlineRuns(bulletMatch[1])
        })
      )
      i++
      continue
    }

    children.push(
      new Paragraph({
        spacing: { after: 120, line: 276 },
        alignment: AlignmentType.JUSTIFIED,
        children: parseInlineRuns(trimmed)
      })
    )
    i++
  }

  const doc = new Document({
    // Metadata only (File > Info > Properties): marks the file as an AI-assisted draft
    // without changing the visible NĐ 30/2020 body formatting.
    creator: AI_DRAFT_MARK,
    lastModifiedBy: 'eGovAI',
    description: AI_DRAFT_MARK,
    keywords: `${AI_DRAFT_MARK}; eGovAI; AI-assisted draft`,
    subject: 'Dự thảo văn bản',
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838
            },
            margin: {
              top: 1134,
              bottom: 1134,
              left: 1701,
              right: 851
            }
          }
        },
        children
      }
    ]
  })

  const dir = dirname(targetDocxPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const buf = await Packer.toBuffer(doc)
  writeFileSync(targetDocxPath, buf)
  return { path: targetDocxPath, mtimeMs: statSync(targetDocxPath).mtimeMs }
}

export async function createBlankDocument(
  dirPath: string,
  fileName: string,
  kind: 'markdown' | 'docx' | 'excel'
): Promise<string> {
  const cleanName = fileName.trim().replace(/[<>:"/\\|?*]+/g, '-')
  if (!cleanName) throw new Error('Tên tệp không hợp lệ.')

  if (kind === 'markdown') {
    const finalName = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`
    const target = join(dirPath, finalName)
    const template = `# ${cleanName.replace(/\.md$/i, '')}\n\nNgày lập: ${new Date().toLocaleDateString('vi-VN')}\n\n## 1. Nội dung chính\n\n- \n`
    saveTextDocumentFile(target, template)
    return target
  }

  if (kind === 'docx') {
    const finalName = cleanName.endsWith('.docx') ? cleanName : `${cleanName}.docx`
    const target = join(dirPath, finalName)
    const template = `# ${cleanName.replace(/\.docx$/i, '').toUpperCase()}\n\nỦY BAN NHÂN DÂN XÃ THIỆU TOÁN\n\n## I. Nội dung\n\nNhập nội dung văn bản tại đây.\n`
    await exportMarkdownToDocx(target, template)
    return target
  }

  const finalName = cleanName.endsWith('.xlsx') ? cleanName : `${cleanName}.xlsx`
  const target = join(dirPath, finalName)
  saveExcelDocumentFile(target, [
    {
      name: 'Bảng tổng hợp',
      rows: [
        ['STT', 'Nội dung / Chỉ tiêu', 'Đơn vị tính', 'Số lượng', 'Ghi chú'],
        ['1', '', '', '', ''],
        ['2', '', '', '', '']
      ]
    }
  ])
  return target
}
