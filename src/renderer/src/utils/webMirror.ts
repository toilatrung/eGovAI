import type { ToolCallBlock } from '../../../shared/types'

function pickString(params: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!params) return null
  for (const k of keys) {
    const v = params[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/**
 * Đổi một lần gọi công cụ tra cứu nội bộ của lõi (search_web / read_url_content) thành trang
 * tương ứng để hiển thị ở tab Trình duyệt. Trả null với các công cụ khác.
 */
export function mirrorWebToolCall(toolCall: ToolCallBlock): { url: string; label: string } | null {
  const name = toolCall.toolName.toLowerCase().split('/').pop() ?? ''
  const params = (toolCall.parameters ?? undefined) as Record<string, unknown> | undefined
  if (name === 'search_web' || name === 'web_search' || name === 'google_search') {
    const query = pickString(params, ['query', 'Query', 'q', 'search_query', 'SearchQuery'])
    if (!query) return null
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=vi`,
      label: `Đang tìm: “${query.length > 70 ? `${query.slice(0, 69)}…` : query}”`
    }
  }
  if (name === 'read_url_content' || name === 'read_url' || name === 'fetch_url' || name === 'web_fetch') {
    const url = pickString(params, ['Url', 'url', 'URL', 'uri'])
    if (!url || !/^https?:\/\//i.test(url)) return null
    let host = url
    try {
      host = new URL(url).hostname
    } catch {
      // giữ nguyên
    }
    return { url, label: `Đang đọc trang: ${host}` }
  }
  return null
}
