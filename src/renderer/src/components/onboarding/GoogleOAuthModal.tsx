import { useState } from 'react'
import { ExternalLink, Copy, Check, Loader2, CheckCircle2, AlertCircle, X, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'

export function GoogleOAuthModal(): React.JSX.Element | null {
  const { oauthModalOpen, oauthEvent, settings, closeOAuthModal, startGoogleOAuth } =
    useAppStore()
  const [codeInput, setCodeInput] = useState('')
  const [copied, setCopied] = useState(false)

  if (!oauthModalOpen) return null

  const isLight = settings.theme === 'light'
  const stage = oauthEvent?.stage ?? 'started'
  const oauthUrl = oauthEvent?.url

  const handleCopyUrl = (): void => {
    if (!oauthUrl) return
    void navigator.clipboard.writeText(oauthUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleSubmitCode = (): void => {
    if (!codeInput.trim()) return
    void window.googleAI.submitOAuthCode(codeInput.trim())
    setCodeInput('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${
          isLight
            ? 'border-line bg-surface text-ink'
            : 'border-line-strong bg-surface text-ink'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface ring-1 ring-line">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.38-2.3V6.6H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l4-3.1z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold">Đăng nhập Google OAuth2</h2>
              <p className="text-xs text-faint">
                Đăng nhập bằng tài khoản Google của bạn
              </p>
            </div>
          </div>

          <button
            onClick={() => void closeOAuthModal()}
            className="press rounded-lg p-1 text-faint hover:bg-sunken hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="mt-5 space-y-4">
          {stage === 'success' ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>{oauthEvent?.message ?? 'Đăng nhập Google OAuth2 thành công!'}</div>
            </div>
          ) : stage === 'error' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="break-words">{oauthEvent?.message}</div>
              </div>
              <button
                onClick={() => void startGoogleOAuth()}
                className="press w-full rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Thử đăng nhập lại bằng Google OAuth2
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className={`flex items-start gap-3 rounded-xl border p-3.5 text-xs ${
                  isLight
                    ? 'border-blue-200 bg-blue-50 text-blue-900'
                    : 'border-blue-500/30 bg-blue-500/10 text-blue-100'
                }`}
              >
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-400" />
                <div>
                  <div className="font-semibold">Đang chờ bạn xác nhận trên trình duyệt...</div>
                  <p className="mt-1 opacity-85">
                    Trình duyệt sẽ mở trang đăng nhập Google chính thức. Sau khi bạn chọn tài khoản và nhấn <strong>Tiếp tục</strong>, eGovAI sẽ tự động kết nối ngay lập tức.
                  </p>
                </div>
              </div>

              {oauthUrl && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void window.googleAI.openExternalUrl(oauthUrl)}
                    className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Mở trang Google OAuth2</span>
                  </button>
                  <button
                    onClick={handleCopyUrl}
                    title="Sao chép liên kết đăng nhập"
                    className={`press flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      isLight
                        ? 'border-line bg-canvas hover:bg-sunken'
                        : 'border-line-strong bg-surface hover:bg-sunken'
                    }`}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copied ? 'Đã chép' : 'Chép link'}</span>
                  </button>
                </div>
              )}

              {stage === 'needs_input' && (
                <div className="space-y-1.5">
                  <label className="block text-xs text-faint">
                    Dán mã xác thực từ trình duyệt (nếu được yêu cầu):
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmitCode()
                      }}
                      placeholder="Nhập mã xác thực..."
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs outline-none ${
                        isLight
                          ? 'border-line-strong bg-canvas text-ink'
                          : 'border-line-strong bg-canvas text-ink'
                      }`}
                    />
                    <button
                      onClick={handleSubmitCode}
                      className="press rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
                    >
                      Xác nhận
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line pt-3 text-[11px] text-faint">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Bảo mật bởi Google OAuth2 chính thức</span>
            </span>
            <button
              onClick={() => void closeOAuthModal()}
              className="press rounded-lg px-2.5 py-1 font-medium text-faint hover:bg-sunken hover:text-ink"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
