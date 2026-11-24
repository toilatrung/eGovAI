import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { delimiter } from 'path'
import type { AgyStreamEvent, SendPromptPayload } from '../../shared/types'
import { formatAgencyProfileSummary } from '../../shared/agencyProfile'
import { resolveAgentDesktopBinary } from '../services/computerUseService'
import { DESKTOP_MCP_SERVER_NAME, DESKTOP_MCP_TOOLS } from '../services/desktopMcpServer'
import { getAgyBinaryPath } from './agyBinary'
import { NdjsonLineBuffer, parseAgyNdjsonLine } from './ndjsonParser'

export function buildComposedPrompt(payload: SendPromptPayload): string {
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

  if (payload.computerUseEnabled) {
    const isMediumOrHigherEffort =
      !payload.effort || ['medium', 'high', 'xhigh', 'max'].includes(payload.effort)
    const speedRule = isMediumOrHigherEffort
      ? ' (5) TỐC ĐỘ THAO TÁC: Không suy luận dài dòng giữa các bước giao diện — hãy lập kế hoạch một lần ở đầu việc, gom tối đa các bước đoán trước được vào `desktop_batch` rồi thực thi gọn.'
      : ''
    sections.push(
      '[Chế độ Điều khiển máy tính ĐANG BẬT (máy chủ MCP `egovai-desktop` tích hợp Playwright + agent-desktop v1.3.1 + chụp ảnh màn hình): QUY TẮC TỐI ƯU NHANH & CHÍNH XÁC: ' +
        '(1) PHẠM VI DUYỆT THEO VIỆC: Với tác vụ nhiều bước trên ứng dụng desktop (VD: Zalo, Word, Excel), gọi `desktop_request_scope({ apps, purpose })` MỘT LẦN ở đầu việc để click/focus/scroll/snapshot/screenshot trong ứng dụng đó chạy mượt không hỏi lại (nhập nội dung, Enter/nút gửi-xác nhận và xóa vẫn hỏi lại). ' +
        '(2) GOM THAO TÁC (`desktop_batch`): Luôn gom các bước đoán trước được vào 1 lệnh `desktop_batch` (VD: mở Notepad + chờ + gõ chữ: `[{action:"launch_app",app:"notepad.exe"},{action:"wait",ms:700},{action:"type",text:"xin chào"}]`) để giảm số lượt gọi mô hình; `desktop_batch` tự trả kèm trạng thái cuối nên không cần gọi thêm `desktop_snapshot`. ' +
        '(3) UIA TRƯỚC, ẢNH MÀN HÌNH DỰ PHÒNG: Ưu tiên `desktop_find` / cây UIA trước; nếu ứng dụng Electron (Zalo, Teams...) có cây UIA nghèo/thiếu phần tử thì dùng ngay `desktop_screenshot` (kèm `desktop_zoom` nếu chữ nhỏ) rồi dùng `desktop_click_at` theo tọa độ ảnh và `desktop_batch` (`type` không cần @ref sẽ nhập thẳng tiếng Việt vào ô đang focus). ' +
        '(4) TÁC VỤ WEB: Ưu tiên Playwright (`web_open`, `web_snapshot`, `web_read_text`, `web_click`, `web_fill`, `web_close`). KHÔNG chạy chrome.exe hay agent-desktop qua run_command.' +
        speedRule +
        ']'
    )
  }

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

export class AgyCliAdapter {
  private activeProcesses = new Map<string, ChildProcessWithoutNullStreams>()

  async sendPrompt(
    payload: SendPromptPayload,
    overrideBinaryPath: string | undefined,
    onEvent: (event: AgyStreamEvent) => void
  ): Promise<void> {
    const binaryPath = await getAgyBinaryPath(overrideBinaryPath)
    if (!binaryPath) {
      onEvent({
        type: 'error',
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        error: 'Chưa cài đặt lõi AI (agy.exe). Vui lòng cài đặt trước khi trò chuyện.'
      })
      return
    }

    // Abort any running process for the same conversation before starting a new turn
    this.abort(payload.conversationId)

    const composedPrompt = buildComposedPrompt(payload)
    const args = buildAgyCliArgs(payload)

    const { binDir } = resolveAgentDesktopBinary()
    const currentPath = process.env.PATH ?? process.env.Path ?? ''
    const mergedPath = binDir ? `${binDir}${delimiter}${currentPath}` : currentPath

    const child = spawn(binaryPath, args, {
      cwd: payload.projectPath,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: mergedPath,
        Path: mergedPath,
        PYTHONIOENCODING: 'utf-8'
      }
    })

    this.activeProcesses.set(payload.conversationId, child)
    // Ignore EPIPE if the CLI exits before reading stdin; the close handler reports the failure.
    child.stdin.on('error', () => {})
    child.stdin.end(buildAgyStdinMessage(composedPrompt), 'utf8')
    const buffer = new NdjsonLineBuffer()
    let stderrText = ''
    let gotResultOrError = false
    let wasAborted = false

    const handleLine = (line: string): void => {
      const event = parseAgyNdjsonLine(line, payload.conversationId, payload.messageId)
      if (!event) return
      if (event.type === 'result' || event.type === 'error') {
        gotResultOrError = true
      }
      onEvent(event)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) {
        handleLine(line)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrText += chunk
    })

    child.on('error', (err) => {
      this.activeProcesses.delete(payload.conversationId)
      if (!gotResultOrError && !wasAborted) {
        gotResultOrError = true
        onEvent({
          type: 'error',
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          error: `Không thể khởi chạy lõi AI: ${err.message}`
        })
      }
    })

    child.on('close', (code, signal) => {
      for (const line of buffer.flush()) {
        handleLine(line)
      }

      const stillActive = this.activeProcesses.get(payload.conversationId) === child
      if (stillActive) {
        this.activeProcesses.delete(payload.conversationId)
      }

      if (signal === 'SIGTERM' || signal === 'SIGKILL' || wasAborted) {
        return
      }

      if (!gotResultOrError) {
        if (code === 0) {
          onEvent({
            type: 'result',
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            status: 'SUCCESS'
          })
        } else {
          const cleanErr = stderrText.trim() || `Tiến trình lõi AI thoát với mã lỗi ${code}.`
          onEvent({
            type: 'error',
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            error: cleanErr
          })
        }
      }
    })

    // Mark abort flag if killed via abort()
    child.once('exit', (_code, signal) => {
      if (signal) wasAborted = true
    })
  }

  abort(conversationId: string): boolean {
    const proc = this.activeProcesses.get(conversationId)
    if (!proc) return false
    this.activeProcesses.delete(conversationId)
    try {
      proc.kill('SIGTERM')
    } catch {
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }
    return true
  }

  abortAll(): void {
    for (const conversationId of Array.from(this.activeProcesses.keys())) {
      this.abort(conversationId)
    }
  }
}
