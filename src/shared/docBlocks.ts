/**
 * Giao thức "khối văn bản" giữa lõi AI và giao diện (góp ý: văn bản đã soạn trong tab
 * Tài liệu thì câu trả lời chat không lặp lại toàn văn).
 *
 * Mô hình đặt toàn văn văn bản trong khối:
 *
 *   ```egov-doc title="Công văn – V/v tổng vệ sinh môi trường"
 *   ...toàn văn...
 *   ```
 *
 * Phần ngoài khối là lời trao đổi ngắn, hiển thị trong chat; phần trong khối hiển thị ở
 * tab Tài liệu và được xuất Word.
 */

export const DOC_BLOCK_LANG = 'egov-doc'

export interface TextSegment {
  type: 'text'
  text: string
}

export interface DocSegment {
  type: 'doc'
  /** Thứ tự khối văn bản trong tin nhắn (0, 1, …). */
  index: number
  title: string
  body: string
  /** false khi khối đang được stream và chưa có dấu đóng. */
  closed: boolean
}

export type MessageSegment = TextSegment | DocSegment

const OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*egov-doc\b(.*)$/i

function parseTitle(rest: string): string {
  const quoted = rest.match(/title\s*[=:]\s*["“']([^"”']*)["”']/i)
  if (quoted) return quoted[1].trim()
  const bare = rest.match(/title\s*[=:]\s*(.+)$/i)
  if (bare) return bare[1].trim()
  return rest.replace(/^[\s:–-]+/, '').trim()
}

/**
 * Tách nội dung tin nhắn thành các đoạn trao đổi và khối văn bản. Chịu được khối chưa
 * đóng (đang stream) và dấu mở khối bị cắt giữa chừng ở cuối luồng.
 */
export function splitDocBlocks(content: string): MessageSegment[] {
  const lines = content.split(/\r?\n/)
  const segments: MessageSegment[] = []
  let textBuf: string[] = []
  let docIndex = 0
  let i = 0

  const flushText = (): void => {
    const text = textBuf.join('\n')
    if (text.trim()) segments.push({ type: 'text', text })
    textBuf = []
  }

  while (i < lines.length) {
    const open = lines[i].match(OPEN_RE)
    if (!open) {
      textBuf.push(lines[i])
      i++
      continue
    }
    flushText()
    const fence = open[1]
    const title = parseTitle(open[2] ?? '')
    const body: string[] = []
    let closed = false
    i++
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()
      if (
        trimmed.length >= fence.length &&
        trimmed[0] === fence[0] &&
        new RegExp(`^\\${fence[0]}{${fence.length},}$`).test(trimmed)
      ) {
        closed = true
        i++
        break
      }
      body.push(line)
      i++
    }
    segments.push({ type: 'doc', index: docIndex++, title, body: body.join('\n').trim(), closed })
  }
  flushText()

  // Ẩn dấu mở khối bị cắt dở ở cuối luồng (VD "```egov-d") để chat không nhấp nháy ký tự lạ.
  const last = segments[segments.length - 1]
  if (last && last.type === 'text') {
    const cleaned = last.text.replace(
      /(^|\n)[ \t]{0,3}(`{1,3}|~{1,3})[ \t]*(e(g(o(v(-(d(oc?)?)?)?)?)?)?)?[ \t]*$/i,
      ''
    )
    if (cleaned !== last.text) {
      if (cleaned.trim()) last.text = cleaned
      else segments.pop()
    }
  }
  return segments
}

export function getDocSegments(content: string): DocSegment[] {
  return splitDocBlocks(content).filter((s): s is DocSegment => s.type === 'doc')
}

export function hasDocBlock(content: string): boolean {
  return getDocSegments(content).length > 0
}

/** Văn bản cuối cùng trong tin nhắn (bản mới nhất khi AI trả lại toàn văn sau khi sửa). */
export function getLatestDocSegment(content: string): DocSegment | null {
  const docs = getDocSegments(content)
  return docs.length > 0 ? docs[docs.length - 1] : null
}
