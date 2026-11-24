import http from 'http'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { shell } from 'electron'
import { getAgyBinaryPath } from '../agent/agyBinary'
import { execAgentDesktopArgs } from './computerUseService'
import type { InteractionManager } from './interactionManager'
import { PlaywrightWebService } from './playwrightService'
import { ScreenCaptureService } from './screenCaptureService'
import {
  SESSION_ALLOW_SCOPE_TEXT,
  canSkipApprovalForScope,
  classifyDesktopAction,
  describeDesktopAction,
  markUntrustedWebContent,
  type DesktopBatchStep
} from './desktopActionPolicy'

const execFileAsync = promisify(execFile)

export const DESKTOP_MCP_SERVER_NAME = 'egovai-desktop'
export const PREFERRED_DESKTOP_MCP_PORT = 47821

export interface AgyMcpListEntry {
  name: string
  type: string
  status: string
  target: string
}

/** Phân tích bảng kết quả của lệnh `agy mcp list`. */
export function parseAgyMcpList(stdout: string): AgyMcpListEntry[] {
  const entries: AgyMcpListEntry[] = []
  const lines = stdout.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^NAME\s+TYPE\s+STATUS/i.test(line) || /^[-=]+$/.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    entries.push({
      name: parts[0],
      type: parts[1].toLowerCase(),
      status: parts[2].toLowerCase(),
      target: parts.slice(3).join(' ')
    })
  }
  return entries
}

export interface AgyMcpRunner {
  execAgy: (args: string[]) => Promise<{ stdout: string; stderr: string }>
  readConfigFile?: () => string | null
}

function defaultReadAgyMcpConfig(): string | null {
  const candidates = [
    join(homedir(), '.gemini', 'config', 'mcp_config.json'),
    join(homedir(), '.gemini', 'antigravity-cli', 'mcp_config.json')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        // try next
      }
    }
  }
  return null
}

/**
 * Kiểm tra xem đăng ký `egovai-desktop` trong `agy` đã khớp đúng URL và Bearer token hiện tại chưa.
 * Trả về true nếu khớp hoàn toàn, false nếu thiếu, bị tắt hoặc lệch cổng/mã xác thực.
 */
export async function verifyAgyMcpRegistration(
  expectedUrl: string,
  expectedToken: string,
  runner: AgyMcpRunner
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { stdout } = await runner.execAgy(['mcp', 'list'])
    const entries = parseAgyMcpList(stdout)
    const found = entries.find((e) => e.name === DESKTOP_MCP_SERVER_NAME)
    if (!found) return { valid: false, reason: 'Chưa đăng ký trong agy mcp list' }
    if (found.status !== 'enabled') return { valid: false, reason: `Trạng thái đang là ${found.status}` }
    if (found.target.trim() !== expectedUrl.trim()) {
      return { valid: false, reason: `Địa chỉ cũ (${found.target}) khác hiện tại (${expectedUrl})` }
    }

    const readCfg = runner.readConfigFile ?? defaultReadAgyMcpConfig
    const rawCfg = readCfg()
    if (rawCfg) {
      try {
        const parsed = JSON.parse(rawCfg) as {
          mcpServers?: Record<
            string,
            { serverUrl?: string; url?: string; headers?: Record<string, string>; disabled?: boolean }
          >
        }
        const entry = parsed.mcpServers?.[DESKTOP_MCP_SERVER_NAME]
        if (entry) {
          if (entry.disabled) return { valid: false, reason: 'Cấu hình MCP đang bị vô hiệu hóa' }
          const cfgUrl = entry.serverUrl || entry.url || ''
          if (cfgUrl && cfgUrl !== expectedUrl) {
            return { valid: false, reason: 'URL trong mcp_config.json không khớp' }
          }
          const authHeader = entry.headers?.Authorization || entry.headers?.authorization || ''
          if (authHeader !== `Bearer ${expectedToken}`) {
            return { valid: false, reason: 'Mã xác thực Bearer trong mcp_config.json đã cũ' }
          }
        }
      } catch {
        // Nếu không parse được JSON config thì ưu tiên đăng ký lại cho chắc chắn
        return { valid: false, reason: 'Không đọc được tệp cấu hình MCP' }
      }
    }

    return { valid: true }
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Kiểm tra và tự động gỡ/đăng ký lại MCP `egovai-desktop` với `agy` nếu lệch cổng hoặc mã xác thực.
 */
export async function syncAgyMcpRegistration(
  expectedUrl: string,
  expectedToken: string,
  runner: AgyMcpRunner
): Promise<{ ok: boolean; reregistered: boolean; reason?: string }> {
  const check = await verifyAgyMcpRegistration(expectedUrl, expectedToken, runner)
  if (check.valid) {
    return { ok: true, reregistered: false }
  }

  try {
    await runner.execAgy(['mcp', 'remove', DESKTOP_MCP_SERVER_NAME]).catch(() => undefined)
    await runner.execAgy([
      'mcp',
      'add',
      '--type',
      'http',
      '--header',
      `Authorization: Bearer ${expectedToken}`,
      DESKTOP_MCP_SERVER_NAME,
      expectedUrl
    ])
    const after = await verifyAgyMcpRegistration(expectedUrl, expectedToken, runner)
    return {
      ok: after.valid,
      reregistered: true,
      reason: after.valid ? check.reason : after.reason
    }
  } catch (err) {
    return {
      ok: false,
      reregistered: true,
      reason: err instanceof Error ? err.message : String(err)
    }
  }
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const DESKTOP_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'desktop_ask_user',
    description:
      'Hiện thanh Interactive Prompt ngay trên khung chat để hỏi ý kiến người dùng, xin phê duyệt kế hoạch/thao tác, chọn phương án hoặc yêu cầu bổ sung ngữ cảnh/hồ sơ còn thiếu.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['question', 'approval'],
          description: 'question: hỏi ý kiến/bổ sung ngữ cảnh; approval: xin phê duyệt thực hiện.'
        },
        title: { type: 'string', description: 'Tiêu đề ngắn gọn bằng Tiếng Việt.' },
        message: { type: 'string', description: 'Nội dung câu hỏi hoặc mô tả chi tiết.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Danh sách phương án gợi ý để người dùng bấm chọn nhanh (tùy chọn).'
        },
        allowMultiple: {
          type: 'boolean',
          description: 'Cho phép chọn nhiều phương án cùng lúc (mặc định false).'
        }
      },
      required: ['title', 'message']
    }
  },
  {
    name: 'web_open',
    description:
      'Mở một trang web bằng Playwright trên cửa sổ Chrome/Edge thật đang hiển thị cho người dùng và trả về ngay tiêu đề, nội dung trích lược cùng danh sách mã phần tử (@w1, @w2...) để bấm/điền trực tiếp. LUÔN ưu tiên cho mọi tác vụ tra cứu web, tìm kiếm Google, Cổng VBPL, điền biểu mẫu trực tuyến.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Đường dẫn URL bắt đầu bằng http:// hoặc https://' }
      },
      required: ['url']
    }
  },
  {
    name: 'web_snapshot',
    description:
      'Đọc lại trạng thái hiện tại của trang web đang mở trong Playwright (URL, tiêu đề, nội dung trích lược và mã @w1, @w2... của các nút/ô nhập/liên kết).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'web_read_text',
    description:
      'Trích xuất toàn bộ nội dung văn bản sạch của trang web đang mở (rất phù hợp để đọc toàn văn nghị định, thông tư, công văn, bài viết).',
    inputSchema: {
      type: 'object',
      properties: {
        maxChars: { type: 'number', description: 'Số ký tự tối đa cần lấy (mặc định 12000).' }
      }
    }
  },
  {
    name: 'web_click',
    description:
      'Bấm vào một liên kết, nút bấm hoặc phần tử trên trang web Playwright theo mã @wN (từ web_open / web_snapshot) hoặc CSS selector, rồi trả về snapshot trang sau khi bấm.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Mã @w1, @w2... hoặc CSS selector.' }
      },
      required: ['ref']
    }
  },
  {
    name: 'web_fill',
    description:
      'Điền nội dung vào ô nhập liệu/tìm kiếm (hoặc chọn dropdown select) trên trang web Playwright theo mã @wN, hỗ trợ pressEnter: true để tìm kiếm/gửi ngay trong 1 bước.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Mã @w1, @w2... của ô nhập liệu.' },
        value: { type: 'string', description: 'Giá trị cần nhập hoặc nhãn mục cần chọn.' },
        pressEnter: {
          type: 'boolean',
          description: 'Nhấn Enter ngay sau khi nhập (mặc định false).'
        }
      },
      required: ['ref', 'value']
    }
  },
  {
    name: 'web_close',
    description: 'Đóng cửa sổ trình duyệt Playwright sau khi hoàn thành tác vụ web.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'desktop_open_url',
    description:
      'Mở trực tiếp địa chỉ web (URL https:// hoặc http://) trên Google Chrome hoặc trình duyệt mặc định ngay trên màn hình người dùng. Luôn dùng công cụ này khi cần mở web/tìm kiếm Google thay vì tự điều khiển thanh địa chỉ.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Đường dẫn URL cần mở.' },
        preferChrome: {
          type: 'boolean',
          description: 'Ưu tiên mở bằng Google Chrome (mặc định true).'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'desktop_launch_app',
    description:
      'Mở và đưa lên trước một ứng dụng Windows (VD: chrome, notepad, winword, excel, calc, hoặc đường dẫn .exe) trực tiếp trên màn hình người dùng.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Tên ứng dụng hoặc đường dẫn tệp thực thi.' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tham số dòng lệnh tùy chọn.'
        }
      },
      required: ['app']
    }
  },
  {
    name: 'desktop_list_windows',
    description:
      'Liệt kê nhanh các cửa sổ Windows đang mở (app, title, window_id) bằng agent-desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Lọc theo tên ứng dụng (tùy chọn).' }
      }
    }
  },
  {
    name: 'desktop_find',
    description:
      'Tìm trực tiếp phần tử giao diện (@ref) theo tên, vai trò (button, edit, menuitem...) hoặc văn bản trên một cửa sổ ứng dụng — NHANH và GỌN hơn nhiều so với chụp toàn bộ snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Tên tiến trình/ứng dụng (VD: chrome.exe, notepad.exe, WINWORD.EXE).' },
        name: { type: 'string', description: 'Tên hiển thị hoặc nhãn phần tử cần tìm.' },
        role: { type: 'string', description: 'Vai trò UI (VD: button, edit, text, link, menuitem).' },
        text: { type: 'string', description: 'Nội dung chữ bên trong phần tử.' }
      }
    }
  },
  {
    name: 'desktop_snapshot',
    description:
      'Chụp cây giao diện tương tác (-i) của một cửa sổ Windows bằng agent-desktop (tự đặt timeout chờ Chromium/Electron ổn định và giới hạn độ sâu để phản hồi nhanh).',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Tên ứng dụng (lấy từ desktop_list_windows).' },
        windowId: { type: 'string', description: 'ID cửa sổ cụ thể (tùy chọn).' },
        maxDepth: { type: 'number', description: 'Độ sâu tối đa (mặc định 6 để gọn & nhanh).' },
        interactiveOnly: {
          type: 'boolean',
          description: 'Chỉ trả về phần tử tương tác (mặc định true).'
        }
      }
    }
  },
  {
    name: 'desktop_click',
    description:
      'Nhấp chuột vào phần tử theo @ref (tự động hỗ trợ cả semantic lẫn --headed vật lý trên Windows).',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Mã @ref của phần tử (VD: @s123:e4).' },
        headed: {
          type: 'boolean',
          description: 'Dùng --headed vật lý nếu phần tử không hỗ trợ semantic click (mặc định true để ổn định trên Windows).'
        },
        doubleClick: {
          type: 'boolean',
          description: 'Nhấp đúp chuột (double-click, mặc định false).'
        }
      },
      required: ['ref']
    }
  },
  {
    name: 'desktop_set_value',
    description:
      'Nhập văn bản vào ô nhập liệu theo @ref (tự động thử set-value rồi fallback sang --headed focus + type trên Windows) và có thể nhấn Enter ngay trong cùng 1 bước.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Mã @ref của ô nhập liệu.' },
        value: { type: 'string', description: 'Nội dung cần nhập.' },
        pressEnter: {
          type: 'boolean',
          description: 'Tự động nhấn Enter (return) ngay sau khi nhập (mặc định false).'
        }
      },
      required: ['ref', 'value']
    }
  },
  {
    name: 'desktop_press_key',
    description:
      'Đưa cửa sổ ứng dụng lên trước (nếu truyền app) và nhấn phím hoặc tổ hợp phím chuẩn Windows (VD: return, escape, tab, ctrl+c, ctrl+v, ctrl+s, ctrl+l).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Phím hoặc tổ hợp phím (Enter tự quy đổi sang return).' },
        app: { type: 'string', description: 'Tên ứng dụng cần focus trước khi nhấn phím (tùy chọn).' }
      },
      required: ['key']
    }
  },
  {
    name: 'desktop_request_scope',
    description:
      'Xin người dùng phê duyệt phạm vi điều khiển cho 1 việc (chỉ hỏi 1 lần ở đầu việc). Sau khi duyệt, các thao tác mở ứng dụng trong phạm vi, click thường, focus, scroll, snapshot, screenshot trong ứng dụng đó chạy mượt không hỏi lại. Gõ/nhập nội dung, Enter/nút gửi-xác nhận và xóa vẫn luôn hỏi lại.',
    inputSchema: {
      type: 'object',
      properties: {
        apps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Danh sách ứng dụng cần điều khiển (VD: ["Zalo"], ["notepad.exe"]).'
        },
        purpose: {
          type: 'string',
          description: 'Mục đích ngắn gọn bằng tiếng Việt (VD: "gửi tin nhắn hello vào My Documents").'
        }
      },
      required: ['apps', 'purpose']
    }
  },
  {
    name: 'desktop_batch',
    description:
      'Thực thi tuần tự một mảng thao tác desktop trong 1 lần gọi (dừng ở lỗi đầu tiên), chỉ xin phê duyệt 1 lần cho cả lô, và tự trả về trạng thái cuối (cây UIA rút gọn và tùy chọn ảnh chụp màn hình). Rất nhanh cho chuỗi thao tác đoán trước được (VD: mở Notepad + chờ + gõ chữ).',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'Tên ứng dụng đích chính (VD: "notepad.exe", "Zalo").'
        },
        steps: {
          type: 'array',
          description: 'Mảng các thao tác thực hiện tuần tự.',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: [
                  'click',
                  'click_at',
                  'set_value',
                  'press_key',
                  'type',
                  'focus',
                  'scroll',
                  'wait',
                  'launch_app'
                ]
              },
              ref: { type: 'string', description: 'Mã @ref (cho click, set_value, type, focus, scroll).' },
              x: { type: 'number', description: 'Tọa độ X trên ảnh chụp gần nhất (cho click_at).' },
              y: { type: 'number', description: 'Tọa độ Y trên ảnh chụp gần nhất (cho click_at).' },
              value: { type: 'string', description: 'Giá trị cần đặt (cho set_value).' },
              text: { type: 'string', description: 'Văn bản cần gõ/nhập (cho type; hỗ trợ tiếng Việt UTF-8 cả khi không có @ref).' },
              key: { type: 'string', description: 'Phím cần nhấn (cho press_key, VD: return, escape, ctrl+f).' },
              app: { type: 'string', description: 'Tên ứng dụng (cho launch_app, focus, press_key).' },
              label: { type: 'string', description: 'Mô tả nút/mục tiêu đang bấm (tùy chọn).' },
              direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
              amount: { type: 'number', description: 'Số nấc cuộn (cho scroll).' },
              ms: { type: 'number', description: 'Thời gian chờ tính bằng mili-giây (cho wait).' },
              doubleClick: { type: 'boolean' },
              pressEnter: { type: 'boolean', description: 'Nhấn Enter sau set_value hoặc type.' },
              args: { type: 'array', items: { type: 'string' }, description: 'Tham số khởi chạy cho launch_app.' }
            },
            required: ['action']
          }
        },
        includeSnapshot: {
          type: 'boolean',
          description: 'Chụp cây UIA rút gọn sau khi xong (mặc định true).'
        },
        includeScreenshot: {
          type: 'boolean',
          description: 'Đính kèm ảnh chụp màn hình JPEG sau khi xong (mặc định false; nên bật true với app Electron như Zalo).'
        }
      },
      required: ['steps']
    }
  },
  {
    name: 'desktop_screenshot',
    description:
      'Chụp ảnh màn hình cửa sổ ứng dụng hoặc toàn màn hình (thu nhỏ cạnh dài tối đa 1280px, nén JPEG 70%) trả về dạng ảnh MCP kèm khung tọa độ. Dùng khi cây UIA thiếu phần tử (app Electron như Zalo, Teams).',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'Tên ứng dụng/cửa sổ cần chụp (bỏ trống để chụp toàn màn hình chính).'
        },
        maxEdge: {
          type: 'number',
          description: 'Cạnh dài tối đa theo pixel (mặc định 1280).'
        }
      }
    }
  },
  {
    name: 'desktop_zoom',
    description:
      'Phóng to và chụp lại một vùng [x0, y0, x1, y1] theo tọa độ của ảnh desktop_screenshot gần nhất ở độ phân giải cao hơn để đọc rõ chữ nhỏ hoặc bấm chính xác.',
    inputSchema: {
      type: 'object',
      properties: {
        box: {
          type: 'array',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 4,
          description: 'Vùng chọn [x0, y0, x1, y1] trong hệ tọa độ của ảnh chụp gần nhất.'
        },
        maxEdge: {
          type: 'number',
          description: 'Cạnh dài tối đa (mặc định 1280).'
        }
      },
      required: ['box']
    }
  },
  {
    name: 'desktop_click_at',
    description:
      'Nhấp chuột tại tọa độ (x, y) theo khung của ảnh desktop_screenshot / desktop_zoom gần nhất (tự quy đổi tỉ lệ và DPI ra tọa độ màn hình thật). Dùng dự phòng khi cây UIA không có @ref (VD: Zalo, Teams).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Tọa độ X trên ảnh chụp gần nhất.' },
        y: { type: 'number', description: 'Tọa độ Y trên ảnh chụp gần nhất.' },
        app: { type: 'string', description: 'Tên ứng dụng đang thao tác (tùy chọn).' },
        label: { type: 'string', description: 'Mô tả ngắn phần tử đang bấm (VD: "ô tìm kiếm", "My Documents").' },
        doubleClick: { type: 'boolean', description: 'Nhấp đúp chuột (mặc định false).' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Nút chuột (mặc định left).' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'desktop_run_agent_desktop',
    description:
      'Chạy trực tiếp bất kỳ lệnh con nào của agent-desktop (VD: ["--headed", "restore", "--app", "chrome.exe"], ["clipboard-get"], ["batch", ...]) trên phiên desktop tương tác.',
    inputSchema: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Danh sách tham số truyền cho agent-desktop.'
        }
      },
      required: ['args']
    }
  }
]

/** Ứng dụng/cửa sổ AI thao tác gần nhất — chỉ để hiển thị gợi ý trong thanh phê duyệt. */
let lastTargetApp: string | null = null

function rememberTargetApp(toolName: string, args: Record<string, unknown>): void {
  const app = typeof args.app === 'string' ? args.app.trim() : ''
  if (app && toolName !== 'desktop_list_windows') lastTargetApp = app
}

export function normalizeAgentDesktopKey(key: string): string {
  return key
    .trim()
    .split('+')
    .map((part) => {
      const lower = part.trim().toLowerCase()
      if (lower === 'enter') return 'return'
      if (lower === 'esc') return 'escape'
      if (lower === 'del') return 'delete'
      if (lower === 'control') return 'ctrl'
      return lower
    })
    .join('+')
}


function findChromeExe(): string | null {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : ''
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function isAgentDesktopOk(stdout: string): boolean {
  try {
    const start = stdout.indexOf('{')
    const end = stdout.lastIndexOf('}')
    if (start === -1 || end === -1) return false
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as { ok?: boolean }
    return parsed.ok === true
  } catch {
    return false
  }
}

interface ToolExecutionResult {
  text: string
  images?: Array<{ data: string; mimeType: string }>
  isError?: boolean
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pasteTextViaClipboard(text: string): Promise<string> {
  try {
    const clipRes = await execAgentDesktopArgs(['clipboard-set', text])
    if (!isAgentDesktopOk(clipRes.stdout)) {
      throw new Error('clipboard-set not ok')
    }
  } catch {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($env:EGOV_CLIP_TEXT)'
      ],
      {
        timeout: 8000,
        windowsHide: true,
        env: { ...process.env, EGOV_CLIP_TEXT: text }
      }
    )
  }
  await sleepMs(60)
  const pasted = await execAgentDesktopArgs(['--headed', 'press', 'ctrl+v'])
  return pasted.stdout.trim() || 'Đã nhập văn bản vào ô đang focus.'
}

async function launchWindowsApp(appName: string, extraArgs: string[] = []): Promise<string> {
  const lower = appName.toLowerCase()
  if (lower === 'chrome' || lower === 'google chrome') {
    const chromePath = findChromeExe()
    if (chromePath) {
      spawn(chromePath, extraArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      }).unref()
      return `Đã khởi chạy Google Chrome (${chromePath}).`
    }
  }

  try {
    const res = await execAgentDesktopArgs(['--headed', 'launch', appName, '--activate'])
    if (isAgentDesktopOk(res.stdout)) {
      return res.stdout.trim()
    }
  } catch {
    // fallback below
  }

  spawn('cmd.exe', ['/c', 'start', '', appName, ...extraArgs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref()
  return `Đã khởi chạy ứng dụng ${appName} trực tiếp trên Windows desktop.`
}

async function executeDesktopTool(
  toolName: string,
  args: Record<string, unknown>,
  interactions?: InteractionManager,
  webService?: PlaywrightWebService,
  screenCapture?: ScreenCaptureService
): Promise<ToolExecutionResult> {
  try {
    if (toolName === 'desktop_ask_user') {
      if (!interactions) {
        return { text: 'Không có kênh hỏi đáp tương tác đang hoạt động.', isError: true }
      }
      const kind = args.kind === 'approval' ? 'approval' : 'question'
      const title = String(args.title ?? 'Yêu cầu xác nhận từ trợ lý AI')
      const message = String(args.message ?? '')
      const options = Array.isArray(args.options) ? args.options.map(String) : undefined
      const allowMultiple = Boolean(args.allowMultiple)

      const userResp =
        kind === 'approval'
          ? await interactions.requestApproval({
              title,
              message,
              toolName,
              risk: classifyDesktopAction(toolName, args),
              details: { scopeNote: SESSION_ALLOW_SCOPE_TEXT }
            })
          : await interactions.requestQuestion({ title, message, options, allowMultiple })

      const parts: string[] = [
        userResp.approved ? 'Người dùng ĐÃ PHÊ DUYỆT / PHẢN HỒI.' : 'Người dùng TỪ CHỐI / HỦY.'
      ]
      if (userResp.selectedOptions && userResp.selectedOptions.length > 0) {
        parts.push(`Phương án đã chọn: ${userResp.selectedOptions.join('; ')}`)
      }
      if (userResp.contextNote && userResp.contextNote.trim()) {
        parts.push(`Ngữ cảnh / ý kiến bổ sung của người dùng: ${userResp.contextNote.trim()}`)
      }
      if (userResp.attachedFiles && userResp.attachedFiles.length > 0) {
        parts.push(
          `Tệp người dùng đính kèm bổ sung:\n${userResp.attachedFiles.map((f) => `- ${f}`).join('\n')}`
        )
      }
      return { text: parts.join('\n') }
    }

    if (toolName === 'desktop_request_scope') {
      if (!interactions) {
        return { text: 'Không có kênh phê duyệt tương tác đang hoạt động.', isError: true }
      }
      const rawApps = Array.isArray(args.apps) ? args.apps.map(String).filter(Boolean) : []
      const purpose = String(args.purpose ?? '').trim()
      if (rawApps.length === 0) {
        return { text: 'Thiếu danh sách ứng dụng (apps) cần xin phạm vi điều khiển.', isError: true }
      }
      const desc = describeDesktopAction(toolName, args)
      const decision = await interactions.requestScopeApproval({
        apps: rawApps,
        purpose: purpose || 'thực hiện yêu cầu của bạn',
        lines: desc.lines
      })
      if (!decision.approved) {
        const reason = decision.contextNote?.trim()
          ? ` Lý do: ${decision.contextNote.trim()}`
          : ''
        return {
          text: `Người dùng đã TỪ CHỐI cấp phạm vi điều khiển ${rawApps.join(', ')}.${reason}`,
          isError: true
        }
      }
      lastTargetApp = rawApps[0]
      const note = decision.contextNote?.trim()
        ? `\nGhi chú bổ sung từ người dùng: ${decision.contextNote.trim()}`
        : ''
      return {
        text:
          `Đã được người dùng cấp phạm vi điều khiển [${rawApps.join(', ')}] (hiệu lực đến hết lượt này hoặc 10 phút). ` +
          `Các thao tác mở ứng dụng trong phạm vi, click thường, focus, scroll, snapshot, screenshot sẽ chạy không hỏi lại; gõ/nhập nội dung, Enter/gửi-xác nhận và xóa vẫn hỏi lại.${note}`
      }
    }

    let userExtraNote = ''
    let targetLabel = typeof args.label === 'string' ? args.label.trim() : ''
    if (toolName === 'web_click' && webService && typeof args.ref === 'string' && args.ref.trim()) {
      targetLabel = (await webService.inspectElementLabel(args.ref.trim())) || targetLabel
    }
    const activeScope = interactions?.getActiveScope() ?? null
    const policyCtx = {
      scope: activeScope,
      lastTargetApp: lastTargetApp ?? screenCapture?.getLastFrame()?.app ?? null,
      targetLabel
    }
    const risk = classifyDesktopAction(toolName, args, policyCtx)
    const skipForScope = canSkipApprovalForScope(toolName, args, policyCtx)

    if (risk !== 'read' && !skipForScope && !interactions) {
      // Không có kênh phê duyệt → không bao giờ thực thi thao tác thay đổi máy tính.
      return {
        text: `Không thể xin phê duyệt cho thao tác ${toolName} — đã chặn.`,
        isError: true
      }
    }
    if (interactions && risk !== 'read' && !skipForScope) {
      const desc = describeDesktopAction(toolName, args, policyCtx)
      const decision = await interactions.requestApproval({
        title: desc.title,
        message: desc.message,
        toolName,
        risk,
        details: {
          summary: desc.lines,
          scopeNote: SESSION_ALLOW_SCOPE_TEXT,
          args: desc.safeArgs
        }
      })
      if (!decision.approved) {
        const reason = decision.contextNote?.trim()
          ? ` Lý do / yêu cầu của người dùng: ${decision.contextNote.trim()}`
          : ''
        return {
          text: `Người dùng đã TỪ CHỐI thao tác ${toolName}.${reason}`,
          isError: true
        }
      }
      if (decision.contextNote?.trim()) {
        userExtraNote = `\n[Ghi chú bổ sung từ người dùng: ${decision.contextNote.trim()}]`
      }
    }
    rememberTargetApp(toolName, args)

    switch (toolName) {
      case 'web_open': {
        const url = String(args.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) {
          return { text: 'URL không hợp lệ — phải bắt đầu bằng http:// hoặc https://', isError: true }
        }
        if (!webService) return { text: 'Dịch vụ Playwright chưa sẵn sàng.', isError: true }
        const snap = await webService.openUrl(url)
        return { text: `${markUntrustedWebContent(snap)}${userExtraNote}` }
      }

      case 'web_snapshot': {
        if (!webService) return { text: 'Dịch vụ Playwright chưa sẵn sàng.', isError: true }
        const snap = await webService.snapshot()
        return { text: markUntrustedWebContent(snap) }
      }

      case 'web_read_text': {
        if (!webService) return { text: 'Dịch vụ Playwright chưa sẵn sàng.', isError: true }
        const maxChars = typeof args.maxChars === 'number' ? args.maxChars : 12000
        const text = await webService.readText(maxChars)
        return { text: markUntrustedWebContent(text) }
      }

      case 'web_click': {
        const ref = String(args.ref ?? '').trim()
        if (!ref) return { text: 'Thiếu mã phần tử @wN hoặc selector.', isError: true }
        if (!webService) return { text: 'Dịch vụ Playwright chưa sẵn sàng.', isError: true }
        const snap = await webService.click(ref)
        return { text: `${markUntrustedWebContent(snap)}${userExtraNote}` }
      }

      case 'web_fill': {
        const ref = String(args.ref ?? '').trim()
        const value = String(args.value ?? '')
        const pressEnter = Boolean(args.pressEnter)
        if (!ref) return { text: 'Thiếu mã phần tử @wN ô nhập liệu.', isError: true }
        if (!webService) return { text: 'Dịch vụ Playwright chưa sẵn sàng.', isError: true }
        const snap = await webService.fill(ref, value, pressEnter)
        return { text: `${markUntrustedWebContent(snap)}${userExtraNote}` }
      }

      case 'web_close': {
        if (webService) await webService.close()
        return { text: 'Đã đóng cửa sổ trình duyệt Playwright.' }
      }

      case 'desktop_open_url': {
        const url = String(args.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) {
          return { text: 'URL không hợp lệ — phải bắt đầu bằng http:// hoặc https://', isError: true }
        }
        const preferChrome = args.preferChrome !== false
        const chromePath = preferChrome ? findChromeExe() : null
        if (chromePath) {
          spawn(chromePath, [url], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          }).unref()
          return { text: `Đã mở Google Chrome trên màn hình với URL: ${url}${userExtraNote}` }
        }
        await shell.openExternal(url)
        return { text: `Đã mở trình duyệt mặc định trên màn hình với URL: ${url}${userExtraNote}` }
      }

      case 'desktop_launch_app': {
        const appName = String(args.app ?? '').trim()
        const extraArgs = Array.isArray(args.args) ? args.args.map(String) : []
        if (!appName) return { text: 'Thiếu tên ứng dụng cần mở.', isError: true }

        const lower = appName.toLowerCase()
        if (lower === 'chrome' || lower === 'google chrome') {
          const chromePath = findChromeExe()
          if (chromePath) {
            spawn(chromePath, extraArgs, {
              detached: true,
              stdio: 'ignore',
              windowsHide: false
            }).unref()
            return { text: `Đã khởi chạy Google Chrome trên desktop (${chromePath}).${userExtraNote}` }
          }
        }

        try {
          const res = await execAgentDesktopArgs(['--headed', 'launch', appName, '--activate'])
          if (isAgentDesktopOk(res.stdout)) {
            return { text: `${res.stdout.trim()}${userExtraNote}` }
          }
        } catch {
          // fallback below
        }

        spawn('cmd.exe', ['/c', 'start', '', appName, ...extraArgs], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }).unref()
        return {
          text: `Đã khởi chạy ứng dụng ${appName} trực tiếp trên Windows desktop.${userExtraNote}`
        }
      }

      case 'desktop_list_windows': {
        const cmdArgs = ['list-windows']
        if (typeof args.app === 'string' && args.app.trim()) {
          cmdArgs.push('--app', args.app.trim())
        }
        const res = await execAgentDesktopArgs(cmdArgs)
        return { text: res.stdout.trim() || res.stderr.trim() || '[]' }
      }

      case 'desktop_find': {
        const cmdArgs = ['find']
        if (typeof args.app === 'string' && args.app.trim()) {
          cmdArgs.push('--app', args.app.trim())
        }
        if (typeof args.name === 'string' && args.name.trim()) {
          cmdArgs.push('--name', args.name.trim())
        }
        if (typeof args.role === 'string' && args.role.trim()) {
          cmdArgs.push('--role', args.role.trim())
        }
        if (typeof args.text === 'string' && args.text.trim()) {
          cmdArgs.push('--text', args.text.trim())
        }
        const res = await execAgentDesktopArgs(cmdArgs)
        return { text: res.stdout.trim() || res.stderr.trim() }
      }

      case 'desktop_snapshot': {
        // Restore minimized window automatically if app is provided, and give Chromium/Electron settle time
        const appName = typeof args.app === 'string' ? args.app.trim() : ''
        const cmdArgs = ['snapshot', '--timeout-ms', '5000']
        if (appName) cmdArgs.push('--app', appName)
        if (typeof args.windowId === 'string' && args.windowId.trim()) {
          cmdArgs.push('--window-id', args.windowId.trim())
        }
        const maxDepth = typeof args.maxDepth === 'number' && args.maxDepth > 0 ? args.maxDepth : 6
        cmdArgs.push('--max-depth', String(Math.min(maxDepth, 12)))
        if (args.interactiveOnly !== false) {
          cmdArgs.push('-i')
        }
        const res = await execAgentDesktopArgs(cmdArgs)
        const text = res.stdout.trim() || res.stderr.trim()
        // Cap snapshot size so LLM stays fast and focused
        return {
          text:
            text.length > 18000
              ? `${text.slice(0, 18000)}\n...(đã rút gọn; hãy dùng desktop_find với --name hoặc --role để tìm chính xác phần tử nhanh hơn)`
              : text
        }
      }

      case 'desktop_click': {
        const ref = String(args.ref ?? '').trim()
        if (!ref) return { text: 'Thiếu mã @ref cần nhấp.', isError: true }
        const useHeaded = args.headed !== false
        const verb = args.doubleClick ? 'double-click' : 'click'
        const cmdArgs = useHeaded || args.doubleClick ? ['--headed', verb, ref] : [verb, ref]
        const res = await execAgentDesktopArgs(cmdArgs)
        return { text: `${res.stdout.trim() || `Đã nhấp vào ${ref}.`}${userExtraNote}` }
      }

      case 'desktop_set_value': {
        const ref = String(args.ref ?? '').trim()
        const value = String(args.value ?? '')
        const pressEnter = Boolean(args.pressEnter)
        if (!ref) return { text: 'Thiếu mã @ref ô nhập liệu.', isError: true }

        // Try semantic set-value first; if Windows app refuses/fails, fall back to --headed focus + type
        let outputText = ''
        try {
          const res = await execAgentDesktopArgs(['set-value', ref, value])
          if (isAgentDesktopOk(res.stdout)) {
            outputText = res.stdout.trim()
          } else {
            await execAgentDesktopArgs(['--headed', 'focus', ref]).catch(() => undefined)
            const typed = await execAgentDesktopArgs(['--headed', 'type', ref, value])
            outputText = typed.stdout.trim() || res.stdout.trim()
          }
        } catch {
          await execAgentDesktopArgs(['--headed', 'focus', ref]).catch(() => undefined)
          const typed = await execAgentDesktopArgs(['--headed', 'type', ref, value])
          outputText = typed.stdout.trim()
        }

        if (pressEnter) {
          await execAgentDesktopArgs(['--headed', 'press', 'return']).catch(() => undefined)
          outputText += '\n(Đã nhấn Enter)'
        }

        return { text: `${outputText || `Đã nhập giá trị vào ${ref}.`}${userExtraNote}` }
      }

      case 'desktop_press_key': {
        const rawKey = String(args.key ?? '').trim()
        if (!rawKey) return { text: 'Thiếu tên phím.', isError: true }
        const normalizedKey = normalizeAgentDesktopKey(rawKey)
        const appName = typeof args.app === 'string' ? args.app.trim() : ''

        if (appName) {
          await execAgentDesktopArgs(['--headed', 'focus-window', '--app', appName]).catch(
            () => undefined
          )
        }
        const res = await execAgentDesktopArgs(['--headed', 'press', normalizedKey])
        return { text: `${res.stdout.trim() || `Đã nhấn phím ${normalizedKey}.`}${userExtraNote}` }
      }

      case 'desktop_screenshot': {
        if (!screenCapture) {
          return { text: 'Dịch vụ chụp ảnh màn hình chưa sẵn sàng.', isError: true }
        }
        const appName = typeof args.app === 'string' && args.app.trim() ? args.app.trim() : undefined
        const maxEdge = typeof args.maxEdge === 'number' && args.maxEdge > 0 ? args.maxEdge : 1280
        const shot = await screenCapture.capture({ app: appName, maxEdge, jpegQuality: 70 })
        const f = shot.frame
        if (appName) lastTargetApp = appName
        const summary = [
          `Đã chụp màn hình${f.windowTitle ? ` cửa sổ "${f.windowTitle}"` : f.app ? ` (${f.app})` : ' (toàn màn hình chính)'}.`,
          `Khung tọa độ ảnh: ${f.imageWidth}×${f.imageHeight} px (gốc màn hình: ${f.originX},${f.originY}, kích thước thật: ${f.captureWidth}×${f.captureHeight} px, DPI: ${Math.round(f.dpiScale * 100)}%).`,
          'Truyền tọa độ (x, y) theo đúng kích thước ảnh trên vào desktop_click_at hoặc desktop_zoom.'
        ].join('\n')
        return {
          text: summary,
          images: [{ data: shot.base64, mimeType: shot.mimeType }]
        }
      }

      case 'desktop_zoom': {
        if (!screenCapture) {
          return { text: 'Dịch vụ chụp ảnh màn hình chưa sẵn sàng.', isError: true }
        }
        const rawBox = Array.isArray(args.box) ? args.box.map(Number) : []
        if (rawBox.length !== 4 || rawBox.some((n) => Number.isNaN(n))) {
          return { text: 'Tham số box phải gồm đúng 4 số [x0, y0, x1, y1].', isError: true }
        }
        const maxEdge = typeof args.maxEdge === 'number' && args.maxEdge > 0 ? args.maxEdge : 1280
        const shot = await screenCapture.zoom(
          [rawBox[0], rawBox[1], rawBox[2], rawBox[3]],
          maxEdge,
          80
        )
        const f = shot.frame
        const summary = [
          `Đã phóng to vùng [${rawBox.join(', ')}].`,
          `Khung tọa độ ảnh mới: ${f.imageWidth}×${f.imageHeight} px (gốc màn hình: ${f.originX},${f.originY}, kích thước thật: ${f.captureWidth}×${f.captureHeight} px, DPI: ${Math.round(f.dpiScale * 100)}%).`,
          'Tọa độ (x, y) tiếp theo trong desktop_click_at sẽ tính theo ảnh phóng to này.'
        ].join('\n')
        return {
          text: summary,
          images: [{ data: shot.base64, mimeType: shot.mimeType }]
        }
      }

      case 'desktop_click_at': {
        if (!screenCapture) {
          return { text: 'Dịch vụ click theo tọa độ chưa sẵn sàng.', isError: true }
        }
        const x = Number(args.x)
        const y = Number(args.y)
        if (Number.isNaN(x) || Number.isNaN(y)) {
          return { text: 'Thiếu tọa độ số (x, y).', isError: true }
        }
        const button =
          args.button === 'right' || args.button === 'middle' ? args.button : 'left'
        const clicked = await screenCapture.clickAtImagePoint(x, y, {
          doubleClick: Boolean(args.doubleClick),
          button
        })
        return {
          text: `Đã nhấp tại ảnh (${x}, ${y}) → màn hình (${clicked.point.physicalX}, ${clicked.point.physicalY}). ${clicked.output}${userExtraNote}`
        }
      }

      case 'desktop_batch': {
        const steps = Array.isArray(args.steps) ? (args.steps as DesktopBatchStep[]) : []
        if (steps.length === 0) {
          return { text: 'Danh sách steps trong desktop_batch đang rỗng.', isError: true }
        }
        let currentApp =
          typeof args.app === 'string' && args.app.trim()
            ? args.app.trim()
            : (lastTargetApp ?? undefined)
        const includeSnapshot = args.includeSnapshot !== false
        const includeScreenshot = Boolean(args.includeScreenshot)

        const stepLogs: string[] = []
        let failedStepError: string | null = null

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          const stepLabel = `Bước ${i + 1} (${step.action})`
          try {
            switch (step.action) {
              case 'launch_app': {
                const appName = String(step.app ?? currentApp ?? '').trim()
                if (!appName) throw new Error('Thiếu tên ứng dụng (app).')
                const msg = await launchWindowsApp(
                  appName,
                  Array.isArray(step.args) ? step.args.map(String) : []
                )
                currentApp = appName
                lastTargetApp = appName
                stepLogs.push(`${stepLabel}: OK — ${msg}`)
                break
              }
              case 'wait': {
                const ms = Math.max(50, Math.min(Number(step.ms ?? 400), 10000))
                await sleepMs(ms)
                stepLogs.push(`${stepLabel}: OK — đã chờ ${ms}ms`)
                break
              }
              case 'focus': {
                if (step.ref) {
                  const res = await execAgentDesktopArgs(['--headed', 'focus', step.ref])
                  stepLogs.push(`${stepLabel}: OK — focus ${step.ref} (${res.stdout.trim() || 'ok'})`)
                } else {
                  const targetApp = String(step.app ?? currentApp ?? '').trim()
                  if (!targetApp) throw new Error('Thiếu ref hoặc app để focus.')
                  await execAgentDesktopArgs(['--headed', 'focus-window', '--app', targetApp])
                  currentApp = targetApp
                  lastTargetApp = targetApp
                  stepLogs.push(`${stepLabel}: OK — đưa ${targetApp} lên trước`)
                }
                break
              }
              case 'click': {
                const ref = String(step.ref ?? '').trim()
                if (!ref) throw new Error('Thiếu @ref cần nhấp.')
                const verb = step.doubleClick ? 'double-click' : 'click'
                const res = await execAgentDesktopArgs(['--headed', verb, ref])
                if (!isAgentDesktopOk(res.stdout) && res.stderr.trim()) {
                  throw new Error(res.stderr.trim())
                }
                stepLogs.push(`${stepLabel}: OK — nhấp ${ref}`)
                break
              }
              case 'click_at': {
                if (!screenCapture) throw new Error('Dịch vụ click tọa độ chưa sẵn sàng.')
                const x = Number(step.x)
                const y = Number(step.y)
                if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('Thiếu tọa độ (x, y).')
                const clicked = await screenCapture.clickAtImagePoint(x, y, {
                  doubleClick: Boolean(step.doubleClick)
                })
                stepLogs.push(
                  `${stepLabel}: OK — nhấp (${x},${y}) → màn hình (${clicked.point.physicalX},${clicked.point.physicalY})`
                )
                break
              }
              case 'set_value': {
                const ref = String(step.ref ?? '').trim()
                const value = String(step.value ?? step.text ?? '')
                if (!ref) throw new Error('Thiếu @ref cho set_value (hãy dùng action: "type" nếu muốn gõ vào ô đang focus).')
                let ok = false
                try {
                  const res = await execAgentDesktopArgs(['set-value', ref, value])
                  ok = isAgentDesktopOk(res.stdout)
                } catch {
                  ok = false
                }
                if (!ok) {
                  await execAgentDesktopArgs(['--headed', 'focus', ref]).catch(() => undefined)
                  try {
                    const typed = await execAgentDesktopArgs(['--headed', 'type', ref, value])
                    if (!isAgentDesktopOk(typed.stdout)) {
                      await pasteTextViaClipboard(value)
                    }
                  } catch {
                    await pasteTextViaClipboard(value)
                  }
                }
                if (step.pressEnter) {
                  await execAgentDesktopArgs(['--headed', 'press', 'return'])
                }
                stepLogs.push(`${stepLabel}: OK — đã nhập vào ${ref}${step.pressEnter ? ' (+ Enter)' : ''}`)
                break
              }
              case 'type': {
                const text = String(step.text ?? step.value ?? '')
                const ref = typeof step.ref === 'string' ? step.ref.trim() : ''
                if (ref) {
                  await execAgentDesktopArgs(['--headed', 'focus', ref]).catch(() => undefined)
                  try {
                    const typed = await execAgentDesktopArgs(['--headed', 'type', ref, text])
                    if (!isAgentDesktopOk(typed.stdout)) {
                      await pasteTextViaClipboard(text)
                    }
                  } catch {
                    await pasteTextViaClipboard(text)
                  }
                } else {
                  const targetApp = String(step.app ?? currentApp ?? '').trim()
                  if (targetApp) {
                    await execAgentDesktopArgs(['--headed', 'focus-window', '--app', targetApp]).catch(
                      () => undefined
                    )
                    await sleepMs(100)
                  }
                  await pasteTextViaClipboard(text)
                }
                if (step.pressEnter) {
                  await sleepMs(60)
                  await execAgentDesktopArgs(['--headed', 'press', 'return'])
                }
                stepLogs.push(`${stepLabel}: OK — đã gõ văn bản${step.pressEnter ? ' (+ Enter)' : ''}`)
                break
              }
              case 'press_key': {
                const rawKey = String(step.key ?? '').trim()
                if (!rawKey) throw new Error('Thiếu tên phím (key).')
                const normalizedKey = normalizeAgentDesktopKey(rawKey)
                const targetApp = String(step.app ?? '').trim()
                if (targetApp) {
                  await execAgentDesktopArgs(['--headed', 'focus-window', '--app', targetApp]).catch(
                    () => undefined
                  )
                }
                await execAgentDesktopArgs(['--headed', 'press', normalizedKey])
                stepLogs.push(`${stepLabel}: OK — nhấn ${normalizedKey}`)
                break
              }
              case 'scroll': {
                const ref = String(step.ref ?? '').trim()
                const dir = step.direction ?? 'down'
                const amt = String(step.amount ?? 3)
                if (ref) {
                  await execAgentDesktopArgs(['scroll', ref, '--direction', dir, '--amount', amt])
                } else {
                  const key = dir === 'up' ? 'pageup' : 'pagedown'
                  await execAgentDesktopArgs(['--headed', 'press', key])
                }
                stepLogs.push(`${stepLabel}: OK — cuộn ${dir}`)
                break
              }
              default:
                throw new Error(`Không hỗ trợ action: ${String((step as { action?: string }).action)}`)
            }
          } catch (stepErr) {
            failedStepError = `${stepLabel} LỖI: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`
            stepLogs.push(failedStepError)
            break
          }
        }

        const outSections: string[] = [
          failedStepError
            ? `Chuỗi thao tác dừng ở lỗi (${stepLogs.length}/${steps.length} bước):`
            : `Hoàn tất ${steps.length}/${steps.length} thao tác:`,
          ...stepLogs
        ]

        const images: Array<{ data: string; mimeType: string }> = []

        if (includeSnapshot) {
          try {
            const snapArgs = ['snapshot', '--timeout-ms', '4000', '--max-depth', '5', '-i']
            if (currentApp) snapArgs.push('--app', currentApp)
            const snapRes = await execAgentDesktopArgs(snapArgs)
            const snapText = (snapRes.stdout.trim() || snapRes.stderr.trim()).slice(0, 8000)
            if (snapText) {
              outSections.push('', 'Trạng thái cây giao diện cuối (rút gọn):', snapText)
            }
          } catch {
            // Không làm lỗi cả lô nếu snapshot cuối không khả dụng
          }
        }

        if (includeScreenshot && screenCapture) {
          try {
            const shot = await screenCapture.capture({
              app: currentApp,
              maxEdge: 1280,
              jpegQuality: 70
            })
            const f = shot.frame
            outSections.push(
              '',
              `Ảnh chụp cuối: ${f.imageWidth}×${f.imageHeight} px (gốc ${f.originX},${f.originY}, kích thước thật ${f.captureWidth}×${f.captureHeight} px, DPI ${Math.round(f.dpiScale * 100)}%).`
            )
            images.push({ data: shot.base64, mimeType: shot.mimeType })
          } catch {
            // Bỏ qua nếu chụp ảnh lỗi
          }
        }

        if (userExtraNote) outSections.push(userExtraNote)

        return {
          text: outSections.join('\n'),
          images: images.length > 0 ? images : undefined,
          isError: Boolean(failedStepError)
        }
      }

      case 'desktop_run_agent_desktop': {
        const rawArgs = Array.isArray(args.args) ? args.args.map(String) : []
        if (rawArgs.length === 0) {
          return { text: 'Thiếu danh sách tham số cho agent-desktop.', isError: true }
        }
        const res = await execAgentDesktopArgs(rawArgs)
        return { text: `${res.stdout.trim() || res.stderr.trim() || 'OK'}${userExtraNote}` }
      }

      default:
        return { text: `Không hỗ trợ công cụ: ${toolName}`, isError: true }
    }
  } catch (err) {
    return {
      text: `Lỗi khi thực thi ${toolName}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true
    }
  }
}

export class DesktopMcpServer {
  private server: http.Server | null = null
  private port: number | null = null
  private token: string = randomBytes(32).toString('hex')
  private isEnabled: () => boolean
  private interactions?: InteractionManager
  private webService = new PlaywrightWebService()
  private screenCapture = new ScreenCaptureService()

  constructor(isEnabled: () => boolean, interactions?: InteractionManager) {
    this.isEnabled = isEnabled
    this.interactions = interactions
  }

  getEndpointUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}/mcp` : null
  }

  getAuthToken(): string {
    return this.token
  }

  isListening(): boolean {
    return Boolean(this.server && this.server.listening && this.port)
  }

  private listenOnPort(targetPort: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const srv = this.server!
      const onError = (err: Error): void => {
        srv.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        srv.removeListener('error', onError)
        const addr = srv.address()
        if (addr && typeof addr === 'object') {
          resolve(addr.port)
        } else {
          reject(new Error('Không thể khởi tạo cổng loopback cho Desktop MCP server.'))
        }
      }
      srv.once('error', onError)
      srv.once('listening', onListening)
      srv.listen(targetPort, '127.0.0.1')
    })
  }

  async start(preferredPort = PREFERRED_DESKTOP_MCP_PORT): Promise<{ url: string; token: string }> {
    if (this.server && this.server.listening && this.port) {
      return { url: `http://127.0.0.1:${this.port}/mcp`, token: this.token }
    }

    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res)
    })
    this.server.requestTimeout = 0
    this.server.headersTimeout = 0

    try {
      this.port = await this.listenOnPort(preferredPort)
    } catch {
      // Cổng cố định đang bận → tự chuyển sang cổng ngẫu nhiên còn trống
      this.port = await this.listenOnPort(0)
    }

    return { url: `http://127.0.0.1:${this.port}/mcp`, token: this.token }
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const authHeader = req.headers.authorization ?? ''
    if (authHeader !== `Bearer ${this.token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }

    if (req.method === 'DELETE') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method Not Allowed' }))
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    let payload: JsonRpcRequest
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })
      )
      return
    }

    const method = payload.method ?? ''
    const id = payload.id ?? null

    if (method.startsWith('notifications/') || payload.id === undefined) {
      res.writeHead(202)
      res.end()
      return
    }

    let result: unknown
    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: DESKTOP_MCP_SERVER_NAME, version: '1.1.0' }
      }
    } else if (method === 'ping') {
      result = {}
    } else if (method === 'tools/list') {
      result = { tools: DESKTOP_MCP_TOOLS }
    } else if (method === 'tools/call') {
      const params = payload.params ?? {}
      const toolName = String(params.name ?? '')
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>

      if (toolName !== 'desktop_ask_user' && !this.isEnabled()) {
        result = {
          content: [
            {
              type: 'text',
              text: 'Người dùng đang tắt chế độ Điều khiển máy tính trong ứng dụng. Hãy yêu cầu người dùng bật nút "Điều khiển máy" trước.'
            }
          ],
          isError: true
        }
      } else {
        const out = await executeDesktopTool(
          toolName,
          toolArgs,
          this.interactions,
          this.webService,
          this.screenCapture
        )
        const content: Array<Record<string, unknown>> = [{ type: 'text', text: out.text }]
        if (out.images) {
          for (const img of out.images) {
            content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
          }
        }
        result = {
          content,
          isError: Boolean(out.isError)
        }
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        })
      )
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  private createAgyRunner(agyBinary: string): AgyMcpRunner {
    return {
      execAgy: async (args: string[]) => {
        const res = await execFileAsync(agyBinary, args, { timeout: 10000, windowsHide: true })
        return { stdout: res.stdout, stderr: res.stderr }
      }
    }
  }

  async registerWithAgy(overrideAgyPath?: string): Promise<boolean> {
    const res = await this.ensureConnectedWithAgy(overrideAgyPath)
    return res.ok
  }

  /**
   * Đảm bảo máy chủ HTTP đang sống và đăng ký `egovai-desktop` trong `agy` khớp đúng cổng + mã xác thực.
   * Tự động khởi động lại máy chủ hoặc gỡ và đăng ký lại nếu bị lệch sau khi khởi động lại ứng dụng.
   */
  async ensureConnectedWithAgy(
    overrideAgyPath?: string
  ): Promise<{ ok: boolean; reregistered: boolean; reason?: string }> {
    if (!this.isListening()) {
      try {
        await this.start()
      } catch (err) {
        return {
          ok: false,
          reregistered: false,
          reason: err instanceof Error ? err.message : String(err)
        }
      }
    }

    const url = this.getEndpointUrl()
    if (!url) return { ok: false, reregistered: false, reason: 'Chưa có địa chỉ cổng MCP' }
    const agyBinary = await getAgyBinaryPath(overrideAgyPath)
    if (!agyBinary) return { ok: false, reregistered: false, reason: 'Không tìm thấy tệp agy.exe' }

    return await syncAgyMcpRegistration(url, this.token, this.createAgyRunner(agyBinary))
  }

  stop(): void {
    void this.webService.close()
    if (this.server) {
      this.server.closeAllConnections?.()
      this.server.close()
      this.server = null
      this.port = null
    }
  }
}
