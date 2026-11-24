import { extname } from 'path'

/**
 * Extensions that `workspace:openPath` may hand to the OS default application.
 * Anything else (.exe, .bat, .cmd, .lnk, .ps1, .vbs, .js, .msi, .hta, .url, ...) could run code,
 * so it is refused. Directories are always allowed (they open in Explorer).
 */
export const OPEN_PATH_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.csv',
  '.pdf',
  '.md',
  '.txt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp'
])

export type OpenPathCheck = { allowed: true } | { allowed: false; error: string }

/**
 * Pure check: may `targetPath` be opened with the OS default app?
 * `isDirectory` comes from a real fs.stat by the caller (undefined = path does not exist).
 */
export function checkOpenPathAllowed(
  targetPath: unknown,
  isDirectory: boolean | undefined
): OpenPathCheck {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return { allowed: false, error: 'Đường dẫn không hợp lệ.' }
  }
  if (targetPath.includes('\0')) {
    return { allowed: false, error: 'Đường dẫn không hợp lệ.' }
  }
  // Only local/UNC filesystem paths — no URLs or protocol handlers (file:, ms-*:, search-ms:, ...).
  // A ':' is only allowed as the drive-letter separator (blocks NTFS alternate data streams too).
  const withoutDrive = /^[a-zA-Z]:[\\/]/.test(targetPath) ? targetPath.slice(2) : targetPath
  if (withoutDrive.includes(':')) {
    return { allowed: false, error: 'Chỉ mở được tệp hoặc thư mục trên máy, không mở liên kết/giao thức.' }
  }
  if (isDirectory === undefined) {
    return { allowed: false, error: `Không tìm thấy tệp hoặc thư mục: ${targetPath}` }
  }
  if (isDirectory) {
    return { allowed: true }
  }
  // Windows ignores trailing dots/spaces in file names ("a.bat." runs a.bat), so strip them first.
  const ext = extname(targetPath.replace(/[. ]+$/, '')).toLowerCase()
  if (OPEN_PATH_ALLOWED_EXTENSIONS.has(ext)) {
    return { allowed: true }
  }
  const shown = ext || '(không có phần mở rộng)'
  return {
    allowed: false,
    error:
      `Vì lý do an toàn, eGovAI không mở trực tiếp tệp loại ${shown}. ` +
      'Chỉ mở được thư mục và tài liệu văn phòng/hình ảnh ' +
      '(.docx, .doc, .xlsx, .xls, .csv, .pdf, .md, .txt, .pptx, .png, .jpg, .jpeg, .gif, .webp). ' +
      'Nếu cần, hãy dùng "Hiện trong thư mục" và tự kiểm tra tệp trước khi mở.'
  }
}
