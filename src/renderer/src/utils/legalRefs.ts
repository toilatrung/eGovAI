/**
 * Detects citations of Vietnamese legal documents in free text, e.g.
 *   "Nghị định 30/2020/NĐ-CP", "Luật Cán bộ, công chức số 22/2008/QH12",
 *   "Thông tư 01/2011/TT-BNV", "Quyết định số 1234/QĐ-UBND".
 * Detection is purely syntactic — it says nothing about whether the document
 * exists or is still in force.
 */
export interface LegalReference {
  /** Document number as written, e.g. "30/2020/NĐ-CP" */
  number: string
  /** Document type, e.g. "Nghị định"; empty when it cannot be inferred */
  type: string
  /** Display label, e.g. "Nghị định 30/2020/NĐ-CP" */
  label: string
}

const TYPE_NAMES = [
  'Hiến pháp',
  'Bộ luật',
  'Luật',
  'Pháp lệnh',
  'Nghị quyết liên tịch',
  'Nghị quyết',
  'Nghị định',
  'Thông tư liên tịch',
  'Thông tư',
  'Quyết định',
  'Chỉ thị',
  'Công văn',
  'Kế hoạch',
  'Hướng dẫn',
  'Thông báo'
]

// Longest names first so "Thông tư liên tịch" wins over "Thông tư".
const TYPE_PATTERN = new RegExp(
  `(${[...TYPE_NAMES].sort((a, b) => b.length - a.length).join('|')})`,
  'giu'
)

// First code segment → type, used when no type word precedes the number.
const CODE_TYPES: Record<string, string> = {
  'NĐ': 'Nghị định',
  'ND': 'Nghị định',
  'TT': 'Thông tư',
  'TTLT': 'Thông tư liên tịch',
  'QĐ': 'Quyết định',
  'QD': 'Quyết định',
  'NQ': 'Nghị quyết',
  'NQLT': 'Nghị quyết liên tịch',
  'CT': 'Chỉ thị',
  'PL': 'Pháp lệnh',
  'KH': 'Kế hoạch',
  'HD': 'Hướng dẫn',
  'TB': 'Thông báo'
}

// Document types that commonly appear without a year ("1234/QĐ-UBND").
const NO_YEAR_PREFIXES = new Set([
  'NĐ', 'ND', 'QĐ', 'QD', 'NQ', 'CT', 'TT', 'TTLT', 'KH', 'HD', 'TB', 'CV', 'BC', 'TTr'
])

const L = 'A-Za-zĐđ'
const SEGMENT = `[A-ZĐ][${L}]{0,7}\\d{0,2}`
const NUMBER_RE = new RegExp(
  `(?<![${L}0-9/.-])(\\d{1,5}[a-z]?)\\/(?:(\\d{4})\\/)?(${SEGMENT}(?:-${SEGMENT}){0,3})(?![${L}0-9])`,
  'gu'
)

function typeFromCode(code: string): string {
  const first = code.split('-')[0]
  if (CODE_TYPES[first]) return CODE_TYPES[first]
  // Laws passed by the National Assembly: "45/2019/QH14"
  if (/^QH\d{0,2}$/.test(first)) return 'Luật'
  if (/^UBTVQH\d{0,2}$/.test(first)) return 'Nghị quyết'
  return ''
}

function typeFromContext(before: string): string {
  // Look back within the current clause only.
  const window = before.slice(-80).split(/[.;\n:()]/).pop() ?? ''
  let found = ''
  for (const m of window.matchAll(TYPE_PATTERN)) found = m[1]
  if (!found) return ''
  // Normalise capitalisation ("nghị định" → "Nghị định").
  const canonical = TYPE_NAMES.find((n) => n.toLowerCase() === found.toLowerCase())
  return canonical ?? found
}

export function extractLegalReferences(text: string, limit = 8): LegalReference[] {
  if (!text) return []
  const source = text.normalize('NFC')
  const results: LegalReference[] = []
  const seen = new Set<string>()
  let lastEnd = 0

  for (const m of source.matchAll(NUMBER_RE)) {
    const [whole, num, year, code] = m
    const contextStart = lastEnd
    lastEnd = m.index + whole.length
    const firstSeg = code.split('-')[0]
    if (!year && !NO_YEAR_PREFIXES.has(firstSeg)) continue
    // A code must contain at least two letters to avoid things like "3/A".
    if ((code.match(/[A-Za-zĐđ]/g) ?? []).length < 2) continue

    const number = year ? `${num}/${year}/${code}` : `${num}/${code}`
    const key = number.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)

    const type = typeFromContext(source.slice(contextStart, m.index)) || typeFromCode(code)
    results.push({ number, type, label: type ? `${type} ${number}` : number })
    if (results.length >= limit) break
  }
  return results
}

export function vbplSearchUrl(ref: LegalReference): string {
  return `https://vbpl.vn/pages/vbpq-timkiem.aspx?Keyword=${encodeURIComponent(ref.number)}`
}
