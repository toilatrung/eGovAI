import { webContents, type WebContents } from 'electron'
import { normalizeWebSelector, PlaywrightWebService } from './playwrightService'

export interface WebAutomationBackend {
  openUrl(url: string): Promise<string>
  snapshot(): Promise<string>
  readText(maxChars?: number): Promise<string>
  click(refOrSelector: string): Promise<string>
  fill(refOrSelector: string, text: string, submit?: boolean): Promise<string>
  inspectElementLabel(refOrSelector: string): Promise<string>
  close(): Promise<void>
}

/**
 * Bỏ mã `Electron/x.y` và tên ứng dụng (`GoogleAI/x.y`, `eGovAI/x.y`) khỏi User-Agent của
 * trình duyệt tích hợp. Một số cổng thông tin nhà nước (VD dichvucong.gov.vn) từ chối
 * User-Agent có các mã này với thông báo "The requested URL was rejected".
 */
export function toStandardChromeUserAgent(ua: string): string {
  return ua
    .replace(/\s(?:GoogleAI|eGovAI|egovai-desktop)\/\S+/gi, '')
    .replace(/\sElectron\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Partition (phiên cookie) dùng chung cho thẻ <webview> của tab Trình duyệt. */
export const IN_APP_BROWSER_PARTITION = 'persist:egovai-browser'

export function normalizeBrowserInputUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (!/\s/.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

const SNAPSHOT_SCRIPT = `(() => {
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
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
  ].join(',');
  const nodes = Array.from(document.querySelectorAll(selector));
  const refs = [];
  let idx = 1;
  for (const el of nodes) {
    if (idx > 80) break;
    if (!isVisible(el)) continue;
    const refId = 'w' + idx;
    el.setAttribute('data-egov-ref', refId);
    const tag = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute('type');
    const role = el.getAttribute('role');
    const label = (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.innerText ||
      el.value ||
      ''
    ).replace(/\\s+/g, ' ').trim().slice(0, 90);
    const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : '';
    const kind = typeAttr ? (tag + ':' + typeAttr) : role ? (tag + ':' + role) : tag;
    if (!label && tag === 'a' && !href) continue;
    refs.push('@' + refId + ' [' + kind + '] "' + label + '"' + (href ? ' -> ' + href : ''));
    idx++;
  }
  const rawText = (document.body?.innerText || '')
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();
  return {
    url: window.location.href,
    title: document.title || '',
    refs,
    textExcerpt: rawText.slice(0, 3500)
  };
})()`

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForLoad(wc: WebContents, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wc.removeListener('did-finish-load', done)
      wc.removeListener('did-stop-loading', done)
      wc.removeListener('did-fail-load', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    wc.once('did-finish-load', done)
    wc.once('did-stop-loading', done)
    wc.once('did-fail-load', done)
  })
}

export interface InAppBrowserServiceOptions {
  /** Requests the renderer to open the Auxiliary Pane to the in-app Browser tab. */
  onRequestOpen: (url?: string) => void
  /** Optional Playwright fallback when no Electron window/webview is attached (e.g. headless). */
  fallback?: PlaywrightWebService
}

export class InAppBrowserService implements WebAutomationBackend {
  private webContentsId: number | null = null
  private waiters: Array<(wc: WebContents | null) => void> = []
  private readonly onRequestOpen: (url?: string) => void
  private readonly fallback: PlaywrightWebService

  constructor(options: InAppBrowserServiceOptions) {
    this.onRequestOpen = options.onRequestOpen
    this.fallback = options.fallback ?? new PlaywrightWebService()
  }

  registerWebContents(id: number | null): void {
    this.webContentsId = id
    const wc = this.getLiveWebContents()
    if (wc && this.waiters.length > 0) {
      const pending = this.waiters.splice(0, this.waiters.length)
      for (const resolve of pending) resolve(wc)
    }
  }

  private getLiveWebContents(): WebContents | null {
    if (this.webContentsId === null) return null
    try {
      const wc = webContents.fromId(this.webContentsId)
      if (!wc || wc.isDestroyed()) {
        this.webContentsId = null
        return null
      }
      return wc
    } catch {
      return null
    }
  }

  private async ensureWebContents(initialUrl?: string): Promise<WebContents | null> {
    this.onRequestOpen(initialUrl)
    const existing = this.getLiveWebContents()
    if (existing) return existing

    return await new Promise<WebContents | null>((resolve) => {
      const wrapped = (wc: WebContents | null): void => {
        clearTimeout(timer)
        resolve(wc)
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(wrapped)
        if (idx >= 0) this.waiters.splice(idx, 1)
        resolve(this.getLiveWebContents())
      }, 4000)
      this.waiters.push(wrapped)
    })
  }

  private async buildSnapshot(wc: WebContents): Promise<string> {
    const extracted = (await wc.executeJavaScript(SNAPSHOT_SCRIPT, true)) as {
      url: string
      title: string
      refs: string[]
      textExcerpt: string
    }
    const lines = [
      `URL: ${extracted.url || wc.getURL()}`,
      `Tiêu đề: ${extracted.title || wc.getTitle()}`,
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
    const wc = await this.ensureWebContents(url)
    if (!wc) return await this.fallback.openUrl(url)

    const loadDone = waitForLoad(wc, 20000)
    try {
      await wc.loadURL(url)
    } catch {
      // ERR_ABORTED on redirects is normal; waitForLoad handles completion
    }
    await loadDone
    await delay(450)
    return await this.buildSnapshot(wc)
  }

  async snapshot(): Promise<string> {
    const wc = await this.ensureWebContents()
    if (!wc) return await this.fallback.snapshot()
    return await this.buildSnapshot(wc)
  }

  async readText(maxChars = 12000): Promise<string> {
    const wc = await this.ensureWebContents()
    if (!wc) return await this.fallback.readText(maxChars)

    const limit = Math.max(500, Math.min(40000, maxChars))
    const raw = (await wc.executeJavaScript(
      `(() => (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim())()`,
      true
    )) as string
    const url = wc.getURL()
    const title = wc.getTitle()
    const body = (raw || '').slice(0, limit)
    const truncated = (raw || '').length > limit ? `\n\n[Đã cắt bớt tại ${limit} ký tự]` : ''
    return `URL: ${url}\nTiêu đề: ${title}\n\n${body}${truncated}`
  }

  async inspectElementLabel(refOrSelector: string): Promise<string> {
    const wc = this.getLiveWebContents()
    if (!wc) return await this.fallback.inspectElementLabel(refOrSelector)
    const selector = normalizeWebSelector(refOrSelector)
    try {
      const label = (await wc.executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return '';
          return (
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.innerText ||
            el.value ||
            ''
          ).replace(/\\s+/g, ' ').trim().slice(0, 120);
        })()`,
        true
      )) as string
      return label || ''
    } catch {
      return ''
    }
  }

  async click(refOrSelector: string): Promise<string> {
    const wc = await this.ensureWebContents()
    if (!wc) return await this.fallback.click(refOrSelector)
    const selector = normalizeWebSelector(refOrSelector)
    const res = (await wc.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'Không tìm thấy phần tử: ' + ${JSON.stringify(refOrSelector)} };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        if (typeof el.focus === 'function') el.focus();
        el.click();
        return { ok: true };
      })()`,
      true
    )) as { ok: boolean; error?: string }
    if (!res.ok) {
      throw new Error(res.error || `Không thể bấm phần tử ${refOrSelector}`)
    }
    await delay(700)
    return await this.buildSnapshot(wc)
  }

  async fill(refOrSelector: string, text: string, submit = false): Promise<string> {
    const wc = await this.ensureWebContents()
    if (!wc) return await this.fallback.fill(refOrSelector, text, submit)
    const selector = normalizeWebSelector(refOrSelector)
    const res = (await wc.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'Không tìm thấy ô nhập: ' + ${JSON.stringify(refOrSelector)} };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        if (typeof el.focus === 'function') el.focus();
        const val = ${JSON.stringify(text)};
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, val);
        else if ('value' in el) el.value = val;
        else el.textContent = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (${JSON.stringify(submit)}) {
          const form = el.form || el.closest('form');
          if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else if (form) {
            form.submit();
          } else {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }
        }
        return { ok: true };
      })()`,
      true
    )) as { ok: boolean; error?: string }
    if (!res.ok) {
      throw new Error(res.error || `Không thể điền ô ${refOrSelector}`)
    }
    await delay(submit ? 900 : 300)
    return await this.buildSnapshot(wc)
  }

  async close(): Promise<void> {
    const wc = this.getLiveWebContents()
    if (wc) {
      await wc.loadURL('about:blank').catch(() => undefined)
    }
    await this.fallback.close()
  }
}
