import { closeSync, openSync, readSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ReasoningEffort } from '../../../shared/types'

/**
 * Xử lý khi máy chủ mô hình báo quá tải (HTTP 503 "No capacity", 429...).
 *
 * agy.exe tự thử lại khoảng 60 giây/lần và KHÔNG báo gì ra stdout, nên cán bộ chỉ thấy
 * "Đang soạn thảo…" kéo dài vài phút. Ta đọc nhật ký phiên của agy để phát hiện sớm,
 * rồi nối tiếp CÙNG hội thoại (`--conversation`) bằng mô hình khác:
 * - Việc chính đã làm xong (đã có bước công cụ hoàn tất) → mô hình rẻ chỉ để tóm tắt.
 * - Chưa làm gì → một mô hình mạnh thuộc dòng khác để làm tiếp.
 */

const OVERLOAD_RE =
  /no capacity|resource[_ ]exhausted|http 503|http 429|\(code 503\)|\(code 429\)|overloaded|quá tải/i

export function isOverloadError(text: string | undefined | null): boolean {
  return Boolean(text && OVERLOAD_RE.test(text))
}

/** Thư mục nhật ký phiên mặc định của agy: ~/.gemini/antigravity-cli/brain */
export function defaultAgyBrainRoot(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'brain')
}

export function agyTranscriptPath(brainRoot: string, agyConversationId: string): string {
  return join(brainRoot, agyConversationId, '.system_generated', 'logs', 'transcript.jsonl')
}

export function fileSizeOrZero(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * Đọc phần mới của transcript.jsonl kể từ `offset` và trả về các thông báo lỗi quá tải.
 * Tệp có thể bị ghi lại toàn bộ — nếu nhỏ hơn offset thì đọc lại từ đầu.
 */
export function readNewOverloadErrors(
  path: string,
  offset: number
): { errors: string[]; offset: number } {
  const size = fileSizeOrZero(path)
  if (size === 0) return { errors: [], offset }
  const start = size < offset ? 0 : offset
  if (size === start) return { errors: [], offset: start }

  let text = ''
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(size - start)
    readSync(fd, buf, 0, buf.length, start)
    text = buf.toString('utf8')
  } catch {
    return { errors: [], offset }
  } finally {
    if (fd !== null) closeSync(fd)
  }

  // Chỉ xử lý tới dòng hoàn chỉnh cuối cùng; phần dở dang đọc lại ở lần sau.
  const lastNewline = text.lastIndexOf('\n')
  if (lastNewline < 0) return { errors: [], offset: start }
  const complete = text.slice(0, lastNewline + 1)
  const consumed = Buffer.byteLength(complete, 'utf8')

  const errors: string[] = []
  for (const line of complete.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      const step = JSON.parse(line) as { type?: string; error?: string; content?: string }
      if (step.type !== 'ERROR_MESSAGE') continue
      const msg = step.error ?? step.content ?? ''
      if (isOverloadError(msg)) errors.push(msg)
    } catch {
      // bỏ qua dòng hỏng
    }
  }
  return { errors, offset: start + consumed }
}

/**
 * Mức suy luận đi kèm mã mô hình. agy từ chối khi `--effort` không khớp hậu tố
 * (VD `--model gemini-3.8-flash-medium --effort low`), nên lượt dự phòng lấy theo hậu tố,
 * còn mô hình không có hậu tố thì không truyền `--effort`.
 */
export function effortForModel(id: string): ReasoningEffort | undefined {
  const m = id.toLowerCase().match(/-(low|medium|high|xhigh|max)$/)
  return m ? (m[1] as ReasoningEffort) : undefined
}

/** "gemini-4-hydrogen-medium" → "gemini-4-hydrogen" (bỏ hậu tố mức suy luận). */
export function modelFamily(id: string): string {
  return id.toLowerCase().replace(/-(low|medium|high|xhigh|max|thinking)$/i, '')
}

function pickByPreference(
  current: string | undefined,
  models: ReadonlyArray<{ id: string }>,
  prefs: string[]
): string | null {
  const family = current ? modelFamily(current) : ''
  const candidates = models.filter((m) => !family || modelFamily(m.id) !== family)
  for (const pattern of prefs) {
    const hit = candidates.find((m) => m.id.toLowerCase().includes(pattern))
    if (hit) return hit.id
  }
  return null
}

/** Mô hình rẻ, nhanh chỉ để viết câu trả lời/tóm tắt sau khi việc chính đã xong. */
export function pickSummaryModel(
  current: string | undefined,
  models: ReadonlyArray<{ id: string }>
): string | null {
  return pickByPreference(current, models, [
    'flash-medium',
    'flash-low',
    'flash-high',
    'flash',
    'hydrogen-low',
    'gpt-oss',
    'sonnet'
  ])
}

/** Mô hình mạnh thuộc dòng khác để làm tiếp khi chưa kịp làm bước nào. */
export function pickStrongFallbackModel(
  current: string | undefined,
  models: ReadonlyArray<{ id: string }>
): string | null {
  return pickByPreference(current, models, [
    'hydrogen-medium',
    'hydrogen-high',
    'claude-sonnet',
    'claude-opus',
    'flash-high',
    'flash-medium',
    'gpt-oss'
  ])
}

export type FallbackKind = 'summary' | 'continue'

export function buildFallbackPrompt(kind: FallbackKind): string {
  if (kind === 'summary') {
    return (
      '[Hệ thống eGovAI: Mô hình trước bị máy chủ báo quá tải khi đang viết câu trả lời. ' +
      'Các bước công việc ở lượt trên đã được thực hiện — KHÔNG làm lại những việc đã xong. ' +
      'Nếu còn bước nhỏ dở dang (ví dụ chưa chép tệp kết quả vào thư mục dự án) thì làm nốt; ' +
      'sau đó viết câu trả lời cuối cho người dùng bằng tiếng Việt, ngắn gọn: đã làm gì, tệp kết quả (kèm đường dẫn đầy đủ) và nội dung chính.]'
    )
  }
  return (
    '[Hệ thống eGovAI: Mô hình trước bị máy chủ báo quá tải trước khi kịp xử lý. ' +
    'Hãy thực hiện yêu cầu ở tin nhắn gần nhất của người dùng phía trên, tuân thủ các hướng dẫn đã nêu.]'
  )
}

export function describeModel(id: string | undefined): string {
  return id && id.trim() ? id : 'mặc định'
}
