import { describe, expect, it, vi } from 'vitest'
import {
  mapImageBoxToCaptureRect,
  mapImagePointToScreen,
  type CaptureFrame
} from '../src/main/services/screenCaptureService'
import {
  parseAgyMcpList,
  syncAgyMcpRegistration,
  verifyAgyMcpRegistration
} from '../src/main/services/desktopMcpServer'
import { pickFastComputerUseModel } from '../src/shared/types'

describe('screenCaptureService (quy đổi tọa độ ảnh → màn hình theo tỉ lệ và DPI)', () => {
  it('quy đổi chính xác ảnh thu nhỏ từ màn hình 1920x1080 (DPI 100%)', () => {
    const frame: CaptureFrame = {
      originX: 0,
      originY: 0,
      captureWidth: 1920,
      captureHeight: 1080,
      imageWidth: 1280,
      imageHeight: 720,
      dpiScale: 1.0,
      capturedAt: Date.now()
    }

    const center = mapImagePointToScreen(640, 360, frame)
    expect(center.physicalX).toBe(960)
    expect(center.physicalY).toBe(540)
    expect(center.logicalX).toBe(960)
    expect(center.logicalY).toBe(540)
  })

  it('quy đổi chính xác với DPI 125% và 150% cùng cửa sổ lệch gốc (originX/originY)', () => {
    // Cửa sổ vật lý 1500x1000 ở góc (250, 125) trên màn hình DPI 125%, thu nhỏ về 1200x800
    const frame125: CaptureFrame = {
      originX: 250,
      originY: 125,
      captureWidth: 1500,
      captureHeight: 1000,
      imageWidth: 1200,
      imageHeight: 800,
      dpiScale: 1.25,
      app: 'Zalo',
      capturedAt: Date.now()
    }
    const p125 = mapImagePointToScreen(600, 400, frame125, 'physical')
    expect(p125.physicalX).toBe(1000) // 250 + 600 * (1500/1200)
    expect(p125.physicalY).toBe(625) // 125 + 400 * (1000/800)
    expect(p125.logicalX).toBe(800) // 1000 / 1.25
    expect(p125.logicalY).toBe(500) // 625 / 1.25

    // Màn hình 2880x1620 (DPI 150%), thu nhỏ về 1280x720
    const frame150: CaptureFrame = {
      originX: 0,
      originY: 0,
      captureWidth: 2880,
      captureHeight: 1620,
      imageWidth: 1280,
      imageHeight: 720,
      dpiScale: 1.5,
      capturedAt: Date.now()
    }
    const p150 = mapImagePointToScreen(640, 360, frame150, 'physical')
    expect(p150.physicalX).toBe(1440)
    expect(p150.physicalY).toBe(810)
    expect(p150.logicalX).toBe(960) // 1440 / 1.5
    expect(p150.logicalY).toBe(540) // 810 / 1.5

    const p150Logical = mapImagePointToScreen(640, 360, frame150, 'logical')
    expect(p150Logical.x).toBe(960)
    expect(p150Logical.y).toBe(540)
  })

  it('quy đổi vùng desktop_zoom [x0, y0, x1, y1] sang hình chữ nhật pixel vật lý', () => {
    const frame: CaptureFrame = {
      originX: 100,
      originY: 50,
      captureWidth: 1600,
      captureHeight: 1000,
      imageWidth: 800,
      imageHeight: 500,
      dpiScale: 1.25,
      capturedAt: Date.now()
    }
    const rect = mapImageBoxToCaptureRect([100, 100, 300, 250], frame)
    expect(rect).toEqual({
      x: 300, // 100 + 100*2
      y: 250, // 50 + 100*2
      width: 400, // (300-100)*2
      height: 300 // (250-100)*2
    })
  })
})

describe('DesktopMcpServer MCP registration verification & self-heal', () => {
  it('phân tích bảng kết quả agy mcp list', () => {
    const stdout = [
      'NAME            TYPE  STATUS   COMMAND/URL',
      'egovai-desktop  http  enabled  http://127.0.0.1:47821/mcp',
      'other-tool      stdio disabled npx something'
    ].join('\n')

    const parsed = parseAgyMcpList(stdout)
    expect(parsed).toEqual([
      {
        name: 'egovai-desktop',
        type: 'http',
        status: 'enabled',
        target: 'http://127.0.0.1:47821/mcp'
      },
      {
        name: 'other-tool',
        type: 'stdio',
        status: 'disabled',
        target: 'npx something'
      }
    ])
  })

  it('không đăng ký lại khi URL và Bearer token đã khớp', async () => {
    const url = 'http://127.0.0.1:47821/mcp'
    const token = 'tok-live-123'
    const execAgy = vi.fn(async (args: string[]) => {
      if (args[0] === 'mcp' && args[1] === 'list') {
        return {
          stdout: `NAME TYPE STATUS COMMAND/URL\negovai-desktop http enabled ${url}\n`,
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })
    const readConfigFile = () =>
      JSON.stringify({
        mcpServers: {
          'egovai-desktop': {
            disabled: false,
            serverUrl: url,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      })

    const res = await syncAgyMcpRegistration(url, token, { execAgy, readConfigFile })
    expect(res).toEqual({ ok: true, reregistered: false })
    expect(execAgy).toHaveBeenCalledTimes(1)
  })

  it('tự gỡ và đăng ký lại khi agy mcp list trỏ cổng cũ hoặc mã xác thực cũ', async () => {
    const newUrl = 'http://127.0.0.1:47821/mcp'
    const newToken = 'tok-new-999'
    let registeredUrl = 'http://127.0.0.1:57251/mcp'
    let registeredToken = 'tok-stale-111'

    const execAgy = vi.fn(async (args: string[]) => {
      if (args[1] === 'list') {
        return {
          stdout: registeredUrl
            ? `NAME TYPE STATUS COMMAND/URL\negovai-desktop http enabled ${registeredUrl}\n`
            : 'NAME TYPE STATUS COMMAND/URL\n',
          stderr: ''
        }
      }
      if (args[1] === 'remove') {
        registeredUrl = ''
        registeredToken = ''
        return { stdout: 'removed', stderr: '' }
      }
      if (args[1] === 'add') {
        const headerIdx = args.indexOf('--header')
        const headerVal = headerIdx >= 0 ? args[headerIdx + 1] : ''
        registeredToken = headerVal.replace(/^Authorization:\s*Bearer\s+/i, '')
        registeredUrl = args[args.length - 1]
        return { stdout: 'added', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const readConfigFile = () =>
      registeredUrl
        ? JSON.stringify({
            mcpServers: {
              'egovai-desktop': {
                disabled: false,
                serverUrl: registeredUrl,
                headers: { Authorization: `Bearer ${registeredToken}` }
              }
            }
          })
        : JSON.stringify({ mcpServers: {} })

    const before = await verifyAgyMcpRegistration(newUrl, newToken, { execAgy, readConfigFile })
    expect(before.valid).toBe(false)

    const synced = await syncAgyMcpRegistration(newUrl, newToken, { execAgy, readConfigFile })
    expect(synced.ok).toBe(true)
    expect(synced.reregistered).toBe(true)
    expect(registeredUrl).toBe(newUrl)
    expect(registeredToken).toBe(newToken)
    expect(execAgy).toHaveBeenCalledWith(['mcp', 'remove', 'egovai-desktop'])
  })
})

describe('pickFastComputerUseModel', () => {
  it('chọn mô hình Flash khi có sẵn và trả null nếu không có', () => {
    const picked = pickFastComputerUseModel([
      { id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' },
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' }
    ])
    expect(picked?.id).toBe('gemini-3.8-flash-medium')

    expect(
      pickFastComputerUseModel([{ id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5' }])
    ).toBeNull()
  })
})
