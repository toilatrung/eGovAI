export function safeUrlTransform(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return ''
  }
  return trimmed
}

export function resolveLocalFileHref(href: string, projectPath?: string): string | null {
  const trimmed = href.trim()
  if (!trimmed) return null
  if (/^(https?:|mailto:|tel:|#)/i.test(trimmed)) {
    return null
  }

  let candidate = trimmed

  if (/^file:/i.test(candidate)) {
    candidate = candidate.replace(/^file:\/+/i, '')
    candidate = candidate.split('#')[0].split('?')[0]
    try {
      candidate = decodeURIComponent(candidate)
    } catch {
      // keep raw
    }
    if (/^[A-Za-z]:\//.test(candidate) || /^[A-Za-z]:\\/.test(candidate)) {
      return candidate.replace(/\//g, '\\')
    }
    return candidate
  }

  // Bare Windows path like C:\... or C:/...
  const cleanBare = candidate.split('#')[0].split('?')[0]
  if (/^[A-Za-z]:[\\/]/.test(cleanBare)) {
    try {
      return decodeURIComponent(cleanBare).replace(/\//g, '\\')
    } catch {
      return cleanBare.replace(/\//g, '\\')
    }
  }

  // Relative workspace file path (e.g. skill_.../SKILL.md)
  if (projectPath && !cleanBare.startsWith('//') && /\.[a-zA-Z0-9]{1,8}$/.test(cleanBare)) {
    const base = projectPath.replace(/[\\/]+$/, '')
    const rel = cleanBare.replace(/^\.[\\/]/, '').replace(/\//g, '\\')
    return `${base}\\${rel}`
  }

  return null
}

export function extractLocalFilesFromMarkdown(
  markdown: string,
  projectPath?: string
): { label: string; path: string }[] {
  const results: { label: string; path: string }[] = []
  const seen = new Set<string>()
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(markdown)) !== null) {
    const label = match[1].trim()
    const href = match[2].trim()
    const resolved = resolveLocalFileHref(href, projectPath)
    if (!resolved) continue
    const key = resolved.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ label, path: resolved })
  }

  return results
}
