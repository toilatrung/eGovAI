import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  ExternalLink,
  Globe,
  Loader2,
  Search
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'

interface WebBrowserTabProps {
  isLight: boolean
  visible: boolean
}

interface ElectronWebViewElement extends HTMLElement {
  src: string
  getWebContentsId: () => number
  getURL: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  loadURL: (url: string) => Promise<void>
}

const QUICK_BOOKMARKS = [
  { label: 'CSDL Văn bản pháp luật', url: 'https://vbpl.vn' },
  { label: 'Thư viện Pháp luật', url: 'https://thuvienphapluat.vn' },
  { label: 'Cổng Dịch vụ công QG', url: 'https://dichvucong.gov.vn' },
  { label: 'Google', url: 'https://www.google.com' }
]

function normalizeAddress(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (!/\s/.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function WebBrowserTab({ isLight, visible }: WebBrowserTabProps): React.JSX.Element {
  const browserUrl = useAppStore((s) => s.browserUrl)
  const setBrowserUrl = useAppStore((s) => s.setBrowserUrl)

  const webviewRef = useRef<ElectronWebViewElement | null>(null)
  const [addressInput, setAddressInput] = useState(browserUrl || '')
  const [currentUrl, setCurrentUrl] = useState(browserUrl || '')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [isReady, setIsReady] = useState(false)

  // Register <webview> WebContentsId with main process so AI web_* tools drive it directly.
  useEffect(() => {
    const el = webviewRef.current
    if (!el) return

    const syncNav = (): void => {
      try {
        const url = el.getURL()
        const display = url === 'about:blank' ? '' : url
        setCurrentUrl(display)
        setAddressInput(display)
        setCanBack(el.canGoBack())
        setCanForward(el.canGoForward())
      } catch {
        // webview not ready yet
      }
    }

    const onDomReady = (): void => {
      setIsReady(true)
      try {
        const id = el.getWebContentsId()
        void window.googleAI.registerInAppBrowser(id)
      } catch {
        // ignore
      }
      syncNav()
    }

    const onStartLoading = (): void => setLoading(true)
    const onStopLoading = (): void => {
      setLoading(false)
      syncNav()
    }
    const onNavigate = (): void => syncNav()

    el.addEventListener('dom-ready', onDomReady)
    el.addEventListener('did-start-loading', onStartLoading)
    el.addEventListener('did-stop-loading', onStopLoading)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)

    return () => {
      el.removeEventListener('dom-ready', onDomReady)
      el.removeEventListener('did-start-loading', onStartLoading)
      el.removeEventListener('did-stop-loading', onStopLoading)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      void window.googleAI.registerInAppBrowser(null)
    }
  }, [])

  // Navigate when store's browserUrl changes externally (e.g. user clicked a link).
  useEffect(() => {
    if (!browserUrl) return
    setAddressInput(browserUrl)
    const el = webviewRef.current
    if (el && isReady) {
      try {
        if (el.getURL() !== browserUrl) {
          void el.loadURL(browserUrl)
        }
      } catch {
        // ignore
      }
    }
  }, [browserUrl, isReady])

  const navigateTo = (raw: string): void => {
    const target = normalizeAddress(raw)
    if (!target) return
    setBrowserUrl(target)
    setAddressInput(target)
    const el = webviewRef.current
    if (el) {
      try {
        if (isReady) {
          void el.loadURL(target)
        } else {
          el.src = target
        }
      } catch {
        el.src = target
      }
    }
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    navigateTo(addressInput)
  }

  const showLanding = !currentUrl && !loading

  return (
    <div className={`${visible ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
      {/* Browser Address Toolbar */}
      <div
        className={`flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5 ${
          isLight ? 'bg-surface' : 'bg-surface/60'
        }`}
      >
        <button
          type="button"
          disabled={!canBack}
          onClick={() => webviewRef.current?.goBack()}
          title="Quay lại"
          className="press flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:opacity-35"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canForward}
          onClick={() => webviewRef.current?.goForward()}
          title="Tiến tới"
          className="press flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:opacity-35"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
          title={loading ? 'Dừng tải' : 'Tải lại'}
          className="press flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink"
        >
          {loading ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        </button>

        <form onSubmit={handleSubmit} className="relative flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-2.5 text-faint">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </span>
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Nhập địa chỉ web hoặc từ khóa tìm kiếm..."
            aria-label="Địa chỉ trình duyệt tích hợp"
            className="h-7 w-full rounded-md border border-line bg-canvas pl-8 pr-2.5 text-[12px] text-ink outline-none focus:border-brand/50"
          />
        </form>

        <button
          type="button"
          disabled={!currentUrl}
          onClick={() => currentUrl && void window.googleAI.openExternalUrl(currentUrl)}
          title="Mở trang này bằng trình duyệt ngoài"
          className="press flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:opacity-35"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Main WebView Surface */}
      <div className="relative min-h-0 flex-1 bg-canvas">
        {showLanding && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Globe className="h-6 w-6" />
            </div>
            <div className="max-w-sm space-y-1">
              <h3 className="text-[14px] font-semibold text-ink">
                Trình duyệt tích hợp ngay trong eGovAI
              </h3>
              <p className="text-[12.5px] leading-relaxed text-muted">
                Trợ lý AI có thể mở, đọc và tra cứu trang web trực tiếp tại đây mà không cần mở trình duyệt ngoài. Bạn cũng có thể tự duyệt hoặc đăng nhập ngay trên khung này.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_BOOKMARKS.map((bm) => (
                <button
                  key={bm.url}
                  type="button"
                  onClick={() => navigateTo(bm.url)}
                  className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:border-brand/40 hover:text-brand"
                >
                  <Globe className="h-3.5 w-3.5 text-brand" />
                  <span>{bm.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* eslint-disable-next-line react/no-unknown-property */}
        <webview
          ref={webviewRef as unknown as React.RefObject<never>}
          src={browserUrl || 'about:blank'}
          partition="persist:egovai-browser"
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
