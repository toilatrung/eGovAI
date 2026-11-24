import { existsSync } from 'fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

export interface DetectedBrowserInfo {
  available: boolean
  name: string | null
  channel: 'chrome' | 'msedge' | null
  executablePath: string | null
}

export function detectSystemBrowser(): DetectedBrowserInfo {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : ''
  ].filter(Boolean)

  for (const p of chromePaths) {
    if (existsSync(p)) {
      return { available: true, name: 'Google Chrome', channel: 'chrome', executablePath: p }
    }
  }

  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]
  for (const p of edgePaths) {
    if (existsSync(p)) {
      return { available: true, name: 'Microsoft Edge', channel: 'msedge', executablePath: p }
    }
  }

  return { available: false, name: null, channel: null, executablePath: null }
}

export function normalizeWebSelector(refOrSelector: string): string {
  const trimmed = refOrSelector.trim()
  const refMatch = trimmed.match(/^@?(w\d+)$/i)
  if (refMatch) {
    return `[data-egov-ref="${refMatch[1].toLowerCase()}"]`
  }
  return trimmed
}

export class PlaywrightWebService {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private activePage: Page | null = null

  private async ensurePage(): Promise<Page> {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage
    }

    if (this.context) {
      const openPages = this.context.pages().filter((p) => !p.isClosed())
      if (openPages.length > 0) {
        this.activePage = openPages[openPages.length - 1]
        return this.activePage
      }
    }

    if (!this.browser || !this.browser.isConnected()) {
      const detected = detectSystemBrowser()
      if (!detected.available || !detected.executablePath) {
        throw new Error(
          'Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy để chạy Playwright.'
        )
      }

      this.browser = await chromium.launch({
        executablePath: detected.executablePath,
        headless: false,
        args: ['--start-maximized']
      })

      this.browser.on('disconnected', () => {
        this.browser = null
        this.context = null
        this.activePage = null
      })

      this.context = await this.browser.newContext({
        viewport: null,
        locale: 'vi-VN'
      })

      this.context.on('page', (newPage) => {
        this.activePage = newPage
      })
    }

    if (!this.context) {
      this.context = await this.browser.newContext({ viewport: null, locale: 'vi-VN' })
    }

    this.activePage = await this.context.newPage()
    return this.activePage
  }

  private async buildSnapshot(page: Page): Promise<string> {
    const url = page.url()
    const title = await page.title().catch(() => '')

    const extracted = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false
        }
        const rect = el.getBoundingClientRect()
        return rect.width > 1 && rect.height > 1
      }

      const selector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="combobox"]'
      ].join(',')

      const nodes = Array.from(document.querySelectorAll(selector))
      const refs: string[] = []
      let idx = 1

      for (const el of nodes) {
        if (idx > 80) break
        if (!isVisible(el)) continue
        const refId = `w${idx}`
        el.setAttribute('data-egov-ref', refId)

        const tag = el.tagName.toLowerCase()
        const typeAttr = el.getAttribute('type')
        const role = el.getAttribute('role')
        const label = (
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          (el as HTMLElement).innerText ||
          (el as HTMLInputElement).value ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90)

        const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : ''
        const kind = typeAttr ? `${tag}:${typeAttr}` : role ? `${tag}:${role}` : tag

        if (!label && tag === 'a' && !href) continue
        refs.push(`@${refId} [${kind}] "${label}"${href ? ` -> ${href}` : ''}`)
        idx++
      }

      const rawText = (document.body?.innerText || '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()

      return {
        refs,
        textExcerpt: rawText.slice(0, 3500)
      }
    })

    const lines = [
      `URL: ${url}`,
      `Tiêu đề: ${title}`,
      '',
      `Phần tử tương tác (${extracted.refs.length}):`,
      ...(extracted.refs.length > 0 ? extracted.refs : ['(Không phát hiện phần tử tương tác)']),
      '',
      'Nội dung hiển thị (trích lược):',
      extracted.textExcerpt || '(Trang trống)'
    ]

    return lines.join('\n')
  }

  async openUrl(url: string): Promise<string> {
    const page = await this.ensurePage()
    await page.bringToFront().catch(() => undefined)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(700)
    return await this.buildSnapshot(page)
  }

  async snapshot(): Promise<string> {
    const page = await this.ensurePage()
    // If a new tab was opened recently, ensure we read the newest non-closed page
    if (this.context) {
      const openPages = this.context.pages().filter((p) => !p.isClosed())
      if (openPages.length > 0) {
        this.activePage = openPages[openPages.length - 1]
      }
    }
    return await this.buildSnapshot(this.activePage ?? page)
  }

  async readText(maxChars = 12000): Promise<string> {
    const page = await this.ensurePage()
    const url = page.url()
    const title = await page.title().catch(() => '')
    const text = await page.evaluate(() =>
      (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
    )
    const clipped = text.slice(0, Math.max(1000, Math.min(maxChars, 30000)))
    return `URL: ${url}\nTiêu đề: ${title}\n\n${clipped}`
  }

  async inspectElementLabel(refOrSelector: string): Promise<string> {
    if (!this.activePage || this.activePage.isClosed()) return ''
    try {
      const sel = normalizeWebSelector(refOrSelector)
      const locator = this.activePage.locator(sel).first()
      return await locator.evaluate(
        (el) => {
          const parts = [
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            (el as HTMLElement).innerText,
            (el as HTMLInputElement).value
          ].filter(Boolean)
          return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        },
        undefined,
        { timeout: 1500 }
      )
    } catch {
      return ''
    }
  }

  async click(refOrSelector: string): Promise<string> {
    const page = await this.ensurePage()
    await page.bringToFront().catch(() => undefined)
    const sel = normalizeWebSelector(refOrSelector)
    const locator = page.locator(sel).first()
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined)
    await locator.click({ timeout: 10000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => undefined)
    await page.waitForTimeout(600)

    if (this.context) {
      const openPages = this.context.pages().filter((p) => !p.isClosed())
      if (openPages.length > 0) {
        this.activePage = openPages[openPages.length - 1]
      }
    }

    return await this.buildSnapshot(this.activePage ?? page)
  }

  async fill(refOrSelector: string, value: string, pressEnter = false): Promise<string> {
    const page = await this.ensurePage()
    await page.bringToFront().catch(() => undefined)
    const sel = normalizeWebSelector(refOrSelector)
    const locator = page.locator(sel).first()
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined)

    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input')
    if (tagName === 'select') {
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption(value)
      })
    } else {
      await locator.fill(value, { timeout: 10000 })
      if (pressEnter) {
        await locator.press('Enter')
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined)
        await page.waitForTimeout(800)
      }
    }

    return await this.buildSnapshot(page)
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined)
      this.browser = null
      this.context = null
      this.activePage = null
    }
  }
}
