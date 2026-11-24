import type { ChatMessage, Conversation } from '../../../shared/types'

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const COMBINING = /[̀-ͯ]/g

/** Lowercase + strip Vietnamese diacritics, keeping a 1:1 char index map. */
function foldWithMap(input: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  const chars = Array.from(input.normalize('NFC'))
  let offset = 0
  for (const ch of chars) {
    const f = ch
      .normalize('NFD')
      .replace(COMBINING, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
    for (let i = 0; i < f.length; i++) {
      folded += f[i]
      map.push(offset)
    }
    offset += ch.length
  }
  map.push(offset)
  return { folded, map }
}

export function foldText(input: string): string {
  return foldWithMap(input).folded
}

export interface ConversationSearchHit {
  conversation: Conversation
  /** Short excerpt around the first content match (absent for title-only hits) */
  snippet?: { before: string; match: string; after: string }
}

function makeSnippet(
  text: string,
  start: number,
  end: number,
  radiusBefore = 28,
  radiusAfter = 60
): ConversationSearchHit['snippet'] {
  const from = Math.max(0, start - radiusBefore)
  const to = Math.min(text.length, end + radiusAfter)
  const clean = (s: string): string => s.replace(/\s+/g, ' ')
  return {
    before: (from > 0 ? '…' : '') + clean(text.slice(from, start)).trimStart(),
    match: clean(text.slice(start, end)),
    after: clean(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : '')
  }
}

/**
 * Matches the query (diacritic-insensitive) against titles and message
 * content. Title matches come first; content matches carry a snippet.
 */
export function searchConversations(
  conversations: Conversation[],
  query: string
): ConversationSearchHit[] {
  const q = foldText(query.trim()).replace(/\s+/g, ' ')
  if (!q) return conversations.map((conversation) => ({ conversation }))

  const titleHits: ConversationSearchHit[] = []
  const contentHits: ConversationSearchHit[] = []

  for (const conversation of conversations) {
    if (foldText(conversation.title).includes(q)) {
      titleHits.push({ conversation })
      continue
    }
    for (const msg of conversation.messages) {
      if (!msg.content) continue
      const text = msg.content.normalize('NFC')
      const { folded, map } = foldWithMap(text)
      const idx = folded.indexOf(q)
      if (idx === -1) continue
      contentHits.push({
        conversation,
        snippet: makeSnippet(text, map[idx], map[idx + q.length])
      })
      break
    }
  }
  return [...titleHits, ...contentHits]
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('vi-VN')
  } catch {
    return new Date(ts).toISOString()
  }
}

export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [`# ${conv.title}`, '', `_Xuất từ eGovAI — ${formatDate(Date.now())}_`, '']
  for (const msg of conv.messages) {
    if (msg.role === 'assistant' && !msg.content && msg.status !== 'error') continue
    lines.push(`## ${msg.role === 'user' ? 'Người dùng' : 'eGovAI'} · ${formatDate(msg.createdAt)}`, '')
    if (msg.attachments && msg.attachments.length > 0) {
      lines.push(`Tệp đính kèm: ${msg.attachments.map((a) => a.name).join(', ')}`, '')
    }
    if (msg.content) lines.push(msg.content.trim(), '')
    if (msg.status === 'error' && msg.error) lines.push(`> Lỗi: ${msg.error}`, '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

/** File-system-safe base name derived from the conversation title. */
export function exportFileBaseName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return base || 'hoi-thoai'
}

/* ------------------------------------------------------------------ */
/* Replay (regenerate / edit)                                          */
/* ------------------------------------------------------------------ */

const PER_MESSAGE_LIMIT = 4000
const TOTAL_LIMIT = 16000

/**
 * When the user edits an earlier message or regenerates an answer, the AI
 * core's own server-side thread still contains the discarded turns. We start
 * a fresh core thread instead and pass the kept history inline.
 */
export function buildReplayPrompt(history: ChatMessage[], text: string): string {
  const turns = history.filter(
    (m) => m.content.trim().length > 0 && (m.role === 'user' || m.status !== 'error')
  )
  if (turns.length === 0) return text

  const rendered: string[] = []
  let total = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const m = turns[i]
    let body = m.content.trim()
    if (body.length > PER_MESSAGE_LIMIT) body = `${body.slice(0, PER_MESSAGE_LIMIT)}\n[…đã rút gọn]`
    const entry = `${m.role === 'user' ? 'Người dùng' : 'eGovAI'}: ${body}`
    if (total + entry.length > TOTAL_LIMIT && rendered.length > 0) {
      rendered.unshift('[…các lượt trước đã được lược bớt]')
      break
    }
    rendered.unshift(entry)
    total += entry.length
  }

  return [
    'Bối cảnh: đây là phần tiếp nối của một hội thoại trước đó. Lịch sử dưới đây chỉ để tham khảo ngữ cảnh; hãy trả lời yêu cầu hiện tại.',
    '<lich_su_hoi_thoai>',
    rendered.join('\n\n'),
    '</lich_su_hoi_thoai>',
    '',
    'Yêu cầu hiện tại:',
    text
  ].join('\n')
}
