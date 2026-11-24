import { AlertTriangle, Download, LogIn, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/useAppStore'

export function OnboardingBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { agyStatus, checkingStatus, settings, refreshAgyStatus, startGoogleOAuth } = useAppStore()

  if (checkingStatus || !agyStatus) return null
  if (agyStatus.installed && agyStatus.authenticated) return null

  const isLight = settings.theme === 'light'

  return (
    <div
      className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
        isLight
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div>
          <div className="font-semibold">
            {!agyStatus.installed
              ? t('onboarding.missingAgyTitle')
              : t('onboarding.needLoginTitle')}
          </div>
          <div className="mt-0.5 opacity-85">
            {!agyStatus.installed
              ? t('onboarding.missingAgyDesc')
              : t('onboarding.needLoginDesc')}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!agyStatus.installed ? (
          <button
            onClick={() => void window.googleAI.installAgy()}
            className="press flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('settings.installAgy')}</span>
          </button>
        ) : (
          <button
            onClick={() => void startGoogleOAuth()}
            className="press flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Đăng nhập Google OAuth2</span>
          </button>
        )}

        <button
          onClick={() => void refreshAgyStatus()}
          className={`press flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition ${
            isLight
              ? 'border-amber-300 bg-surface text-amber-900 hover:bg-amber-100'
              : 'border-amber-400/30 bg-surface text-amber-100 hover:bg-sunken'
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{t('settings.recheck')}</span>
        </button>
      </div>
    </div>
  )
}
