import { useState } from 'react'
import { CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes, useUpdateStore } from '../../stores/useUpdateStore'
import { ReleaseNotes, useUpdateErrorText } from '../update/UpdateBanner'

/** "Phiên bản & cập nhật" block in the About page: version, manual check, auto-check toggle. */
export function UpdateSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { update, check, install, setAutoCheck } = useUpdateStore()
  const errorText = useUpdateErrorText()
  const [showNotes, setShowNotes] = useState(false)

  const status = update?.status ?? 'idle'
  const busy = status === 'checking' || status === 'downloading' || status === 'verifying' || status === 'installing'
  const latest = update?.latest
  const lastChecked = update?.lastCheckedAt
    ? new Date(update.lastCheckedAt).toLocaleString(i18n.language === 'en' ? 'en-US' : 'vi-VN')
    : null

  let statusLine: React.ReactNode = null
  if (status === 'checking') {
    statusLine = t('update.status.checking')
  } else if (status === 'not-available') {
    statusLine = (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        {t('update.upToDate')}
      </span>
    )
  } else if (status === 'available' && latest) {
    statusLine = t('update.availableTitle', { version: latest.version })
  } else if (status === 'downloading' && update?.progress) {
    statusLine = `${t('update.status.downloading', { version: latest?.version ?? '' })} — ${formatBytes(update.progress.received)} / ${formatBytes(update.progress.total)}`
  } else if (status === 'verifying' || status === 'installing') {
    statusLine = t(`update.status.${status}`, { version: latest?.version ?? '' })
  } else if (status === 'error' && update) {
    statusLine = <span className="text-amber-600">{errorText(update)}</span>
  }

  return (
    <section className="mt-6 border-t border-line pt-6">
      <h3 className="text-base font-semibold">{t('update.sectionTitle')}</h3>
      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">{t('update.currentVersion')}</dt>
          <dd className="font-semibold">{update?.currentVersion ?? '—'}</dd>
        </div>
        {lastChecked && (
          <div className="flex gap-2 text-xs">
            <dt className="text-muted">{t('update.lastChecked')}</dt>
            <dd className="text-muted">{lastChecked}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => void check()}
          disabled={busy}
          className="press flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-medium transition hover:bg-sunken disabled:opacity-60"
        >
          {status === 'checking' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>{t('update.checkNow')}</span>
        </button>
        {status === 'available' && latest && (
          <>
            {update?.canInstall ? (
              <button
                onClick={() => void install()}
                className="press flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{t('update.installNow')}</span>
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
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="press rounded-lg border border-line px-2.5 py-1.5 font-medium hover:bg-sunken"
            >
              {showNotes ? t('update.hideNotes') : t('update.viewNotes')}
            </button>
          </>
        )}
      </div>
      {statusLine && <p className="mt-2 text-xs text-muted">{statusLine}</p>}
      {update && !update.canInstall && (
        <p className="mt-1 text-[11px] text-faint">{t('update.devOnlyCheck')}</p>
      )}

      {status === 'available' && latest && showNotes && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-line bg-canvas p-3">
          <ReleaseNotes markdown={latest.notes} />
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={update?.autoCheck ?? true}
          onChange={(e) => void setAutoCheck(e.target.checked)}
        />
        <span>
          <span className="font-medium">{t('update.autoCheck')}</span>
          <span className="block text-xs text-muted">{t('update.autoCheckDesc')}</span>
        </span>
      </label>
    </section>
  )
}
