import type { ToolCallBlock } from '../../../shared/types'

export const LIVE_DRAFT_TAB_ID = '__egovai_live_draft__'

const ADMIN_DOC_PATTERN =
  /(?:CỘNG\s+HÒA\s+XÃ\s+HỘI\s+CHỦ\s+NGHĨA\s+VIỆT\s+NAM|Độc\s+lập\s*[-–—]\s*Tự\s+do|\b(?:CÔNG\s+VĂN|TỜ\s+TRÌNH|BÁO\s+CÁO|QUYẾT\s+ĐỊNH|KẾ\s+HOẠCH|BIÊN\s+BẢN|THÔNG\s+BÁO|NGHỊ\s+QUYẾT|CHƯƠNG\s+TRÌNH)\b)/

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

/**
 * Nhận diện khi câu trả lời đang stream có dạng soạn thảo tài liệu/văn bản
 * để tự động hiển thị trực tiếp trong tab Tài liệu.
 */
export function looksLikeDocumentDraft(content: string, hasActiveSkill = false): boolean {
  const trimmed = content.trim()
  if (trimmed.length < 80) return false
  if (ADMIN_DOC_PATTERN.test(trimmed)) return true
  if (/^#{1,3}\s+\S/m.test(trimmed) && trimmed.length >= 160) return true
  if (hasActiveSkill && trimmed.length >= 140) return true
  if (trimmed.length >= 450 && trimmed.split(/\r?\n\s*\r?\n/).length >= 3) return true
  return false
}

export function deriveLiveDraftTitle(content: string, fallbackSkillTitle?: string): string {
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m)
  if (headingMatch?.[1]) {
    const clean = headingMatch[1].replace(/[*_`#]/g, '').trim()
    if (clean.length >= 3) {
      return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean
    }
  }

  const docTypeMatch = content.match(
    /\b(CÔNG VĂN|TỜ TRÌNH|BÁO CÁO|QUYẾT ĐỊNH|KẾ HOẠCH|BIÊN BẢN|THÔNG BÁO|NGHỊ QUYẾT|CHƯƠNG TRÌNH)\b[^\r\n]{0,40}/
  )
  if (docTypeMatch?.[0]) {
    const clean = docTypeMatch[0].replace(/[*_`]/g, '').trim()
    return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean
  }

  if (fallbackSkillTitle?.trim()) {
    const clean = fallbackSkillTitle.trim()
    return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean
  }

  return 'Bản nháp đang soạn'
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
