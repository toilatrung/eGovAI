/**
 * Classified-document gate.
 *
 * Before a prompt (and its attachments) is sent to the AI core — which forwards
 * content to a cloud model — scan the attached files for Vietnamese state-secret
 * stamps ("MẬT", "TỐI MẬT", "TUYỆT MẬT", "Độ mật: ..."). Classified documents must
 * not be processed on internet-connected AI systems (Luật Bảo vệ bí mật nhà nước 2018).
 *
 * Detection looks for the STAMP form, not the words in running text:
 *  - a line/cell that consists only of the uppercase stamp word(s) ("MẬT", "TỐI MẬT", "**TUYỆT MẬT**", "[MẬT]")
 *  - "Độ mật: Mật | Tối mật | Tuyệt mật" (any case)
 *  - uppercase "TỐI MẬT"/"TUYỆT MẬT" as standalone words in the header area (first lines)
 * Body text such as "mật khẩu", "bí mật kinh doanh", "BẢO VỆ BÍ MẬT NHÀ NƯỚC" does not match.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { inflateRawSync, inflateSync } from 'zlib'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export type SecretLevel = 'MẬT' | 'TỐI MẬT' | 'TUYỆT MẬT'

export interface ClassificationHit {
  path: string
  name: string
  level: SecretLevel
  evidence: string
}

export interface ClassificationScanResult {
  blocked: boolean
  hits: ClassificationHit[]
  /** Files that could not be scanned (unsupported format, too large, unreadable). */
  unscanned: string[]
}

const MAX_FILE_BYTES = 60 * 1024 * 1024
const MAX_FOLDER_FILES = 200
const HEADER_LINES = 25

const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.xml', '.rtf'])
const DOCX_EXTS = new Set(['.docx', '.docm', '.dotx'])
const EXCEL_EXTS = new Set(['.xlsx', '.xlsm', '.xls'])
const SCANNABLE_EXTS = new Set([...TEXT_EXTS, ...DOCX_EXTS, ...EXCEL_EXTS, '.pdf'])

function levelOf(raw: string): SecretLevel {
  const up = raw.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()
  if (up.startsWith('TUYỆT')) return 'TUYỆT MẬT'
  if (up.startsWith('TỐI')) return 'TỐI MẬT'
  return 'MẬT'
}

const LEVEL_RANK: Record<SecretLevel, number> = { MẬT: 1, 'TỐI MẬT': 2, 'TUYỆT MẬT': 3 }

/** Strip decoration around a stamp line: markdown bold, quotes, brackets, punctuation. */
function stripDecoration(line: string): string {
  return line
    .replace(/[*_`#>|"'“”‘’«»()[\]{}<>]/g, ' ')
    .replace(/^[\s\-–—:.,;!]+|[\s\-–—:.,;!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const STANDALONE_STAMP = /^(TUYỆT MẬT|TỐI MẬT|MẬT)$/u
const DO_MAT = /(?:^|[^\p{L}])(?:độ|ĐỘ|Độ)\s+(?:mật|MẬT|Mật)\s*[:：\-–]\s*(tuyệt\s+mật|tối\s+mật|mật)(?![\p{L}])/iu
const HEADER_STRONG = /(?:^|[^\p{L}])(TUYỆT MẬT|TỐI MẬT)(?![\p{L}])/u

/**
 * Detect a classification stamp in extracted plain text.
 * Returns the highest level found, or null.
 */
export function detectSecretStamp(text: string): { level: SecretLevel; evidence: string } | null {
  if (!text) return null
  const lines = text.normalize('NFC').split(/\r?\n|\u000b|\f/)
  let best: { level: SecretLevel; evidence: string } | null = null
  const consider = (level: SecretLevel, evidence: string): void => {
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best.level]) {
      best = { level, evidence: evidence.trim().slice(0, 120) }
    }
  }

  let nonEmptySeen = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    nonEmptySeen++

    const stripped = stripDecoration(line)
    // Stamp must be written in uppercase (as a stamp is), e.g. "MẬT" alone on a line / in a cell.
    if (STANDALONE_STAMP.test(stripped)) {
      consider(levelOf(stripped), line)
      continue
    }

    const doMat = DO_MAT.exec(line)
    if (doMat) {
      consider(levelOf(doMat[1]), line)
      continue
    }

    if (nonEmptySeen <= HEADER_LINES) {
      const strong = HEADER_STRONG.exec(line)
      if (strong) consider(levelOf(strong[1]), line)
    }
  }
  return best
}

// ---------------- Minimal ZIP reader (for .docx parts incl. headers/text boxes) ----------------

export function readZipEntries(buf: Buffer, filter: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  // Find End Of Central Directory record.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Không phải tệp ZIP hợp lệ')
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen
    if (!filter(name)) continue
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const data = buf.subarray(start, start + compSize)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
  }
  return out
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
}

/** Paragraph-per-line text of a WordprocessingML part (document, header, footer, text boxes). */
export function wordXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/w:p>/)
  const lines: string[] = []
  for (const p of paragraphs) {
    const parts: string[] = []
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(p))) {
      if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]))
      else parts.push(m[0] === '<w:br/>' ? '\n' : ' ')
    }
    const text = parts.join('')
    if (text.trim()) lines.push(text)
  }
  return lines.join('\n')
}

async function extractDocxText(buf: Buffer): Promise<string> {
  try {
    const entries = readZipEntries(buf, (n) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)
    )
    // Headers first: stamps usually sit at the top of the page.
    const names = [...entries.keys()].sort((a, b) => {
      const rank = (x: string): number => (x.includes('header') ? 0 : x.includes('document') ? 1 : 2)
      return rank(a) - rank(b)
    })
    if (names.length > 0) {
      return names.map((n) => wordXmlToText(entries.get(n)!.toString('utf8'))).join('\n')
    }
  } catch {
    // fall back to mammoth
  }
  const res = await mammoth.extractRawText({ buffer: buf })
  return res.value
}

function extractExcelText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const lines: string[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
    for (const row of rows) {
      for (const cell of row) {
        const v = String(cell ?? '').trim()
        if (v) lines.push(v)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

/**
 * Best-effort PDF text: inflate Flate streams and pull literal strings from text operators.
 * PDFs with CID/Identity-H fonts (most Vietnamese PDFs) or scanned images cannot be read this way.
 */
export function extractPdfTextBestEffort(buf: Buffer): string {
  const chunks: string[] = []
  const raw = buf.toString('latin1')
  const streamRe = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    const data = buf.subarray(start, end)
    let content: string
    try {
      content = inflateSync(data).toString('latin1')
    } catch {
      content = data.toString('latin1')
    }
    const lineParts: string[] = []
    const opRe = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ|T\*|Td|TD|ET/g
    let op: RegExpExecArray | null
    while ((op = opRe.exec(content))) {
      const token = op[0]
      if (/^(T\*|Td|TD|ET)$/.test(token)) {
        lineParts.push('\n')
        continue
      }
      const strRe = /\(((?:\\.|[^\\)])*)\)/g
      let s: RegExpExecArray | null
      while ((s = strRe.exec(token))) {
        lineParts.push(s[1].replace(/\\([()\\])/g, '$1'))
      }
    }
    if (lineParts.length) {
      // Literal strings are usually UTF-16BE (with BOM) or PDFDocEncoding.
      chunks.push(
        lineParts
          .join('')
          .split('\n')
          .map((l) => {
            const bytes = Buffer.from(l, 'latin1')
            if (bytes[0] === 0xfe && bytes[1] === 0xff) {
              const body = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)))
              return body.swap16().toString('utf16le')
            }
            return Buffer.from(l, 'latin1').toString('utf8')
          })
          .join('\n')
      )
    }
    streamRe.lastIndex = end
  }
  return chunks.join('\n')
}

export async function extractTextForClassification(filePath: string): Promise<string | null> {
  const ext = extname(filePath).toLowerCase()
  if (!SCANNABLE_EXTS.has(ext)) return null
  const st = statSync(filePath)
  if (st.size > MAX_FILE_BYTES) return null
  const buf = readFileSync(filePath)
  if (DOCX_EXTS.has(ext)) return await extractDocxText(buf)
  if (EXCEL_EXTS.has(ext)) return extractExcelText(buf)
  if (ext === '.pdf') return extractPdfTextBestEffort(buf)
  return buf.toString('utf8').replace(/^﻿/, '')
}

function collectFolderFiles(dir: string, depth: number, acc: string[]): void {
  if (acc.length >= MAX_FOLDER_FILES || depth < 0) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (acc.length >= MAX_FOLDER_FILES) return
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (st.isDirectory()) collectFolderFiles(full, depth - 1, acc)
      else if (SCANNABLE_EXTS.has(extname(name).toLowerCase())) acc.push(full)
    } catch {
      // ignore
    }
  }
}

/** Scan attachment paths (files or folders) for classification stamps. */
export async function scanAttachmentsForClassification(
  paths: string[]
): Promise<ClassificationScanResult> {
  const hits: ClassificationHit[] = []
  const unscanned: string[] = []
  const files: string[] = []

  for (const p of paths) {
    if (!p || !existsSync(p)) continue
    try {
      if (statSync(p).isDirectory()) collectFolderFiles(p, 2, files)
      else files.push(p)
    } catch {
      unscanned.push(p)
    }
  }

  for (const file of files) {
    try {
      const text = await extractTextForClassification(file)
      if (text === null) {
        unscanned.push(file)
        continue
      }
      const stamp = detectSecretStamp(text)
      if (stamp) hits.push({ path: file, name: basename(file), ...stamp })
    } catch {
      unscanned.push(file)
    }
  }

  return { blocked: hits.length > 0, hits, unscanned }
}

export function formatClassificationBlockMessage(hits: ClassificationHit[]): string {
  const list = hits.map((h) => `• ${h.name} — độ mật “${h.level}”`).join('\n')
  return (
    'Đã chặn gửi: tệp đính kèm có dấu chỉ độ mật bí mật nhà nước.\n' +
    `${list}\n\n` +
    'Theo Luật Bảo vệ bí mật nhà nước năm 2018 và Nghị định 26/2020/NĐ-CP, không được soạn thảo, lưu giữ ' +
    'hoặc xử lý thông tin, tài liệu bí mật nhà nước trên thiết bị, hệ thống có kết nối Internet. ' +
    'Trợ lý AI này gửi nội dung đến dịch vụ AI trên đám mây nên không được dùng cho tài liệu mật. ' +
    'Vui lòng gỡ tệp này khỏi tin nhắn và xử lý tài liệu trên máy tính không kết nối mạng theo quy định. ' +
    'Nếu đây là nhận diện nhầm, hãy kiểm tra lại dấu độ mật trên văn bản hoặc liên hệ bộ phận bảo vệ bí mật nhà nước của cơ quan.'
  )
}
