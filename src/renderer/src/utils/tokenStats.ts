import type { AgyModel, Conversation } from '../../../shared/types'

export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cacheReadTokens: number
  totalTokens: number
  turns: number
}

export interface ModelTokenBreakdown {
  modelId: string
  modelName: string
  totalTokens: number
  turns: number
}

export interface AccountTokenSummary {
  allTime: TokenTotals
  today: TokenTotals
  activeConversation: TokenTotals
  byModel: ModelTokenBreakdown[]
  cacheHitPercent: number
}

function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    turns: 0
  }
}

function addUsage(
  target: TokenTotals,
  usage: {
    inputTokens?: number
    outputTokens?: number
    thinkingTokens?: number
    cacheReadTokens?: number
    totalTokens?: number
  }
): void {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const thinking = usage.thinkingTokens ?? 0
  const cache = usage.cacheReadTokens ?? 0
  const total = usage.totalTokens ?? input + output

  target.inputTokens += input
  target.outputTokens += output
  target.thinkingTokens += thinking
  target.cacheReadTokens += cache
  target.totalTokens += total
  target.turns += 1
}

export function formatCompactTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2).replace('.', ',')}M`
  }
  if (count >= 10_000) {
    return `${(count / 1_000).toFixed(1).replace('.', ',')}K`
  }
  return count.toLocaleString('vi-VN')
}

export function computeTokenStats(
  conversations: Conversation[],
  activeConversationId: string | null,
  models: AgyModel[],
  nowMs = Date.now()
): AccountTokenSummary {
  const allTime = emptyTotals()
  const today = emptyTotals()
  const activeConversation = emptyTotals()

  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const todayCutoff = startOfToday.getTime()

  const modelNameMap = new Map<string, string>()
  for (const m of models) {
    modelNameMap.set(m.id, m.name)
  }

  const byModelMap = new Map<string, { totalTokens: number; turns: number }>()

  for (const conv of conversations) {
    const modelKey = conv.modelId || 'default'
    for (const msg of conv.messages) {
      if (msg.role !== 'assistant' || !msg.usage) continue
      const u = msg.usage
      addUsage(allTime, u)

      if (msg.createdAt >= todayCutoff) {
        addUsage(today, u)
      }

      if (conv.id === activeConversationId) {
        addUsage(activeConversation, u)
      }

      const prev = byModelMap.get(modelKey) ?? { totalTokens: 0, turns: 0 }
      prev.totalTokens += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
      prev.turns += 1
      byModelMap.set(modelKey, prev)
    }
  }

  const byModel: ModelTokenBreakdown[] = Array.from(byModelMap.entries())
    .map(([modelId, data]) => ({
      modelId,
      modelName:
        modelId === 'default'
          ? 'Mặc định theo tài khoản'
          : (modelNameMap.get(modelId) ?? modelId),
      totalTokens: data.totalTokens,
      turns: data.turns
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const inputBase = allTime.inputTokens + allTime.cacheReadTokens
  const cacheHitPercent =
    inputBase > 0 ? Math.round((allTime.cacheReadTokens / inputBase) * 100) : 0

  return {
    allTime,
    today,
    activeConversation,
    byModel,
    cacheHitPercent
  }
}
