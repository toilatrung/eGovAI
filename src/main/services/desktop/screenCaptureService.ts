import { randomUUID } from 'crypto'
import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execAgentDesktopArgs } from './computerUseService'

export interface CaptureFrame {
  /** Gốc trái-trên của vùng đã chụp tính theo pixel vật lý trên màn hình */
  originX: number
  originY: number
  /** Kích thước vùng đã chụp tính theo pixel vật lý */
  captureWidth: number
  captureHeight: number
  /** Kích thước ảnh trả về cho mô hình (sau khi thu nhỏ cạnh dài <= 1280px) */
  imageWidth: number
  imageHeight: number
  /** Tỉ lệ DPI của màn hình/cửa sổ (1.0 = 100%, 1.25 = 125%, 1.5 = 150%) */
  dpiScale: number
  /** Tên ứng dụng / cửa sổ nếu chụp theo cửa sổ */
  app?: string
  windowTitle?: string
  capturedAt: number
}

export interface CaptureResult {
  frame: CaptureFrame
  base64: string
  mimeType: 'image/jpeg' | 'image/png'
}

export interface MappedScreenPoint {
  /** Tọa độ thực tế đưa vào lệnh click (pixel vật lý hoặc logic tùy targetSpace) */
  x: number
  y: number
  physicalX: number
  physicalY: number
  logicalX: number
  logicalY: number
}

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, val))
}

function parseJsonPayload(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Quy đổi tọa độ (imageX, imageY) trên ảnh đã thu nhỏ về tọa độ màn hình thật (có tính DPI).
 */
export function mapImagePointToScreen(
  imageX: number,
  imageY: number,
  frame: CaptureFrame,
  targetSpace: 'physical' | 'logical' = 'physical'
): MappedScreenPoint {
  const safeImgW = Math.max(1, frame.imageWidth)
  const safeImgH = Math.max(1, frame.imageHeight)
  const safeDpi = frame.dpiScale > 0 ? frame.dpiScale : 1

  const clampedImgX = clamp(imageX, 0, safeImgW)
  const clampedImgY = clamp(imageY, 0, safeImgH)

  const scaleX = frame.captureWidth / safeImgW
  const scaleY = frame.captureHeight / safeImgH

  const rawPhysX = frame.originX + clampedImgX * scaleX
  const rawPhysY = frame.originY + clampedImgY * scaleY

  const physicalX = Math.round(
    clamp(rawPhysX, frame.originX, frame.originX + Math.max(0, frame.captureWidth - 1))
  )
  const physicalY = Math.round(
    clamp(rawPhysY, frame.originY, frame.originY + Math.max(0, frame.captureHeight - 1))
  )

  const logicalX = Math.round(physicalX / safeDpi)
  const logicalY = Math.round(physicalY / safeDpi)

  return {
    x: targetSpace === 'logical' ? logicalX : physicalX,
    y: targetSpace === 'logical' ? logicalY : physicalY,
    physicalX,
    physicalY,
    logicalX,
    logicalY
  }
}

/**
 * Quy đổi vùng chọn [x0, y0, x1, y1] trên ảnh gần nhất thành hình chữ nhật pixel vật lý trên màn hình.
 */
export function mapImageBoxToCaptureRect(
  box: [number, number, number, number],
  frame: CaptureFrame
): { x: number; y: number; width: number; height: number } {
  const [rx0, ry0, rx1, ry1] = box
  const p0 = mapImagePointToScreen(Math.min(rx0, rx1), Math.min(ry0, ry1), frame, 'physical')
  const p1 = mapImagePointToScreen(Math.max(rx0, rx1), Math.max(ry0, ry1), frame, 'physical')

  const width = Math.max(16, p1.physicalX - p0.physicalX)
  const height = Math.max(16, p1.physicalY - p0.physicalY)
  const maxW = Math.max(16, frame.originX + frame.captureWidth - p0.physicalX)
  const maxH = Math.max(16, frame.originY + frame.captureHeight - p0.physicalY)

  return {
    x: p0.physicalX,
    y: p0.physicalY,
    width: Math.min(width, maxW),
    height: Math.min(height, maxH)
  }
}

interface ElectronNativeImageLike {
  createFromBuffer: (buf: Buffer) => {
    isEmpty: () => boolean
    getSize: () => { width: number; height: number }
    crop: (rect: { x: number; y: number; width: number; height: number }) => ReturnType<
      ElectronNativeImageLike['createFromBuffer']
    >
    resize: (opts: { width: number; height: number; quality?: 'good' | 'better' | 'best' }) => ReturnType<
      ElectronNativeImageLike['createFromBuffer']
    >
    toJPEG: (quality: number) => Buffer
  }
}

function getElectronNativeImage(): ElectronNativeImageLike | null {
  try {
    // Tải động để tệp vẫn chạy sạch trong Vitest / Node thuần ngoài Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronMod = require('electron') as { nativeImage?: ElectronNativeImageLike }
    return electronMod?.nativeImage ?? null
  } catch {
    return null
  }
}

async function queryPrimaryDisplay(): Promise<{
  originX: number
  originY: number
  scale: number
}> {
  try {
    const res = await execAgentDesktopArgs(['list-displays'])
    const parsed = parseJsonPayload(res.stdout)
    const list = Array.isArray(parsed?.data) ? (parsed.data as Array<Record<string, unknown>>) : []
    const primary = list.find((d) => d.is_primary === true) ?? list[0]
    if (primary) {
      const bounds = (primary.bounds ?? {}) as { x?: number; y?: number }
      return {
        originX: typeof bounds.x === 'number' ? Math.round(bounds.x) : 0,
        originY: typeof bounds.y === 'number' ? Math.round(bounds.y) : 0,
        scale: typeof primary.scale === 'number' && primary.scale > 0 ? primary.scale : 1
      }
    }
  } catch {
    // fallback defaults
  }
  return { originX: 0, originY: 0, scale: 1 }
}

async function queryWindowOrigin(appName: string): Promise<{
  originX: number
  originY: number
  title?: string
} | null> {
  try {
    const res = await execAgentDesktopArgs(['list-windows', '--app', appName])
    const parsed = parseJsonPayload(res.stdout)
    const rawList = Array.isArray(parsed?.data)
      ? (parsed.data as Array<Record<string, unknown>>)
      : []
    const win = rawList[0]
    if (!win) return null
    const bounds = (win.bounds ?? win.frame ?? {}) as { x?: number; y?: number }
    if (typeof bounds.x === 'number' && typeof bounds.y === 'number') {
      return {
        originX: Math.round(bounds.x),
        originY: Math.round(bounds.y),
        title: typeof win.title === 'string' ? win.title : undefined
      }
    }
  } catch {
    // fallback
  }
  return null
}

export class ScreenCaptureService {
  private lastFrame: CaptureFrame | null = null

  getLastFrame(): CaptureFrame | null {
    return this.lastFrame
  }

  setLastFrameForTest(frame: CaptureFrame | null): void {
    this.lastFrame = frame
  }

  /**
   * Chụp cửa sổ ứng dụng hoặc toàn màn hình chính bằng binary native `agent-desktop screenshot`
   * (không chạy PowerShell inline nên không bị Windows Defender AMSI chặn),
   * sau đó cắt/thu nhỏ cạnh dài <= 1280px và nén JPEG 70% bằng Electron `nativeImage`.
   */
  async capture(
    options: {
      app?: string
      maxEdge?: number
      jpegQuality?: number
      region?: { x: number; y: number; width: number; height: number }
    } = {}
  ): Promise<CaptureResult> {
    const maxEdge = Math.max(256, Math.min(options.maxEdge ?? 1280, 2560))
    const jpegQuality = Math.max(30, Math.min(options.jpegQuality ?? 70, 95))
    const tmpPath = join(tmpdir(), `egovai-cap-${randomUUID()}.png`)

    let originX = 0
    let originY = 0
    let windowTitle: string | undefined
    let capWidth = 0
    let capHeight = 0
    let dpiScale = 1

    try {
      let shotStdout = ''
      let usedAppCapture = false

      // Nếu chụp một vùng cụ thể (zoom), luôn chụp toàn màn hình gốc rồi cắt chính xác vùng đó.
      if (options.app && !options.region) {
        try {
          const res = await execAgentDesktopArgs(['screenshot', '--app', options.app, tmpPath])
          const parsed = parseJsonPayload(res.stdout)
          if (parsed?.ok === true) {
            shotStdout = res.stdout
            usedAppCapture = true
            const winOrigin = await queryWindowOrigin(options.app)
            if (winOrigin) {
              originX = winOrigin.originX
              originY = winOrigin.originY
              windowTitle = winOrigin.title
            }
          }
        } catch {
          usedAppCapture = false
        }
      }

      if (!usedAppCapture) {
        const display = await queryPrimaryDisplay()
        originX = display.originX
        originY = display.originY
        dpiScale = display.scale

        const res = await execAgentDesktopArgs(['screenshot', '--screen', '0', tmpPath])
        shotStdout = res.stdout
      }

      const parsed = parseJsonPayload(shotStdout)
      if (!parsed || parsed.ok !== true) {
        throw new Error(
          `agent-desktop screenshot thất bại: ${shotStdout.trim() || 'không có phản hồi'}`
        )
      }

      const data = (parsed.data ?? {}) as {
        width?: number
        height?: number
        scale_factor?: number
      }
      capWidth = typeof data.width === 'number' && data.width > 0 ? Math.round(data.width) : 0
      capHeight = typeof data.height === 'number' && data.height > 0 ? Math.round(data.height) : 0
      if (typeof data.scale_factor === 'number' && data.scale_factor > 0) {
        dpiScale = data.scale_factor
      }

      const pngBuffer = readFileSync(tmpPath)
      const nativeImg = getElectronNativeImage()

      if (nativeImg) {
        let img = nativeImg.createFromBuffer(pngBuffer)
        if (!img.isEmpty()) {
          const rawSize = img.getSize()
          if (capWidth <= 0) capWidth = rawSize.width
          if (capHeight <= 0) capHeight = rawSize.height

          // Nếu có vùng zoom, cắt theo tọa độ tương đối trong ảnh vừa chụp
          if (options.region) {
            const relX = clamp(options.region.x - originX, 0, Math.max(0, rawSize.width - 16))
            const relY = clamp(options.region.y - originY, 0, Math.max(0, rawSize.height - 16))
            const relW = clamp(options.region.width, 16, rawSize.width - relX)
            const relH = clamp(options.region.height, 16, rawSize.height - relY)
            img = img.crop({ x: relX, y: relY, width: relW, height: relH })
            originX = originX + relX
            originY = originY + relY
            capWidth = relW
            capHeight = relH
          }

          let imgW = capWidth
          let imgH = capHeight
          const longEdge = Math.max(capWidth, capHeight)
          if (longEdge > maxEdge) {
            const ratio = maxEdge / longEdge
            imgW = Math.max(1, Math.round(capWidth * ratio))
            imgH = Math.max(1, Math.round(capHeight * ratio))
            img = img.resize({ width: imgW, height: imgH, quality: 'good' })
          }

          const jpegBuf = img.toJPEG(jpegQuality)
          const frame: CaptureFrame = {
            originX,
            originY,
            captureWidth: capWidth,
            captureHeight: capHeight,
            imageWidth: imgW,
            imageHeight: imgH,
            dpiScale,
            app: options.app || undefined,
            windowTitle,
            capturedAt: Date.now()
          }
          this.lastFrame = frame
          return {
            frame,
            base64: jpegBuf.toString('base64'),
            mimeType: 'image/jpeg'
          }
        }
      }

      // Fallback ngoài Electron (Node thuần): trả về PNG gốc
      const frame: CaptureFrame = {
        originX,
        originY,
        captureWidth: Math.max(1, capWidth),
        captureHeight: Math.max(1, capHeight),
        imageWidth: Math.max(1, capWidth),
        imageHeight: Math.max(1, capHeight),
        dpiScale,
        app: options.app || undefined,
        windowTitle,
        capturedAt: Date.now()
      }
      this.lastFrame = frame
      return {
        frame,
        base64: pngBuffer.toString('base64'),
        mimeType: 'image/png'
      }
    } finally {
      try {
        unlinkSync(tmpPath)
      } catch {
        // ignore cleanup
      }
    }
  }

  async zoom(
    box: [number, number, number, number],
    maxEdge = 1280,
    jpegQuality = 80
  ): Promise<CaptureResult> {
    if (!this.lastFrame) {
      throw new Error('Chưa có ảnh chụp màn hình nào để phóng to. Hãy gọi desktop_screenshot trước.')
    }
    const region = mapImageBoxToCaptureRect(box, this.lastFrame)
    return await this.capture({
      app: this.lastFrame.app,
      region,
      maxEdge,
      jpegQuality
    })
  }

  async clickAtImagePoint(
    imageX: number,
    imageY: number,
    options: { doubleClick?: boolean; button?: 'left' | 'right' | 'middle' } = {}
  ): Promise<{ point: MappedScreenPoint; output: string }> {
    if (!this.lastFrame) {
      throw new Error(
        'Chưa có khung tọa độ ảnh chụp gần nhất. Hãy gọi desktop_screenshot trước khi dùng desktop_click_at.'
      )
    }
    const point = mapImagePointToScreen(imageX, imageY, this.lastFrame, 'physical')
    const xy = `${point.x},${point.y}`
    const cmdArgs = ['--headed', 'mouse-click', `--xy=${xy}`]
    if (options.doubleClick) cmdArgs.push('--count', '2')
    if (options.button && options.button !== 'left') cmdArgs.push('--button', options.button)

    const res = await execAgentDesktopArgs(cmdArgs)
    return {
      point,
      output: res.stdout.trim() || `Đã nhấp tại tọa độ màn hình (${point.x}, ${point.y}).`
    }
  }
}
