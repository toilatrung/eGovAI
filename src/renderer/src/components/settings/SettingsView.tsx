import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Info,
  AlertCircle,
  RefreshCw,
  Download,
  LogIn,
  Globe,
  Palette,
  Cpu,
  Shield,
  Edit3,
  Check,
  Coins,
  Layers,
  Monitor
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  pickFastComputerUseModel,
  type DesktopWindowItem,
  type ExecutionMode,
  type ReasoningEffort
} from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'
import { computeTokenStats, formatCompactTokens } from '../../utils/tokenStats'
import { AboutPage } from './AboutPage'
import { McpConfigSection } from './McpConfigSection'
import { DataProtectionSection } from './DataProtectionSection'

export function SettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    agyStatus,
    checkingStatus,
    quota,
    loadingQuota,
    computerUseStatus,
    conversations,
    activeConversationId,
    settings,
    setActiveView,
    updateSettings,
    refreshAgyStatus,
    refreshQuota,
    refreshComputerUseStatus,
    startGoogleOAuth
  } = useAppStore()
  const [customPath, setCustomPath] = useState(settings.agyPathOverride)
  const [showAbout, setShowAbout] = useState(false)
  const [desktopWindows, setDesktopWindows] = useState<DesktopWindowItem[] | null>(null)
  const [scanningWindows, setScanningWindows] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState(
    settings.accountDisplayName || agyStatus?.account?.displayName || ''
  )
  const [profileEmail, setProfileEmail] = useState(
    settings.accountEmail || agyStatus?.account?.email || ''
  )
  const isLight = settings.theme === 'light'

  useEffect(() => {
    setProfileName(settings.accountDisplayName || agyStatus?.account?.displayName || '')
    setProfileEmail(settings.accountEmail || agyStatus?.account?.email || '')
  }, [
    settings.accountDisplayName,
    settings.accountEmail,
    agyStatus?.account?.displayName,
    agyStatus?.account?.email
  ])

  useEffect(() => {
    if (agyStatus?.authenticated && !quota && !loadingQuota) {
      void refreshQuota()
    }
  }, [agyStatus?.authenticated, quota, loadingQuota, refreshQuota])

  const handleSaveProfile = async (): Promise<void> => {
    await updateSettings({
      accountDisplayName: profileName.trim(),
      accountEmail: profileEmail.trim()
    })
    await refreshAgyStatus()
    setEditingProfile(false)
  }

  const tokenStats = useMemo(
    () => computeTokenStats(conversations, activeConversationId, agyStatus?.models ?? []),
    [conversations, activeConversationId, agyStatus?.models]
  )

  const breakdownSum = Math.max(
    1,
    tokenStats.allTime.inputTokens +
      tokenStats.allTime.outputTokens +
      tokenStats.allTime.thinkingTokens +
      tokenStats.allTime.cacheReadTokens
  )

  const cardClass = `rounded-2xl border p-5 space-y-4 ${
    isLight ? 'border-line bg-surface' : 'border-line bg-surface'
  }`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div
        className={`flex items-center gap-3 border-b px-6 py-4 ${
          isLight ? 'border-line bg-surface' : 'border-line bg-surface'
        }`}
      >
        <button
          aria-label={t(showAbout ? 'settings.about.backToSettings' : 'settings.backToChat')}
          onClick={() => showAbout ? setShowAbout(false) : setActiveView('chat')}
          className={`press flex h-8 w-8 items-center justify-center rounded-lg transition ${
            isLight ? 'hover:bg-sunken' : 'hover:bg-sunken'
          }`}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="font-display text-[17px] font-semibold tracking-[-0.01em]">{t(showAbout ? 'settings.about.title' : 'settings.title')}</h1>
          {!showAbout && <p className="text-xs text-faint">{t('settings.subtitle')}</p>}
        </div>
        {!showAbout && (
          <button
            onClick={() => setShowAbout(true)}
            className={`press ml-auto flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              isLight ? 'border-line hover:bg-sunken' : 'border-line-strong hover:bg-sunken'
            }`}
          >
            <Info aria-hidden="true" className="h-4 w-4" />
            {t('settings.about.title')}
          </button>
        )}
      </div>

      {/* Content */}
      {showAbout && <AboutPage isLight={isLight} />}
      <div hidden={showAbout} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* Official Antigravity Engine Status */}
          <section className={cardClass}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Cpu className="h-4 w-4 text-brand" />
                <span>{t('settings.coreSection')}</span>
              </div>
              <button
                onClick={() => void refreshAgyStatus()}
                disabled={checkingStatus}
                className={`press flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  isLight
                    ? 'border-line bg-canvas hover:bg-sunken'
                    : 'border-line-strong bg-surface hover:bg-sunken'
                }`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
                <span>{t('settings.recheck')}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div
                className={`rounded-xl border p-3 ${
                  isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
                }`}
              >
                <div className="text-faint">{t('settings.version')}</div>
                <div className="mt-1 font-semibold">
                  {agyStatus?.version ? `Lõi AI v${agyStatus.version}` : '—'}
                </div>
              </div>

              <div
                className={`rounded-xl border p-3 ${
                  isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-faint">Tài khoản đang sử dụng</div>
                  {agyStatus?.authenticated && !editingProfile && (
                    <button
                      onClick={() => setEditingProfile(true)}
                      className="press flex items-center gap-1 text-[11px] font-medium text-blue-500 hover:text-blue-400"
                    >
                      <Edit3 className="h-3 w-3" />
                      <span>Sửa</span>
                    </button>
                  )}
                </div>

                {agyStatus?.authenticated ? (
                  editingProfile ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Tên hiển thị (VD: Nguyễn Văn A)"
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                          isLight
                            ? 'border-line-strong bg-surface text-ink'
                            : 'border-line-strong bg-canvas text-ink'
                        }`}
                      />
                      <input
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        placeholder="Email Google (VD: ten@gmail.com)"
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                          isLight
                            ? 'border-line-strong bg-surface text-ink'
                            : 'border-line-strong bg-canvas text-ink'
                        }`}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setEditingProfile(false)}
                          className="press rounded-lg px-2.5 py-1 text-[11px] text-faint hover:bg-sunken"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={() => void handleSaveProfile()}
                          className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                        >
                          <Check className="h-3 w-3" />
                          <span>Lưu</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
                        {(agyStatus.account?.displayName || agyStatus.account?.email || 'G')
                          .slice(0, 1)
                          .toUpperCase()}
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-surface" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {agyStatus.account?.displayName || 'Tài khoản Google'}
                        </div>
                        <div className="truncate text-[11px] text-faint">
                          {agyStatus.account?.email || `${agyStatus.models.length} mô hình sẵn sàng`}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="mt-1.5 flex items-center gap-1.5 font-semibold">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-amber-500">{t('settings.unauthenticated')}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-xs">
              <div className="text-faint">{t('settings.binaryPath')}</div>
              <div className="mt-1 truncate font-mono text-[11px] opacity-80">
                {agyStatus?.binaryPath ?? 'Chưa phát hiện'}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {!agyStatus?.installed && (
                <button
                  onClick={() => void window.googleAI.installAgy()}
                  className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{t('settings.installAgy')}</span>
                </button>
              )}
              {agyStatus?.installed && (
                <button
                  onClick={() => void startGoogleOAuth()}
                  className="press flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>
                    {agyStatus.authenticated
                      ? 'Đổi tài khoản Google (OAuth2)'
                      : 'Đăng nhập bằng Google (OAuth2)'}
                  </span>
                </button>
              )}
            </div>

            <div className="pt-1">
              <label className="block text-xs text-faint">{t('settings.customAgyPath')}</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="C:\Users\...\AppData\Local\agy\bin\agy.exe"
                  className={`flex-1 rounded-xl border px-3 py-2 font-mono text-xs outline-none ${
                    isLight
                      ? 'border-line bg-canvas text-ink'
                      : 'border-line-strong bg-surface text-ink'
                  }`}
                />
                <button
                  onClick={async () => {
                    await updateSettings({ agyPathOverride: customPath.trim() })
                    await refreshAgyStatus()
                  }}
                  className={`press rounded-xl px-4 py-2 text-xs font-medium transition ${
                    isLight
                      ? 'bg-sunken text-ink hover:bg-line-strong'
                      : 'bg-sunken text-ink hover:bg-line-strong'
                  }`}
                >
                  Lưu
                </button>
              </div>
            </div>
          </section>

          {/* Quota & Token Usage */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="h-4 w-4 text-amber-500" />
                <span>Hạn mức (Quota) &amp; Thống kê Token</span>
              </div>
              <div className="flex items-center gap-2">
                {agyStatus?.authenticated && (
                  <button
                    onClick={() => void refreshQuota()}
                    disabled={loadingQuota}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                      isLight
                        ? 'border-line bg-canvas hover:bg-sunken'
                        : 'border-line-strong bg-surface hover:bg-sunken'
                    }`}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingQuota ? 'animate-spin' : ''}`} />
                    <span>{loadingQuota ? 'Đang tải...' : 'Làm mới quota'}</span>
                  </button>
                )}
                {agyStatus?.authenticated && (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-500">
                    {agyStatus.models.length} mô hình
                  </span>
                )}
              </div>
            </div>

            {/* Live Server Quota Bars from official agy /quota */}
            {agyStatus?.authenticated && (
              <div className="space-y-2.5">
                {loadingQuota && !quota ? (
                  <div className="rounded-xl border border-line bg-canvas p-4 text-center text-xs text-faint">
                    Đang tải hạn mức (Quota) trực tiếp từ máy chủ Google...
                  </div>
                ) : quota && quota.groups.length > 0 ? (
                  <div className="space-y-2.5">
                    {quota.groups.map((group) => {
                      const groupTitle =
                        group.name === 'Gemini Models'
                          ? 'Nhóm mô hình Gemini'
                          : group.name === 'Claude and GPT models'
                            ? 'Nhóm mô hình Claude & GPT'
                            : group.name
                      return (
                        <div
                          key={group.name}
                          className="space-y-2.5 rounded-xl border border-line bg-canvas p-3.5 text-xs"
                        >
                          <div>
                            <div className="font-semibold">{groupTitle}</div>
                            {group.description && (
                              <div className="mt-0.5 text-[11px] text-faint">
                                {group.description.replace(
                                  /^Models within this group:\s*/i,
                                  'Gồm các mô hình: '
                                )}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            {group.buckets.map((bucket) => {
                              const pct = Math.round(bucket.remainingFraction * 100)
                              const barColor =
                                pct >= 50
                                  ? 'bg-emerald-500'
                                  : pct >= 20
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                              const bucketLabel =
                                bucket.window === '5h'
                                  ? 'Hạn mức 5 giờ còn lại'
                                  : bucket.window === 'weekly'
                                    ? 'Hạn mức tuần còn lại'
                                    : bucket.name

                              let resetLabel = ''
                              if (bucket.resetTime) {
                                const resetMs = Date.parse(bucket.resetTime)
                                if (!Number.isNaN(resetMs)) {
                                  const diffMin = Math.max(0, Math.round((resetMs - Date.now()) / 60000))
                                  const days = Math.floor(diffMin / (60 * 24))
                                  const hours = Math.floor((diffMin % (60 * 24)) / 60)
                                  const mins = diffMin % 60
                                  const rel =
                                    days > 0
                                      ? `${days} ngày ${hours} giờ`
                                      : hours > 0
                                        ? `${hours} giờ ${mins} phút`
                                        : `${mins} phút`
                                  const timeStr = new Date(resetMs).toLocaleString('vi-VN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    day: '2-digit',
                                    month: '2-digit'
                                  })
                                  resetLabel = `Làm mới sau ${rel} (${timeStr})`
                                }
                              }

                              return (
                                <div key={bucket.id} className="space-y-1">
                                  <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="font-medium">{bucketLabel}</span>
                                    <span className="font-mono font-semibold">{pct}%</span>
                                  </div>
                                  <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
                                    <div
                                      style={{ width: `${pct}%` }}
                                      className={`h-full rounded-full transition-all ${barColor}`}
                                    />
                                  </div>
                                  {resetLabel && (
                                    <div className="text-[10px] text-faint">{resetLabel}</div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    <div className="text-right text-[10px] text-faint">
                      Cập nhật lúc {new Date(quota.fetchedAt).toLocaleTimeString('vi-VN')}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line bg-canvas p-3 text-xs text-faint">
                    Chưa lấy được thông tin hạn mức — nhấn <strong>Làm mới quota</strong> để thử lại.
                  </div>
                )}
              </div>
            )}

            {/* 3 Summary Cards */}
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-canvas p-3">
                <div className="text-faint">Token hôm nay</div>
                <div className="mt-1 text-lg font-bold tracking-tight">
                  {formatCompactTokens(tokenStats.today.totalTokens)}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {tokenStats.today.turns} lượt phản hồi
                </div>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3">
                <div className="text-faint">Tổng token đã dùng</div>
                <div className="mt-1 text-lg font-bold tracking-tight">
                  {formatCompactTokens(tokenStats.allTime.totalTokens)}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {tokenStats.allTime.turns} lượt · {conversations.length} hội thoại
                </div>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3">
                <div className="text-faint">Phiên hiện tại / Cache</div>
                <div className="mt-1 text-lg font-bold tracking-tight">
                  {formatCompactTokens(tokenStats.activeConversation.totalTokens)}
                </div>
                <div className="mt-0.5 text-[11px] text-emerald-500">
                  Tiết kiệm đệm: {tokenStats.cacheHitPercent}% (
                  {formatCompactTokens(tokenStats.allTime.cacheReadTokens)})
                </div>
              </div>
            </div>

            {/* Distribution Bar + 4 Detailed Counters */}
            <div className="space-y-2.5 rounded-xl border border-line bg-canvas p-3.5 text-xs">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium">Chi tiết loại token tiêu thụ</span>
                <span className="text-faint">
                  Tổng: {tokenStats.allTime.totalTokens.toLocaleString('vi-VN')} token
                </span>
              </div>

              <div className="flex h-2 w-full overflow-hidden rounded-sm bg-sunken">
                <div
                  style={{
                    width: `${(tokenStats.allTime.inputTokens / breakdownSum) * 100}%`
                  }}
                  className="bg-blue-500"
                  title="Token đầu vào"
                />
                <div
                  style={{
                    width: `${(tokenStats.allTime.outputTokens / breakdownSum) * 100}%`
                  }}
                  className="bg-emerald-500"
                  title="Token đầu ra"
                />
                <div
                  style={{
                    width: `${(tokenStats.allTime.thinkingTokens / breakdownSum) * 100}%`
                  }}
                  className="bg-indigo-500"
                  title="Token suy luận"
                />
                <div
                  style={{
                    width: `${(tokenStats.allTime.cacheReadTokens / breakdownSum) * 100}%`
                  }}
                  className="bg-amber-500"
                  title="Token bộ nhớ đệm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span>Đầu vào (Input)</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold">
                    {tokenStats.allTime.inputTokens.toLocaleString('vi-VN')}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span>Đầu ra (Output)</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold">
                    {tokenStats.allTime.outputTokens.toLocaleString('vi-VN')}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="h-2 w-2 rounded-full bg-indigo-500" />
                    <span>Suy luận (Thinking)</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold">
                    {tokenStats.allTime.thinkingTokens.toLocaleString('vi-VN')}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span>Bộ nhớ đệm (Cache)</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold">
                    {tokenStats.allTime.cacheReadTokens.toLocaleString('vi-VN')}
                  </div>
                </div>
              </div>
            </div>

            {/* Per-model Usage */}
            {tokenStats.byModel.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Phân bổ theo mô hình đã dùng</span>
                </div>
                <div className="space-y-1">
                  {tokenStats.byModel.slice(0, 5).map((item) => (
                    <div
                      key={item.modelId}
                      className="flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs"
                    >
                      <span className="truncate font-medium">{item.modelName}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {item.totalTokens.toLocaleString('vi-VN')} token · {item.turns} lượt
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Language & Vietnamese Reply Preference */}
          <section className={cardClass}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Globe className="h-4 w-4 text-brand" />
              <span>{t('settings.languageSection')}</span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium">{t('settings.uiLanguage')}</div>
              </div>
              <select
                value={settings.language}
                onChange={(e) =>
                  void updateSettings({ language: e.target.value as 'vi' | 'en' })
                }
                className={`rounded-lg border px-3 py-1.5 text-xs outline-none ${
                  isLight
                    ? 'border-line bg-canvas text-ink'
                    : 'border-line-strong bg-surface text-ink'
                }`}
              >
                <option value="vi">Tiếng Việt (Mặc định)</option>
                <option value="en">English</option>
              </select>
            </div>

            <label className="flex cursor-pointer items-start justify-between gap-4 pt-1">
              <div>
                <div className="text-xs font-medium">{t('settings.preferVietnamese')}</div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {t('settings.preferVietnameseDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.preferVietnameseReplies}
                onChange={(e) =>
                  void updateSettings({ preferVietnameseReplies: e.target.checked })
                }
                className="mt-1 h-4 w-4 accent-blue-600"
              />
            </label>
          </section>

          {/* Appearance */}
          <section className={cardClass}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Palette className="h-4 w-4 text-brand" />
              <span>{t('settings.appearanceSection')}</span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="text-xs font-medium">{t('settings.theme')}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => void updateSettings({ theme: 'dark' })}
                  className={`press rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    settings.theme === 'dark'
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : isLight
                        ? 'border-line-strong bg-surface text-muted hover:bg-sunken'
                        : 'border-line-strong text-muted hover:bg-sunken'
                  }`}
                >
                  {t('settings.dark')}
                </button>
                <button
                  onClick={() => void updateSettings({ theme: 'light' })}
                  className={`press rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    settings.theme === 'light'
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : isLight
                        ? 'border-line-strong bg-surface text-muted hover:bg-sunken'
                        : 'border-line-strong text-muted hover:bg-sunken'
                  }`}
                >
                  {t('settings.light')}
                </button>
              </div>
            </div>
          </section>

          {/* Default Agent Options */}
          <section className={cardClass}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4 text-brand" />
              <span>{t('settings.agentSection')}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium">{t('settings.defaultModel')}</label>
                <select
                  value={settings.defaultModelId}
                  onChange={(e) => void updateSettings({ defaultModelId: e.target.value })}
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none ${
                    isLight
                      ? 'border-line bg-canvas text-ink'
                      : 'border-line-strong bg-surface text-ink'
                  }`}
                >
                  <option value="">{t('settings.autoModel')}</option>
                  {agyStatus?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium">{t('settings.defaultEffort')}</label>
                <select
                  value={settings.effort}
                  onChange={(e) =>
                    void updateSettings({ effort: e.target.value as ReasoningEffort })
                  }
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none ${
                    isLight
                      ? 'border-line bg-canvas text-ink'
                      : 'border-line-strong bg-surface text-ink'
                  }`}
                >
                  <option value="low">{t('chat.effortLevels.low')}</option>
                  <option value="medium">{t('chat.effortLevels.medium')}</option>
                  <option value="high">{t('chat.effortLevels.high')}</option>
                  <option value="xhigh">{t('chat.effortLevels.xhigh')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium">{t('settings.defaultMode')}</label>
                <select
                  value={settings.mode}
                  onChange={(e) => void updateSettings({ mode: e.target.value as ExecutionMode })}
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none ${
                    isLight
                      ? 'border-line bg-canvas text-ink'
                      : 'border-line-strong bg-surface text-ink'
                  }`}
                >
                  <option value="default">{t('chat.modes.default')}</option>
                  <option value="plan">{t('chat.modes.plan')}</option>
                  <option value="accept-edits">{t('chat.modes.accept-edits')}</option>
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer items-start justify-between gap-4 pt-2">
              <div>
                <div className="text-xs font-medium">{t('settings.sandbox')}</div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {t('settings.sandboxDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.useSandbox}
                onChange={(e) => void updateSettings({ useSandbox: e.target.checked })}
                className="mt-1 h-4 w-4 accent-blue-600"
              />
            </label>
          </section>

          {/* Computer Use (Playwright + vercel-labs/agent-desktop) */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Monitor className="h-4 w-4 text-emerald-500" />
                <span>Điều khiển máy tính &amp; Trình duyệt (Playwright + agent-desktop)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {computerUseStatus?.browserAvailable ? (
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-medium text-blue-500">
                    Playwright · {computerUseStatus.browserName ?? 'Trình duyệt'} sẵn sàng
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-500">
                    Playwright · Chưa thấy Chrome/Edge
                  </span>
                )}
                {computerUseStatus?.installed ? (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-500">
                    agent-desktop v{computerUseStatus.version ?? '1.3.1'} sẵn sàng
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-500">
                    agent-desktop chưa phát hiện
                  </span>
                )}
              </div>
            </div>

            <label className="flex cursor-pointer items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium">
                  Cho phép AI điều khiển trình duyệt web (Playwright) và ứng dụng Windows (agent-desktop)
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  Hỗ trợ gom chuỗi thao tác, chụp màn hình cho ứng dụng Electron (Zalo, Teams) và xin phạm vi duyệt một lần theo việc. Gõ/nhập nội dung, Enter/nút gửi-xác nhận, xóa và mở URL lạ vẫn luôn hỏi lại.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.computerUseEnabled}
                onChange={(e) =>
                  void updateSettings({ computerUseEnabled: e.target.checked })
                }
                className="mt-1 h-4 w-4 accent-blue-600"
              />
            </label>

            {(() => {
              const fastModel = pickFastComputerUseModel(agyStatus?.models ?? [])
              if (!fastModel) return null
              return (
                <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-canvas px-3 py-2.5">
                  <div>
                    <div className="text-xs font-medium">
                      Dùng mô hình nhanh cho điều khiển máy
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Khi bật, các lượt có bật Điều khiển máy sẽ dùng mô hình nhanh{' '}
                      <span className="font-mono text-ink">{fastModel.name}</span> để rút ngắn thời gian phản hồi giữa các thao tác. Mặc định tắt (giữ nguyên mô hình bạn chọn).
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.fastModelForComputerUse)}
                    onChange={(e) =>
                      void updateSettings({ fastModelForComputerUse: e.target.checked })
                    }
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                </label>
              )
            })()}

            {computerUseStatus?.binaryPath && (
              <div className="text-xs">
                <div className="text-faint">Tệp thực thi native agent-desktop</div>
                <div className="mt-1 truncate font-mono text-[11px] opacity-80">
                  {computerUseStatus.binaryPath}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  setScanningWindows(true)
                  try {
                    await refreshComputerUseStatus()
                    const wins = await window.googleAI.listDesktopWindows()
                    setDesktopWindows(wins)
                  } finally {
                    setScanningWindows(false)
                  }
                }}
                disabled={scanningWindows}
                className={`press flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  isLight
                    ? 'border-line bg-canvas hover:bg-sunken'
                    : 'border-line-strong bg-surface hover:bg-sunken'
                }`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanningWindows ? 'animate-spin' : ''}`} />
                <span>{scanningWindows ? 'Đang quét...' : 'Kiểm tra & quét cửa sổ đang mở'}</span>
              </button>
            </div>

            {desktopWindows !== null && (
              <div className="space-y-1 rounded-xl border border-line bg-canvas p-3 text-xs">
                <div className="font-medium">
                  Phát hiện {desktopWindows.length} cửa sổ Windows đang mở:
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto pt-1">
                  {desktopWindows.length === 0 ? (
                    <div className="text-[11px] text-faint">Không thấy cửa sổ nào.</div>
                  ) : (
                    desktopWindows.slice(0, 15).map((w) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate font-medium">{w.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-faint">{w.app}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>

          {/* MCP Servers & Technical JSON Configs (moved completely inside Settings) */}
          {/* Data protection: retention, wipe, audit export */}
          <DataProtectionSection cardClass={cardClass} isLight={isLight} />

          <McpConfigSection cardClass={cardClass} isLight={isLight} />
        </div>
      </div>
    </div>
  )
}
