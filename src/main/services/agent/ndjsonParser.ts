import type { AgyStreamEvent, ToolCallBlock, UsageStats } from '../../../shared/types'
import { isOverloadError } from './overloadFallback'

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  thinking_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
}

interface RawStepUpdate {
  conversation_id?: string
  step_index?: number
  state?: 'ACTIVE' | 'DONE' | 'ERROR' | string
  step_type?: string
  text_delta?: string
  thinking_delta?: string
  tool_name?: string
  duration_seconds?: number
  tool_info?: {
    name?: string
    parameters?: Record<string, unknown>
    output?: string
    error?: {
      type?: string
      message?: string
    }
  }
  usage?: RawUsage
}

interface RawAgyJsonLine {
  event?: string
  conversation_id?: string
  init?: {
    cwd?: string
    tools?: string[]
    permission_mode?: string
  }
  step_update?: RawStepUpdate
  result?: {
    conversation_id?: string
    status?: string
    response?: string
    error?: string
    duration_seconds?: number
    num_turns?: number
    usage?: RawUsage
  }
  error?: string
}

function mapUsage(raw?: RawUsage): UsageStats | undefined {
  if (!raw) return undefined
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    thinkingTokens: raw.thinking_tokens ?? 0,
    cacheReadTokens: raw.cache_read_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0
  }
}

function normalizeState(state?: string): 'ACTIVE' | 'DONE' | 'ERROR' {
  if (state === 'DONE') return 'DONE'
  if (state === 'ERROR' || state === 'FAILED') return 'ERROR'
  return 'ACTIVE'
}

export function parseAgyNdjsonLine(
  line: string,
  conversationId: string,
  messageId: string
): AgyStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('{')) {
    return null
  }

  let parsed: RawAgyJsonLine
  try {
    parsed = JSON.parse(trimmed) as RawAgyJsonLine
  } catch {
    return null
  }

  if (parsed.event === 'init') {
    const agyConversationId = parsed.conversation_id ?? ''
    return {
      type: 'init',
      conversationId,
      messageId,
      agyConversationId,
      cwd: parsed.init?.cwd,
      permissionMode: parsed.init?.permission_mode,
      tools: parsed.init?.tools
    }
  }

  if (parsed.event === 'step_update' && parsed.step_update) {
    const step = parsed.step_update
    const stepIndex = step.step_index ?? 0

    if (step.step_type === 'agent_response') {
      if (typeof step.text_delta === 'string' && step.text_delta.length > 0) {
        return {
          type: 'text_delta',
          conversationId,
          messageId,
          delta: step.text_delta,
          stepIndex
        }
      }

      if (step.state === 'DONE' && (step.usage?.thinking_tokens || step.duration_seconds)) {
        return {
          type: 'thinking_done',
          conversationId,
          messageId,
          stepIndex,
          durationSeconds: step.duration_seconds,
          thinkingTokens: step.usage?.thinking_tokens
        }
      }

      return null
    }

    if (step.step_type === 'tool') {
      const toolOutput = step.tool_info?.output ?? step.tool_info?.error?.message
      const toolCall: ToolCallBlock = {
        stepIndex,
        toolName: step.tool_name ?? step.tool_info?.name ?? 'tool',
        parameters: step.tool_info?.parameters,
        output: toolOutput,
        state: normalizeState(step.state),
        durationSeconds: step.duration_seconds
      }
      return {
        type: 'tool_update',
        conversationId,
        messageId,
        toolCall
      }
    }

    // Bước lỗi hệ thống (VD máy chủ quá tải 503 khi lõi đang tự thử lại): báo trạng thái,
    // không kết thúc lượt — adapter quyết định có chuyển mô hình dự phòng hay không.
    const stepError = (step as { error?: unknown }).error
    const errorText =
      typeof stepError === 'string'
        ? stepError
        : stepError && typeof stepError === 'object' && 'message' in stepError
          ? String((stepError as { message?: unknown }).message ?? '')
          : ''
    if (errorText && isOverloadError(errorText)) {
      return { type: 'status', conversationId, messageId, message: errorText }
    }

    return null
  }

  if (parsed.event === 'result' && parsed.result) {
    const res = parsed.result
    if (res.status && res.status !== 'SUCCESS') {
      return {
        type: 'error',
        conversationId,
        messageId,
        error: res.error || res.response || `Lõi AI kết thúc với trạng thái: ${res.status}`
      }
    }

    return {
      type: 'result',
      conversationId,
      messageId,
      agyConversationId: res.conversation_id,
      status: res.status ?? 'SUCCESS',
      response: res.response,
      durationSeconds: res.duration_seconds,
      usage: mapUsage(res.usage)
    }
  }

  if (parsed.event === 'error' || parsed.error) {
    return {
      type: 'error',
      conversationId,
      messageId,
      error: parsed.error || 'Đã xảy ra lỗi từ lõi AI.'
    }
  }

  return null
}

/**
 * Stateful line buffer for chunked stdout streams so multi-byte UTF-8
 * Vietnamese characters and split JSON lines are parsed cleanly.
 */
export class NdjsonLineBuffer {
  private remainder = ''

  push(chunk: string): string[] {
    this.remainder += chunk
    const lines = this.remainder.split(/\r?\n/)
    this.remainder = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    if (!this.remainder.trim()) {
      this.remainder = ''
      return []
    }
    const last = this.remainder
    this.remainder = ''
    return [last]
  }
}
