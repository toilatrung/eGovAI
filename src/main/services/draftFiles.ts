import { existsSync } from 'fs'
import { join } from 'path'

/** Thư mục mặc định trong dự án để lưu văn bản AI soạn (người dùng không cần chọn nơi lưu). */
export const DEFAULT_DRAFT_SUBFOLDER = 'Van-ban'

/**
 * Tên tệp Word dễ đọc từ tiêu đề văn bản: giữ tiếng Việt có dấu, bỏ ký tự Windows cấm.
 */
export function draftFileBaseName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim()
  return cleaned || 'Van ban'
}

function safeSubfolder(subfolder?: string): string {
  if (!subfolder) return DEFAULT_DRAFT_SUBFOLDER
  const parts = subfolder
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && !/^\.+$/.test(p))
    .map((p) => draftFileBaseName(p))
  return parts.length > 0 ? join(...parts) : DEFAULT_DRAFT_SUBFOLDER
}

/**
 * Đường dẫn .docx chưa tồn tại trong `<dự án>/<thư mục con>/`: thêm " (2)", " (3)"… nếu trùng tên.
 */
export function buildDraftDocxPath(
  projectDir: string,
  title: string,
  subfolder?: string,
  exists: (p: string) => boolean = existsSync
): string {
  const dir = join(projectDir, safeSubfolder(subfolder))
  const base = draftFileBaseName(title)
  let candidate = join(dir, `${base}.docx`)
  for (let n = 2; exists(candidate) && n < 1000; n++) {
    candidate = join(dir, `${base} (${n}).docx`)
  }
  return candidate
}
