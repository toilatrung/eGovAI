import type { ToolCallBlock } from '../../../shared/types'

export const LIVE_DRAFT_TAB_ID = '__egovai_live_draft__'

const VIEWABLE_DOC_EXTS = new Set(['.md', '.markdown', '.txt', '.docx', '.xlsx', '.xls', '.csv', '.json', '.pdf'])

const FILE_WRITE_TOOLS = new Set([
  'write_file',
  'write_to_file',
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
  'create_file',
  'save_file'
])

const DOC_SIGNALS: RegExp[] = [
  /CỘNG\s+HÒA\s+XÃ\s+HỘI\s+CHỦ\s+NGHĨA\s+VIỆT\s+NAM/i,
  /Độc\s+lập\s*[-–—]\s*Tự\s+do\s*[-–—]\s*Hạnh\s+phúc/i,
  /(^|\n|\|)\s*\**\s*Kính\s+gửi\s*:/i,
  /(^|\n|\|)\s*\**\s*Nơi\s+nhận\s*:/i,
  /\bV\/v\s+\S/,
  /(^|\n|\|)\s*\**\s*Số\s*:\s*[.…\d\s]*\/[A-ZĐ]/
]

/**
 * Nhận diện câu trả lời KHÔNG dùng khối egov-doc nhưng thực chất là văn bản hành chính,
 * để vẫn hiển thị ở tab Tài liệu. Cố ý chặt: cần ít nhất 2 dấu hiệu thể thức (Quốc hiệu,
 * Tiêu ngữ, Kính gửi, Nơi nhận, V/v, Số ký hiệu), hoặc 1 dấu hiệu khi người dùng đã chọn
 * kỹ năng soạn thảo. Câu trả lời tra cứu dài có tiêu đề/đánh số KHÔNG bị coi là văn bản.
 */
export function looksLikeDocumentDraft(content: string, hasActiveSkill = false): boolean {
  const trimmed = content.trim()
  if (trimmed.length < 80) return false
  const hits = DOC_SIGNALS.filter((re) => re.test(trimmed)).length
  return hits >= 2 || (hasActiveSkill && hits >= 1)
}

const DOC_TYPES: Array<[RegExp, string]> = [
  [/^CÔNG\s+VĂN$/, 'Công văn'],
  [/^TỜ\s+TRÌNH$/, 'Tờ trình'],
  [/^BÁO\s+CÁO$/, 'Báo cáo'],
  [/^QUYẾT\s+ĐỊNH$/, 'Quyết định'],
  [/^KẾ\s+HOẠCH$/, 'Kế hoạch'],
  [/^BIÊN\s+BẢN$/, 'Biên bản'],
  [/^THÔNG\s+BÁO$/, 'Thông báo'],
  [/^NGHỊ\s+QUYẾT$/, 'Nghị quyết'],
  [/^CHƯƠNG\s+TRÌNH$/, 'Chương trình'],
  [/^GIẤY\s+MỜI$/, 'Giấy mời'],
  [/^PHƯƠNG\s+ÁN$/, 'Phương án']
]

/** Tiêu đề phụ không bao giờ là tên văn bản. */
const SKIP_TITLE_RE =
  /^(các\s+thông\s+tin|thông\s+tin\s+còn\s+thiếu|lưu\s+ý|ghi\s+chú|một\s+số\s+lưu\s+ý|nguồn|tài\s+liệu\s+tham\s+khảo|hướng\s+dẫn)/i
const NUMBERED_RE = /^([0-9]+|[IVXLC]+|[a-zđ])[.)]\s/i

function cleanInline(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[*_`#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * Đặt tên bản nháp theo loại văn bản và trích yếu ("Báo cáo – Kết quả giảm nghèo 2026"),
 * bỏ qua tiêu đề phụ như "Các thông tin còn thiếu…" hay mục đánh số "1. …".
 */
export function deriveLiveDraftTitle(content: string, fallbackSkillTitle?: string): string {
  const lines = content.split(/\r?\n/)

  // 1) Tiêu đề bắt đầu bằng loại văn bản: "# BÁO CÁO KẾT QUẢ …"
  for (const raw of lines) {
    const m = raw.match(/^#{1,3}\s+(.+)$/)
    if (!m) continue
    const text = cleanInline(m[1])
    if (
      DOC_TYPES.some(
        ([, label]) =>
          text.toUpperCase().startsWith(label.toUpperCase()) && text.length > label.length + 2
      )
    ) {
      return clip(text)
    }
  }

  // 2) Dòng chỉ có loại văn bản ("BÁO CÁO") + dòng trích yếu kế tiếp
  for (let i = 0; i < lines.length; i++) {
    const text = cleanInline(lines[i].replace(/^#{1,6}\s+/, ''))
    const type = DOC_TYPES.find(([re]) => re.test(text))
    if (!type) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const next = cleanInline(lines[j].replace(/^#{1,6}\s+/, ''))
      if (next) return clip(`${type[1]} – ${next.replace(/^V\/v\s+/i, '')}`)
    }
    return type[1]
  }

  // 3) Có trích yếu "V/v …" → công văn
  for (const raw of lines) {
    const m = cleanInline(raw).match(/\bV\/v\s+(.+)$/)
    if (m) return clip(`Công văn – V/v ${m[1]}`)
  }

  // 4) Tiêu đề đầu tiên không phải tiêu đề phụ / mục đánh số
  for (const raw of lines) {
    const m = raw.match(/^#{1,3}\s+(.+)$/)
    if (!m) continue
    const text = cleanInline(m[1])
    if (text.length >= 3 && !SKIP_TITLE_RE.test(text) && !NUMBERED_RE.test(text)) return clip(text)
  }

  if (fallbackSkillTitle?.trim()) return clip(fallbackSkillTitle.trim())
  return 'Bản nháp văn bản'
}

export function countVietnameseWords(text: string): number {
  const cleaned = text.trim()
  if (!cleaned) return 0
  return cleaned.split(/\s+/).filter(Boolean).length
}

function getLowerExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

export interface WrittenToolFile {
  filePath: string
  content?: string
}

/**
 * Trích xuất đường dẫn tệp tài liệu mà AI đang tạo/chỉnh sửa qua công cụ file.
 */
export function extractWrittenFileFromToolCall(toolCall: ToolCallBlock): WrittenToolFile | null {
  const normalizedTool = toolCall.toolName.toLowerCase().split('/').pop() ?? ''
  if (!FILE_WRITE_TOOLS.has(normalizedTool)) return null
  const params = toolCall.parameters
  if (!params || typeof params !== 'object') return null

  const rawPath =
    params.Path ??
    params.TargetFile ??
    params.path ??
    params.file_path ??
    params.filePath
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null

  const filePath = rawPath.trim()
  const ext = getLowerExtension(filePath)
  if (!VIEWABLE_DOC_EXTS.has(ext)) return null

  const rawContent = params.Content ?? params.CodeContent ?? params.content
  return {
    filePath,
    content: typeof rawContent === 'string' && rawContent.length > 0 ? rawContent : undefined
  }
}
