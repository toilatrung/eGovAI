import { randomUUID } from 'crypto'
import type { InteractionRequest, InteractionResponse } from '../../shared/types'
import {
  SCOPE_DEFAULT_TTL_MS,
  isScopeActive,
  type DesktopRisk,
  type TaskScopeGrant
} from './desktopActionPolicy'

interface PendingEntry {
  resolve: (res: InteractionResponse) => void
}

export interface InteractionManagerOptions {
  /**
   * Mặc định true: trong mỗi lượt trả lời, chỉ hỏi xác nhận người dùng MỘT lần trước khi thực thi
   * thao tác trình duyệt/điều khiển máy; nếu người dùng xác nhận thì tự động thực hiện các bước
   * tiếp theo trong cùng lượt đó mà không hỏi lặp lại.
   */
  askOncePerTurn?: boolean
}

export class InteractionManager {
  private pending = new Map<string, PendingEntry>()
  /**
   * "Luôn cho phép trong phiên" CHỈ bao phủ thao tác rủi ro thấp ('low').
   * Thao tác rủi ro cao luôn tuân theo xác nhận của lượt (hoặc hỏi lại nếu tắt askOncePerTurn).
   */
  private sessionAutoApproveLowRisk = false
  /** Người dùng đã xác nhận thực hiện cho lượt trả lời hiện tại (tự xóa khi kết thúc lượt). */
  private turnApproved = false
  private readonly askOncePerTurn: boolean
  /** Phạm vi điều khiển theo việc (tự hết hạn khi hết lượt hoặc sau 10 phút). */
  private activeScope: TaskScopeGrant | null = null
  private onDispatch: (req: InteractionRequest) => void

  constructor(onDispatch: (req: InteractionRequest) => void, options?: InteractionManagerOptions) {
    this.onDispatch = onDispatch
    this.askOncePerTurn = options?.askOncePerTurn ?? true
  }

  isSessionAutoApproved(): boolean {
    return this.sessionAutoApproveLowRisk
  }

  isTurnApproved(): boolean {
    return this.turnApproved
  }

  resetSessionAutoApprove(): void {
    this.sessionAutoApproveLowRisk = false
    this.turnApproved = false
    this.activeScope = null
  }

  getActiveScope(now = Date.now()): TaskScopeGrant | null {
    if (!isScopeActive(this.activeScope, now)) {
      this.activeScope = null
      return null
    }
    return this.activeScope
  }

  grantTaskScope(
    apps: string[],
    purpose: string,
    ttlMs = SCOPE_DEFAULT_TTL_MS,
    now = Date.now()
  ): TaskScopeGrant {
    const cleanedApps = Array.from(new Set(apps.map((a) => a.trim()).filter(Boolean)))
    const grant: TaskScopeGrant = {
      apps: cleanedApps,
      purpose: purpose.trim(),
      grantedAt: now,
      expiresAt: now + ttlMs
    }
    this.activeScope = grant
    return grant
  }

  clearTaskScope(): void {
    this.activeScope = null
    this.turnApproved = false
  }

  async requestScopeApproval(params: {
    apps: string[]
    purpose: string
    lines?: string[]
  }): Promise<InteractionResponse> {
    const appsList = params.apps.map((a) => a.trim()).filter(Boolean)
    const purpose = params.purpose.trim() || 'thực hiện yêu cầu của bạn'
    if (this.askOncePerTurn && this.turnApproved) {
      if (appsList.length > 0) {
        this.grantTaskScope(appsList, purpose)
      }
      return {
        id: 'turn-approved',
        approved: true
      }
    }
    const res = await this.request({
      kind: 'approval',
      title: 'Xin phép điều khiển ứng dụng',
      message: `eGovAI xin điều khiển ${appsList.join(', ')} để: ${purpose}`,
      toolName: 'desktop_request_scope',
      details: {
        isScopeRequest: true,
        apps: appsList,
        purpose,
        risk: 'low',
        summary: params.lines ?? [
          `Ứng dụng được phép: ${appsList.join(', ')}`,
          'Chỉ hỏi xác nhận một lần cho yêu cầu này; nếu bạn đồng ý, trợ lý sẽ thực hiện trọn vẹn các bước tiếp theo trong lượt.',
          'Tự hết hạn ngay khi lượt trả lời kết thúc.'
        ]
      },
      allowAttachments: false
    })

    if (res.approved) {
      if (this.askOncePerTurn) {
        this.turnApproved = true
      }
      if (appsList.length > 0) {
        this.grantTaskScope(appsList, purpose)
      }
    }
    return res
  }

  /** Có được tự duyệt mà không hỏi người dùng không (chỉ khi đã bật và rủi ro thấp). */
  canAutoApprove(risk: DesktopRisk): boolean {
    return this.sessionAutoApproveLowRisk && risk === 'low'
  }

  async requestApproval(params: {
    title: string
    message: string
    toolName: string
    details?: Record<string, unknown>
    /** Mặc định 'high' — không bao giờ tự duyệt nếu không khai báo rõ. */
    risk?: DesktopRisk
  }): Promise<InteractionResponse> {
    const risk: DesktopRisk = params.risk ?? 'high'
    const isDirectUserQuestion = params.toolName === 'desktop_ask_user'
    if (this.askOncePerTurn && this.turnApproved && !isDirectUserQuestion) {
      return {
        id: 'turn-approved',
        approved: true
      }
    }
    if (this.canAutoApprove(risk)) {
      return {
        id: 'auto-approved',
        approved: true,
        alwaysAllowSession: true
      }
    }

    const res = await this.request({
      kind: 'approval',
      title: params.title,
      message: params.message,
      toolName: params.toolName,
      details: { ...(params.details ?? {}), risk },
      allowAttachments: false
    })

    if (res.approved) {
      if (this.askOncePerTurn && !isDirectUserQuestion) {
        this.turnApproved = true
      }
      if (res.alwaysAllowSession) {
        this.sessionAutoApproveLowRisk = true
      }
    }
    return res
  }

  async requestQuestion(params: {
    title: string
    message: string
    options?: string[]
    allowMultiple?: boolean
  }): Promise<InteractionResponse> {
    return await this.request({
      kind: 'question',
      title: params.title,
      message: params.message,
      options: params.options,
      allowMultiple: params.allowMultiple,
      allowAttachments: true
    })
  }

  private request(
    partial: Omit<InteractionRequest, 'id' | 'createdAt'>
  ): Promise<InteractionResponse> {
    const id = randomUUID()
    const req: InteractionRequest = {
      ...partial,
      id,
      createdAt: Date.now()
    }

    return new Promise<InteractionResponse>((resolve) => {
      this.pending.set(id, { resolve })
      this.onDispatch(req)
    })
  }

  respond(response: InteractionResponse): boolean {
    const entry = this.pending.get(response.id)
    if (!entry) return false
    this.pending.delete(response.id)
    entry.resolve(response)
    return true
  }

  cancelAll(reason = 'Phiên làm việc đã dừng hoặc hủy bỏ.'): void {
    this.activeScope = null
    this.turnApproved = false
    for (const [id, entry] of this.pending.entries()) {
      entry.resolve({
        id,
        approved: false,
        contextNote: reason
      })
    }
    this.pending.clear()
  }
}
