import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Download, ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateState } from '../../../../shared/types'
import { formatBytes, useUpdateStore } from '../../stores/useUpdateStore'
import { classifyImageSrc, markdownUrlTransform } from '../../utils/markdownSafety'

/** Release notes from GitHub (untrusted markdown): no remote images, links open in the browser. */
export function ReleaseNotes({ markdown }: { markdown: string }): React.JSX.Element {
  const { t } = useTranslation()
  if (!markdown.trim()) {
    return <p className="text-[12.5px] text-muted">{t('update.noNotes')}</p>
  }
  return (
    <div className="markdown-body text-[13px] text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
          img: ({ src, alt }) => {
            const cls = classifyImageSrc(typeof src === 'string' ? src : '')
            if (cls.kind === 'remote') {
              return (
                <a
                  href={cls.url}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.googleAI.openExternalUrl(cls.url)
                  }}
                  className="text-muted"
                >
                  [{alt || cls.host}]
                </a>
              )
            }
            return <span className="text-faint">[{alt || 'ảnh'}]</span>
          },
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href && /^https?:\/\//i.test(href)) void window.googleAI.openExternalUrl(href)
              }}
              className="cursor-pointer"
            >
              {children}
            </a>
          )
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

/** Vietnamese/English message for an updater error. */
export function useUpdateErrorText(): (s: UpdateState) => string {
  const { t } = useTranslation()
  return (s) => {
    const base = t(`update.errors.${s.errorCode ?? 'network'}`)
    return s.errorDetail ? `${base} (${s.errorDetail})` : base
  }
}

/** Non-blocking toast (bottom-right) for an available update, download progress and errors. */
export function UpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { update, dismissedVersion, installRequested, install, skip, dismiss } = useUpdateStore()
  const errorText = useUpdateErrorText()
  const [showNotes, setShowNotes] = useState(false)
  if (!update) return null

  const latest = update.latest
  const dismissKey = latest?.version ?? 'error'
  const busy = update.status === 'downloading' || update.status === 'verifying' || update.status === 'installing'
  const showError =
    update.status === 'error' &&
    dismissedVersion !== dismissKey &&
    (installRequested || update.errorCode === 'installFailed')
  const showAvailable =
    update.status === 'available' &&
    !!latest &&
    dismissedVersion !== latest.version &&
    (!update.skipped || update.lastCheckManual === true)
  if (!busy && !showError && !showAvailable) return null

  const pct =
    update.progress && update.progress.total > 0
      ? Math.min(100, Math.round((update.progress.received / update.progress.total) * 100))
      : 0

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-4 text-xs text-ink shadow-xl"
    >
      <div className="flex items-start gap-2.5">
        {showError ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        ) : busy ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" />
        ) : (
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            {showError
              ? t('update.errorTitle')
              : busy
                ? t(`update.status.${update.status}`, { version: latest?.version ?? '' })
                : t('update.availableTitle', { version: latest?.version ?? '' })}
          </div>
          <div className="mt-0.5 text-muted">
            {showError
              ? errorText(update)
              : busy
                ? update.status === 'downloading' && update.progress
                  ? `${formatBytes(update.progress.received)} / ${formatBytes(update.progress.total)} (${pct}%)`
                  : t(`update.statusDesc.${update.status}`)
                : t('update.availableDesc', {
                    current: update.currentVersion,
                    size: formatBytes(latest?.sizeBytes ?? 0)
                  })}
          </div>
        </div>
        {!busy && (
          <button
            onClick={() => dismiss(dismissKey)}
            aria-label={t('update.later')}
            className="press -mr-1 -mt-1 rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {update.status === 'downloading' && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}

      {showAvailable && showNotes && latest && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line bg-canvas p-3">
          <ReleaseNotes markdown={latest.notes} />
        </div>
      )}

      {(showAvailable || showError) && latest && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {update.canInstall ? (
            <button
              onClick={() => void install()}
              className="press flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{showError ? t('update.retry') : t('update.installNow')}</span>
            </button>
          ) : (
            <button
              onClick={() => void window.googleAI.openExternalUrl(latest.htmlUrl)}
              className="press flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{t('update.openReleasePage')}</span>
            </button>
          )}
          {showAvailable && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="press rounded-lg border border-line px-2.5 py-1.5 font-medium hover:bg-sunken"
            >
              {showNotes ? t('update.hideNotes') : t('update.viewNotes')}
            </button>
          )}
          <button
            onClick={() => dismiss(latest.version)}
            className="press rounded-lg px-2 py-1.5 font-medium text-muted hover:bg-sunken hover:text-ink"
          >
            {t('update.later')}
          </button>
          {showAvailable && (
            <button
              onClick={() => void skip(latest.version)}
              className="press rounded-lg px-2 py-1.5 font-medium text-muted hover:bg-sunken hover:text-ink"
            >
              {t('update.skipVersion')}
            </button>
          )}
        </div>
      )}
      {showAvailable && update.canInstall && (
        <p className="mt-2 text-[11px] text-faint">{t('update.restartNote')}</p>
      )}
    </div>
  )
}
