import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { delimiter } from 'path'
import { promisify } from 'util'
import type { AgyStreamEvent, SendPromptPayload } from '../../shared/types'
import { formatAgencyProfileSummary } from '../../shared/agencyProfile'
import { resolveAgentDesktopBinary } from '../services/computerUseService'
import { DESKTOP_MCP_SERVER_NAME, DESKTOP_MCP_TOOLS } from '../services/desktopMcpServer'
import { getAgyBinaryPath, parseAgyModelsOutput } from './agyBinary'
import { NdjsonLineBuffer, parseAgyNdjsonLine } from './ndjsonParser'
import {
  agyTranscriptPath,
  buildFallbackPrompt,
  defaultAgyBrainRoot,
  describeModel,
  effortForModel,
  fileSizeOrZero,
  isOverloadError,
  pickStrongFallbackModel,
  pickSummaryModel,
  readNewOverloadErrors,
  type FallbackKind
} from './overloadFallback'

const execFileAsync = promisify(execFile)

export interface ComposePromptOptions {
  /** Omit static session-level instructions already sent earlier in this persistent session. */
  omitSessionPreamble?: boolean
}

export function formatVietnameseDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `ngày ${dd} tháng ${mm} năm ${d.getFullYear()}`
}

/**
 * Quy tắc soạn văn bản: toàn văn đặt trong khối ```egov-doc``` để ứng dụng hiển thị ở tab
 * Tài liệu và xuất Word, còn chat chỉ giữ vài câu trao đổi (không lặp lại toàn văn).
 */
export function buildDraftingRules(todayLabel?: string): string {
  const today = todayLabel ? ` Hôm nay là ${todayLabel}; ngày ban hành mặc định là hôm nay.` : ''
  return (
    '[Quy tắc soạn thảo văn bản: Khi người dùng yêu cầu soạn hoặc sửa một văn bản (công văn, tờ trình, báo cáo, kế hoạch, quyết định, thông báo, giấy mời, biên bản…), đặt TOÀN VĂN văn bản hoàn chỉnh trong ĐÚNG MỘT khối có dạng:\n' +
    '```egov-doc title="<Loại văn bản – trích yếu ngắn>"\n<toàn văn>\n```\n' +
    'Ngoài khối chỉ viết tối đa 2–3 câu ngắn (ví dụ: đã soạn gì, còn thiếu thông tin nào). KHÔNG viết lời dẫn, lưu ý hay danh sách "thông tin còn thiếu" bên trong khối. Ứng dụng tự hiển thị khối ở tab Tài liệu và xuất Word; người dùng là cán bộ, không dùng Markdown, nên đừng nhắc tới Markdown hay định dạng kỹ thuật. ' +
    'Thể thức (NĐ 30/2020/NĐ-CP): phần đầu là bảng 2 cột — cột trái: cơ quan chủ quản (nếu có), cơ quan ban hành (in hoa, đậm), "Số: …/…", trích yếu "V/v …" (với công văn); cột phải: Quốc hiệu, Tiêu ngữ, địa danh và ngày tháng (in nghiêng). Tên loại văn bản (VD "## GIẤY MỜI", "## BÁO CÁO") và dòng trích yếu ngay dưới (VD "## Về việc …") viết thành tiêu đề cấp 2 để được căn giữa, in đậm; các mục lớn (I., II., 1., 2.) dùng tiêu đề cấp 3 hoặc chữ đậm. Phần cuối là bảng 2 cột: cột trái "Nơi nhận:" và danh sách; cột phải quyền hạn, chức vụ người ký và họ tên. Xuống dòng trong ô bảng bằng <br>. KHÔNG dùng &nbsp;, KHÔNG dùng HTML nào khác, KHÔNG dùng đường kẻ ---. ' +
    'Điền đầy đủ từ hồ sơ đơn vị và từ những gì người dùng đã cung cấp trong hội thoại; chỉ để [ … ] cho dữ liệu thật sự chưa biết.' +
    today +
    ' Chính quyền địa phương hiện tổ chức 2 cấp (tỉnh và xã/phường, không còn cấp huyện); nếu người dùng nhắc cấp huyện thì soạn theo yêu cầu nhưng nhắc nhẹ ngoài khối. Khi sửa văn bản, trả lại TOÀN VĂN bản mới trong một khối egov-doc mới. Câu hỏi tra cứu, giải thích thông thường thì trả lời bình thường, KHÔNG dùng khối egov-doc. KHÔNG mất thời gian chạy lệnh quét ổ đĩa hay dò tìm Python.]'
  )
}

export function buildSessionPreamble(payload: SendPromptPayload): string[] {
  const sections: string[] = []

  if (payload.preferVietnameseReplies) {
    sections.push(
      '[Hướng dẫn ngôn ngữ: Luôn trao đổi, giải thích và trình bày kết quả hoàn toàn bằng Tiếng Việt rõ ràng, tự nhiên, đúng chuẩn hành chính/chuyên môn Việt Nam trừ khi người dùng yêu cầu ngôn ngữ khác.]'
    )
  }

  if (payload.agencyProfile?.enabled) {
    const profileSummary = formatAgencyProfileSummary(payload.agencyProfile)
    if (profileSummary) {
      sections.push(`[${profileSummary}]`)
    }
  }

  sections.push(
    '[Thanh Interactive Prompt hỏi ý kiến & phê duyệt: Khi cần người dùng phê duyệt kế hoạch, xác nhận thao tác quan trọng, chọn phương án hoặc bổ sung thông tin/hồ sơ còn thiếu giữa chừng, gọi công cụ MCP `desktop_ask_user` (máy chủ `egovai-desktop`) để hiện thanh Interactive Prompt ngay phía trên ô chat.]'
  )

  sections.push(buildDraftingRules(payload.todayLabel ?? formatVietnameseDate(new Date())))

  sections.push(
    '[Tra cứu & nguồn: Khi trả lời có dùng thông tin tra cứu trên mạng, ghi nguồn kèm ĐƯỜNG DẪN đầy đủ (https://…) của trang gốc (tên miền của báo/cổng thông tin như chinhphu.vn, thuvienphapluat.vn) để cán bộ kiểm chứng; KHÔNG dùng và KHÔNG mở các đường dẫn chuyển hướng dạng vertexaisearch.cloud.google.com/grounding-api-redirect — nếu kết quả tìm kiếm không cho địa chỉ trang gốc thì ghi tên trang và tiêu đề bài là đủ. Chỉ mở trang bằng web_open khi thật sự cần đọc toàn văn.Nếu không truy cập được trang (bị chặn, lỗi), nói rõ điều đó và ghi "theo hiểu biết, cần kiểm chứng" — KHÔNG được viết như thể đã đọc được trang. Không bịa số hiệu văn bản pháp luật; nếu không chắc số hiệu/ngày ban hành thì nói rõ là chưa chắc.]'
  )

  if (payload.computerUseEnabled) {
    const isMediumOrHigherEffort =
      !payload.effort || ['medium', 'high', 'xhigh', 'max'].includes(payload.effort)
    const speedRule = isMediumOrHigherEffort
      ? ' (4) TỐC ĐỘ THAO TÁC: Không suy luận dài dòng giữa các bước giao diện — hãy lập kế hoạch một lần ở đầu việc, gom tối đa các bước đoán trước được vào `desktop_batch` rồi thực thi gọn.'
      : ''
    sections.push(
      '[Công cụ tra cứu web & điều khiển máy tính (máy chủ MCP `egovai-desktop` tích hợp Playwright + agent-desktop + chụp ảnh màn hình) luôn sẵn sàng theo nhu cầu — ứng dụng tự hỏi xác nhận người dùng 1 lần trước khi thực thi thao tác trên máy/trình duyệt: ' +
        '(1) GOM THAO TÁC (`desktop_batch`): Luôn gom các bước đoán trước được vào 1 lệnh `desktop_batch` (VD: mở Notepad + chờ + gõ chữ: `[{action:"launch_app",app:"notepad.exe"},{action:"wait",ms:700},{action:"type",text:"xin chào"}]`) để giảm số lượt gọi mô hình; `desktop_batch` tự trả kèm trạng thái cuối nên không cần gọi thêm `desktop_snapshot`. ' +
        '(2) UIA TRƯỚC, ẢNH MÀN HÌNH DỰ PHÒNG: Ưu tiên `desktop_find` / cây UIA trước; nếu ứng dụng Electron (Zalo, Teams...) có cây UIA nghèo/thiếu phần tử thì dùng ngay `desktop_screenshot` (kèm `desktop_zoom` nếu chữ nhỏ) rồi dùng `desktop_click_at` theo tọa độ ảnh và `desktop_batch` (`type` không cần @ref sẽ nhập thẳng tiếng Việt vào ô đang focus). ' +
        '(3) TÁC VỤ WEB & TRA CỨU: Ưu tiên duyệt web trực tiếp trong Trình duyệt tích hợp ngay trong ứng dụng eGovAI qua (`web_open`, `web_snapshot`, `web_read_text`, `web_click`, `web_fill`, `web_close`) mà không cần mở trình duyệt ngoài hay dùng điều khiển máy tính. KHÔNG chạy chrome.exe hay agent-desktop qua run_command. Gọi thẳng các công cụ MCP này theo tham số: `web_open {url}`, `web_snapshot {}`, `web_read_text {maxChars?}`, `web_click {ref}` (mã @wN), `web_fill {ref, text, submit?}`, `web_close {}` — KHÔNG cần đọc tệp định nghĩa/schema công cụ trước khi gọi.' +
        speedRule +
        ']'
    )
  }

  return sections
}

export function computeSessionPreambleKey(payload: SendPromptPayload): string {
  return buildSessionPreamble(payload).join('\n')
}

export function buildComposedPrompt(
  payload: SendPromptPayload,
  options?: ComposePromptOptions
): string {
  const sections: string[] = options?.omitSessionPreamble ? [] : buildSessionPreamble(payload)

  if (payload.activeSkill) {
    const codeTag = payload.activeSkill.code ? ` (Mã ${payload.activeSkill.code})` : ''
    const sopTarget = payload.activeSkill.sopFullPath || payload.activeSkill.sopPath
    const rootHint =
      payload.activeSkill.scope === 'global' && payload.activeSkill.rootPath
        ? ` — Thư mục gốc bộ kỹ năng chung: ${payload.activeSkill.rootPath}`
        : ''
    sections.push(
      `[Nghiệp vụ/Kỹ năng được chọn: ${payload.activeSkill.title}${codeTag} — Đường dẫn SOP: ${sopTarget}${rootHint}. Hãy đọc và tuân thủ đúng SOP của kỹ năng này.]`
    )
  }

  if (payload.attachments && payload.attachments.length > 0) {
    const fileLines = payload.attachments.map((item) => {
      const kind = item.type === 'folder' ? 'Thư mục' : item.type === 'image' ? 'Hình ảnh' : 'Tệp'
      return `- ${kind}: ${item.path}`
    })
    sections.push(`[Tài liệu/Ngữ cảnh đính kèm:\n${fileLines.join('\n')}]`)
  }

  sections.push(payload.prompt)
  return sections.join('\n\n')
}

/**
 * One NDJSON line for `agy --input-format stream-json` (shape verified against agy.exe:
 * `{"event":"user","message":{"content":"..."}}`). The CLI runs one turn per line and
 * exits once stdin is closed.
 */
export function buildAgyStdinMessage(prompt: string): string {
  return JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n'
}

export function buildAgyCliArgs(payload: SendPromptPayload): string[] {
  // Allow agy print mode to invoke our local egovai-desktop MCP tools —
  // DesktopMcpServer itself enforces the interactive Vietnamese approval prompt for delete/insert actions.
  // When computer use is off for this run (e.g. unattended scheduled tasks), only the
  // ask-user tool is pre-approved; desktop control tools are not.
  const allowedTools = payload.computerUseEnabled
    ? DESKTOP_MCP_TOOLS
    : DESKTOP_MCP_TOOLS.filter((t) => t.name === 'desktop_ask_user')
  const sessionSettings = JSON.stringify({
    permissions: {
      allow: allowedTools.map((t) => `mcp(${DESKTOP_MCP_SERVER_NAME}/${t.name})`)
    }
  })

  // The prompt goes through stdin (stream-json input) instead of `-p <prompt>`:
  // Windows caps the command line at ~32k chars and argv is visible in the process list.
  const args: string[] = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--settings',
    sessionSettings
  ]

  // Khi bật chế độ Điều khiển máy tính (không ở chế độ plan chỉ đọc), truyền
  // --dangerously-skip-permissions để agy chạy mượt các tác vụ thao tác;
  // tầng MCP egovai-desktop vẫn chặn hỏi phê duyệt khi xóa hoặc nhập/insert dữ liệu.
  if (payload.computerUseEnabled && payload.mode !== 'plan') {
    args.push('--dangerously-skip-permissions')
  }

  if (payload.agyConversationId) {
    args.push('--conversation', payload.agyConversationId)
  }
  if (payload.modelId) {
    args.push('--model', payload.modelId)
  }
  if (payload.effort) {
    args.push('--effort', payload.effort)
  }
  if (payload.mode && payload.mode !== 'default') {
    args.push('--mode', payload.mode)
  }
  if (payload.useSandbox) {
    args.push('--sandbox')
  }
  if (payload.globalSkillDirs && payload.globalSkillDirs.length > 0) {
    const seenDirs = new Set<string>([payload.projectPath.toLowerCase()])
    for (const dir of payload.globalSkillDirs) {
      const key = dir.toLowerCase()
      if (!seenDirs.has(key)) {
        seenDirs.add(key)
        args.push('--add-dir', dir)
      }
    }
  }

  return args
}

export function buildSessionKey(binaryPath: string, payload: SendPromptPayload): string {
  const dirs = (payload.globalSkillDirs ?? [])
    .map((d) => d.toLowerCase())
    .sort()
  return JSON.stringify({
    binaryPath,
    projectPath: payload.projectPath.toLowerCase(),
    modelId: payload.modelId ?? '',
    effort: payload.effort ?? '',
    mode: payload.mode ?? 'default',
    useSandbox: Boolean(payload.useSandbox),
    computerUseEnabled: Boolean(payload.computerUseEnabled),
    globalSkillDirs: dirs
  })
}

interface ActiveTurn {
  messageId: string
  onEvent: (event: AgyStreamEvent) => void
  gotResultOrError: boolean
  /** Đã có ít nhất một bước công cụ hoàn tất trong lượt này (việc chính đã làm). */
  didWork: boolean
  /** Các lỗi quá tải đã thấy (khử trùng giữa stdout và nhật ký phiên). */
  seenOverloads: Set<string>
  fallbackStarted: boolean
  watchTimer: ReturnType<typeof setInterval> | null
  transcriptOffset: number
}

interface PersistentAgySession {
  conversationId: string
  child: ChildProcessWithoutNullStreams
  sessionKey: string
  binaryPath: string
  payload: SendPromptPayload
  agyConversationId?: string
  lastPreambleKey: string
  activeTurn: ActiveTurn | null
  lastUsedAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
  wasAborted: boolean
  stderrText: string
  /** Tiến trình chạy đúng một lượt rồi đóng (dùng cho lượt chuyển mô hình dự phòng). */
  oneShot: boolean
  /** Cho phép chuyển mô hình khi máy chủ quá tải (tắt cho chính lượt dự phòng). */
  allowFallback: boolean
}

export interface AgyAdapterOptions {
  /** Keep agy.exe alive across turns in the same conversation (default: true). */
  keepAlive?: boolean
  /** Max idle time in ms before closing an unused agy.exe worker (default: 10 minutes). */
  idleTtlMs?: number
  /** Max concurrent persistent agy.exe workers kept alive (default: 3). */
  maxSessions?: number
  /** Optional spawn override for testing. */
  spawnFn?: typeof spawn
  /** Optional binary resolver override for testing. */
  resolveBinaryFn?: (overridePath?: string) => Promise<string | null>
  /** Chuyển mô hình khi máy chủ báo quá tải (default: true). */
  overloadFallback?: boolean
  /** Chu kỳ đọc nhật ký phiên agy để phát hiện quá tải (default: 2000ms). */
  overloadPollMs?: number
  /** Thư mục brain của agy (default: ~/.gemini/antigravity-cli/brain). */
  brainRootDir?: string
  /** Danh sách mô hình khả dụng (default: chạy `agy models`). */
  listModelsFn?: (binaryPath: string) => Promise<Array<{ id: string }>>
}

const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_SESSIONS = 3
const DEFAULT_OVERLOAD_POLL_MS = 2000

async function listAgyModels(binaryPath: string): Promise<Array<{ id: string }>> {
  const { stdout } = await execFileAsync(binaryPath, ['models'], {
    timeout: 20000,
    windowsHide: true
  })
  return parseAgyModelsOutput(stdout)
}

function newTurn(messageId: string, onEvent: (event: AgyStreamEvent) => void): ActiveTurn {
  return {
    messageId,
    onEvent,
    gotResultOrError: false,
    didWork: false,
    seenOverloads: new Set(),
    fallbackStarted: false,
    watchTimer: null,
    transcriptOffset: 0
  }
}

export class AgyCliAdapter {
  private sessions = new Map<string, PersistentAgySession>()
  private readonly keepAlive: boolean
  private readonly idleTtlMs: number
  private readonly maxSessions: number
  private readonly spawnFn: typeof spawn
  private readonly resolveBinaryFn: (overridePath?: string) => Promise<string | null>
  private readonly overloadFallback: boolean
  private readonly overloadPollMs: number
  private readonly brainRootDir: string
  private readonly listModelsFn: (binaryPath: string) => Promise<Array<{ id: string }>>
  private modelsCache = new Map<string, Promise<Array<{ id: string }>>>()

  constructor(options?: AgyAdapterOptions) {
    this.keepAlive = options?.keepAlive ?? true
    this.idleTtlMs = options?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.spawnFn = options?.spawnFn ?? spawn
    this.resolveBinaryFn = options?.resolveBinaryFn ?? getAgyBinaryPath
    this.overloadFallback = options?.overloadFallback ?? true
    this.overloadPollMs = options?.overloadPollMs ?? DEFAULT_OVERLOAD_POLL_MS
    this.brainRootDir = options?.brainRootDir ?? defaultAgyBrainRoot()
    this.listModelsFn = options?.listModelsFn ?? listAgyModels
  }

  private getModels(binaryPath: string): Promise<Array<{ id: string }>> {
    let cached = this.modelsCache.get(binaryPath)
    if (!cached) {
      cached = this.listModelsFn(binaryPath).catch(() => {
        this.modelsCache.delete(binaryPath)
        return []
      })
      this.modelsCache.set(binaryPath, cached)
    }
    return cached
  }

  private clearIdleTimer(session: PersistentAgySession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  private scheduleIdleClose(session: PersistentAgySession): void {
    this.clearIdleTimer(session)
    if (!this.keepAlive || session.oneShot) {
      this.closeSessionGracefully(session)
      return
    }
    session.idleTimer = setTimeout(() => {
      if (!session.activeTurn && !session.closed) {
        this.closeSessionGracefully(session)
      }
    }, this.idleTtlMs)
    session.idleTimer.unref?.()
  }

  private closeSessionGracefully(session: PersistentAgySession): void {
    this.clearIdleTimer(session)
    if (this.sessions.get(session.conversationId) === session) {
      this.sessions.delete(session.conversationId)
    }
    if (session.closed) return
    session.closed = true
    try {
      if (session.child.stdin.writable) {
        session.child.stdin.end()
      }
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (session.child.exitCode === null && !session.child.killed) {
        try {
          session.child.kill('SIGTERM')
        } catch {
          try {
            session.child.kill()
          } catch {
            // ignore
          }
        }
      }
    }, 1500).unref?.()
  }

  /** Dừng ngay tiến trình của phiên (người dùng bấm Dừng, hoặc chuyển mô hình dự phòng). */
  private killSession(session: PersistentAgySession): void {
    this.clearIdleTimer(session)
    if (session.activeTurn) this.stopOverloadWatch(session.activeTurn)
    session.wasAborted = true
    session.closed = true
    session.activeTurn = null
    if (this.sessions.get(session.conversationId) === session) {
      this.sessions.delete(session.conversationId)
    }
    try {
      session.child.kill('SIGTERM')
    } catch {
      try {
        session.child.kill()
      } catch {
        // ignore
      }
    }
  }

  private evictIdleSessionIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) return
    let oldestIdle: PersistentAgySession | null = null
    for (const session of this.sessions.values()) {
      if (session.activeTurn) continue
      if (!oldestIdle || session.lastUsedAt < oldestIdle.lastUsedAt) {
        oldestIdle = session
      }
    }
    if (oldestIdle) {
      this.closeSessionGracefully(oldestIdle)
    }
  }

  private canReuseSession(
    session: PersistentAgySession,
    sessionKey: string,
    payload: SendPromptPayload
  ): boolean {
    if (!this.keepAlive) return false
    if (session.closed || session.activeTurn || session.oneShot) return false
    if (session.child.killed || session.child.exitCode !== null || !session.child.stdin.writable) {
      return false
    }
    if (session.sessionKey !== sessionKey) return false
    // Must match the core conversation ID; edit/resend clears agyConversationId to start a fresh thread.
    if (!payload.agyConversationId || !session.agyConversationId) return false
    if (payload.agyConversationId !== session.agyConversationId) return false
    return true
  }

  // ---- Phát hiện máy chủ quá tải & chuyển mô hình dự phòng ----

  private startOverloadWatch(session: PersistentAgySession, turn: ActiveTurn): void {
    if (turn.watchTimer || !session.agyConversationId) return
    const path = agyTranscriptPath(this.brainRootDir, session.agyConversationId)
    // Bỏ qua lỗi cũ của các lượt trước trong cùng hội thoại.
    turn.transcriptOffset = fileSizeOrZero(path)
    turn.watchTimer = setInterval(() => {
      if (session.activeTurn !== turn) {
        this.stopOverloadWatch(turn)
        return
      }
      const { errors, offset } = readNewOverloadErrors(path, turn.transcriptOffset)
      turn.transcriptOffset = offset
      for (const err of errors) this.handleOverload(session, turn, err)
    }, this.overloadPollMs)
    turn.watchTimer.unref?.()
  }

  private stopOverloadWatch(turn: ActiveTurn): void {
    if (turn.watchTimer) {
      clearInterval(turn.watchTimer)
      turn.watchTimer = null
    }
  }

  private emitStatus(
    session: PersistentAgySession,
    turn: ActiveTurn,
    message: string,
    modelId?: string
  ): void {
    turn.onEvent({
      type: 'status',
      conversationId: session.conversationId,
      messageId: turn.messageId,
      message,
      modelId
    })
  }

  private handleOverload(session: PersistentAgySession, turn: ActiveTurn, errorText: string): void {
    if (session.activeTurn !== turn) return
    const key = errorText.trim()
    if (turn.seenOverloads.has(key)) return
    turn.seenOverloads.add(key)

    const current = describeModel(session.payload.modelId)
    if (!this.overloadFallback || !session.allowFallback || turn.fallbackStarted) {
      this.emitStatus(
        session,
        turn,
        `Máy chủ mô hình ${current} đang quá tải — lõi AI đang tự thử lại (lần ${turn.seenOverloads.size}).`
      )
      return
    }

    turn.fallbackStarted = true
    const kind: FallbackKind = turn.didWork ? 'summary' : 'continue'
    this.emitStatus(
      session,
      turn,
      `Máy chủ mô hình ${current} đang quá tải — đang chuyển sang mô hình dự phòng…`
    )
    void this.startFallback(session, turn, kind)
  }

  private async startFallback(
    session: PersistentAgySession,
    turn: ActiveTurn,
    kind: FallbackKind
  ): Promise<void> {
    const models = await this.getModels(session.binaryPath)
    // Lượt có thể đã xong (lõi tự thử lại thành công) hoặc người dùng đã dừng trong lúc chờ.
    if (session.activeTurn !== turn || session.closed) return

    const current = session.payload.modelId
    const target =
      kind === 'summary'
        ? pickSummaryModel(current, models)
        : pickStrongFallbackModel(current, models)
    const agyConversationId = session.agyConversationId
    if (!target || !agyConversationId) {
      this.emitStatus(
        session,
        turn,
        `Không có mô hình dự phòng phù hợp — lõi AI đang tự thử lại với ${describeModel(current)}.`
      )
      return
    }

    this.killSession(session)

    this.emitStatus(
      session,
      turn,
      kind === 'summary'
        ? `Máy chủ ${describeModel(current)} quá tải sau khi đã làm xong việc chính — chuyển sang ${target} để viết phần tóm tắt.`
        : `Máy chủ ${describeModel(current)} quá tải — chuyển sang ${target} để xử lý tiếp.`,
      target
    )

    const fallbackPayload: SendPromptPayload = {
      ...session.payload,
      messageId: turn.messageId,
      modelId: target,
      agyConversationId,
      effort: effortForModel(target)
    }
    this.spawnWorker(session.binaryPath, fallbackPayload, buildFallbackPrompt(kind), turn.onEvent, {
      oneShot: true,
      allowFallback: false
    })
  }

  async sendPrompt(
    payload: SendPromptPayload,
    overrideBinaryPath: string | undefined,
    onEvent: (event: AgyStreamEvent) => void
  ): Promise<void> {
    const binaryPath = await this.resolveBinaryFn(overrideBinaryPath)
    if (!binaryPath) {
      onEvent({
        type: 'error',
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        error: 'Chưa cài đặt lõi AI (agy.exe). Vui lòng cài đặt trước khi trò chuyện.'
      })
      return
    }

    const sessionKey = buildSessionKey(binaryPath, payload)
    const preambleKey = computeSessionPreambleKey(payload)
    const existing = this.sessions.get(payload.conversationId)

    // Fast path: reuse warm persistent agy.exe worker for this conversation (~0ms startup overhead).
    if (existing && this.canReuseSession(existing, sessionKey, payload)) {
      this.clearIdleTimer(existing)
      const omitSessionPreamble = existing.lastPreambleKey === preambleKey
      existing.lastPreambleKey = preambleKey
      existing.lastUsedAt = Date.now()
      existing.stderrText = ''
      existing.payload = payload
      const turn = newTurn(payload.messageId, onEvent)
      existing.activeTurn = turn
      this.startOverloadWatch(existing, turn)
      const composedPrompt = buildComposedPrompt(payload, { omitSessionPreamble })
      existing.child.stdin.write(buildAgyStdinMessage(composedPrompt), 'utf8')
      return
    }

    // Close/abort any incompatible or busy worker for the same conversation before spawning a fresh one.
    if (existing) {
      if (existing.activeTurn) {
        this.abort(payload.conversationId)
      } else {
        this.closeSessionGracefully(existing)
      }
    }

    this.evictIdleSessionIfNeeded()

    this.spawnWorker(binaryPath, payload, buildComposedPrompt(payload), onEvent, {
      oneShot: !this.keepAlive,
      allowFallback: true,
      sessionKey,
      preambleKey
    })
  }

  private spawnWorker(
    binaryPath: string,
    payload: SendPromptPayload,
    composedPrompt: string,
    onEvent: (event: AgyStreamEvent) => void,
    opts: { oneShot: boolean; allowFallback: boolean; sessionKey?: string; preambleKey?: string }
  ): void {
    const args = buildAgyCliArgs(payload)

    const { binDir } = resolveAgentDesktopBinary()
    const currentPath = process.env.PATH ?? process.env.Path ?? ''
    const mergedPath = binDir ? `${binDir}${delimiter}${currentPath}` : currentPath

    const child = this.spawnFn(binaryPath, args, {
      cwd: payload.projectPath,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: mergedPath,
        Path: mergedPath,
        PYTHONIOENCODING: 'utf-8'
      }
    })

    const session: PersistentAgySession = {
      conversationId: payload.conversationId,
      child,
      sessionKey: opts.sessionKey ?? buildSessionKey(binaryPath, payload),
      binaryPath,
      payload,
      agyConversationId: payload.agyConversationId,
      lastPreambleKey: opts.preambleKey ?? computeSessionPreambleKey(payload),
      activeTurn: newTurn(payload.messageId, onEvent),
      lastUsedAt: Date.now(),
      idleTimer: null,
      closed: false,
      wasAborted: false,
      stderrText: '',
      oneShot: opts.oneShot,
      allowFallback: opts.allowFallback
    }

    this.sessions.set(payload.conversationId, session)
    // Ignore EPIPE if the CLI exits before reading stdin; the close handler reports the failure.
    child.stdin.on('error', () => {})

    const lineMsg = buildAgyStdinMessage(composedPrompt)
    if (opts.oneShot) {
      child.stdin.end(lineMsg, 'utf8')
    } else {
      child.stdin.write(lineMsg, 'utf8')
    }
    // Tiếp tục hội thoại cũ: đã biết mã hội thoại nên theo dõi quá tải ngay.
    if (session.activeTurn) this.startOverloadWatch(session, session.activeTurn)

    const buffer = new NdjsonLineBuffer()

    const finishTurn = (turn: ActiveTurn): void => {
      turn.gotResultOrError = true
      this.stopOverloadWatch(turn)
      session.activeTurn = null
    }

    const handleLine = (line: string): void => {
      const turn = session.activeTurn
      if (!turn) return
      const event = parseAgyNdjsonLine(line, payload.conversationId, turn.messageId)
      if (!event) return

      if (event.type === 'init') {
        if (event.agyConversationId) session.agyConversationId = event.agyConversationId
        this.startOverloadWatch(session, turn)
      }

      // Lỗi quá tải nếu lõi có báo ra stdout — xử lý giống như đọc từ nhật ký phiên.
      if (event.type === 'status' && isOverloadError(event.message)) {
        this.handleOverload(session, turn, event.message)
        return
      }

      if (event.type === 'tool_update' && event.toolCall.state === 'DONE') {
        turn.didWork = true
      }

      if (event.type === 'result') {
        if (event.agyConversationId) {
          session.agyConversationId = event.agyConversationId
        }
        finishTurn(turn)
        session.lastUsedAt = Date.now()
        this.scheduleIdleClose(session)
        turn.onEvent(event)
        return
      }

      if (event.type === 'error') {
        finishTurn(turn)
        turn.onEvent(event)
        this.closeSessionGracefully(session)
        return
      }

      turn.onEvent(event)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) {
        handleLine(line)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      session.stderrText += chunk
    })

    child.on('error', (err) => {
      this.clearIdleTimer(session)
      session.closed = true
      if (this.sessions.get(payload.conversationId) === session) {
        this.sessions.delete(payload.conversationId)
      }
      const turn = session.activeTurn
      if (turn) this.stopOverloadWatch(turn)
      session.activeTurn = null
      if (turn && !turn.gotResultOrError && !session.wasAborted) {
        turn.gotResultOrError = true
        turn.onEvent({
          type: 'error',
          conversationId: payload.conversationId,
          messageId: turn.messageId,
          error: `Không thể khởi chạy lõi AI: ${err.message}`
        })
      }
    })

    child.on('close', (code, signal) => {
      for (const line of buffer.flush()) {
        handleLine(line)
      }

      this.clearIdleTimer(session)
      session.closed = true
      if (this.sessions.get(payload.conversationId) === session) {
        this.sessions.delete(payload.conversationId)
      }

      const turn = session.activeTurn
      if (turn) this.stopOverloadWatch(turn)
      session.activeTurn = null

      if (!turn || signal === 'SIGTERM' || signal === 'SIGKILL' || session.wasAborted) {
        return
      }

      if (!turn.gotResultOrError) {
        if (code === 0) {
          turn.onEvent({
            type: 'result',
            conversationId: payload.conversationId,
            messageId: turn.messageId,
            agyConversationId: session.agyConversationId,
            status: 'SUCCESS'
          })
        } else {
          const cleanErr =
            session.stderrText.trim() || `Tiến trình lõi AI thoát với mã lỗi ${code}.`
          turn.onEvent({
            type: 'error',
            conversationId: payload.conversationId,
            messageId: turn.messageId,
            error: cleanErr
          })
        }
      }
    })

    child.once('exit', (_code, signal) => {
      if (signal) session.wasAborted = true
    })
  }

  abort(conversationId: string): boolean {
    const session = this.sessions.get(conversationId)
    if (!session) return false
    this.killSession(session)
    return true
  }

  abortAll(): void {
    for (const conversationId of Array.from(this.sessions.keys())) {
      this.abort(conversationId)
    }
  }
}
