import { useTranslation } from 'react-i18next'
import { EgovMark, EgovWordmark } from '../brand/EgovLogo'

export function AboutPage({ isLight }: { isLight: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const panel = isLight ? 'border-line bg-surface' : 'border-line bg-surface'
  const secondaryText = isLight ? 'text-muted' : 'text-muted'
  const divider = isLight ? 'border-line' : 'border-line'

  return (
    <article className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className={`mx-auto max-w-3xl rounded-2xl border p-6 sm:p-8 ${panel}`}>
        <div className="flex items-center gap-3.5">
          <EgovMark size={52} />
          <div>
            <h2 className="m-0 text-[28px] leading-none">
              <EgovWordmark className="text-[28px]" />
            </h2>
            <p className="mt-1.5 text-[11.5px] font-semibold text-muted">{t('app.subtitle')}</p>
          </div>
        </div>
        <p className={`mt-3 max-w-prose text-sm leading-6 ${secondaryText}`}>
          {t('settings.about.description')}
        </p>
        <section className="mt-6">
          <h3 className="text-base font-semibold">{t('settings.about.missionTitle')}</h3>
          <p className={`mt-2 max-w-prose text-sm leading-6 ${secondaryText}`}>
            {t('settings.about.mission')}
          </p>
        </section>
        <section className="mt-6">
          <h3 className="text-base font-semibold">{t('settings.about.goalsTitle')}</h3>
          <ul className={`mt-2 max-w-prose list-disc space-y-1 pl-5 text-sm leading-6 ${secondaryText}`}>
            <li>{t('settings.about.documentGoal')}</li>
            <li>{t('settings.about.workflowGoal')}</li>
            <li>{t('settings.about.reviewGoal')}</li>
          </ul>
        </section>
        <section className={`mt-6 border-t pt-6 ${divider}`}>
          <h3 className="text-base font-semibold">{t('settings.about.developers')}</h3>
          <dl className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold">Trịnh Văn Thành</dt>
              <dd className={`mt-1 text-sm leading-6 ${secondaryText}`}>{t('settings.about.thanhRole')}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold">Trịnh Quang Trung</dt>
              <dd className={`mt-1 text-sm leading-6 ${secondaryText}`}>{t('settings.about.trungRole')}</dd>
            </div>
          </dl>
        </section>
        <footer className={`mt-6 border-t pt-4 text-xs leading-5 ${divider} ${secondaryText}`}>
          <p>{t('settings.about.copyright')}</p>
          <p>{t('settings.about.license')}</p>
        </footer>
      </div>
    </article>
  )
}
