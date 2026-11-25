import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { OnboardingBanner } from './components/onboarding/OnboardingBanner'
import { GoogleOAuthModal } from './components/onboarding/GoogleOAuthModal'
import { InteractivePromptBar } from './components/interaction/InteractivePromptBar'
import { ChatCanvas } from './components/chat/ChatCanvas'
import { SkillsCatalogView } from './components/skills/SkillsCatalogView'
import { CustomizationsView } from './components/customizations/CustomizationsView'
import { SettingsView } from './components/settings/SettingsView'
import { AuxiliaryPane } from './components/auxiliary/AuxiliaryPane'
import { UpdateBanner } from './components/update/UpdateBanner'
import { useUpdateStore } from './stores/useUpdateStore'

export function App(): React.JSX.Element {
  const {
    activeView,
    sidebarOpen,
    auxOpen,
    settings,
    bootstrap,
    handleStreamEvent,
    handleOAuthEvent,
    enqueueInteraction,
    setScheduledTasks,
    openInAppBrowser
  } = useAppStore()
  const isLight = settings.theme === 'light'

  useEffect(() => useUpdateStore.getState().init(), [])

  useEffect(() => {
    void bootstrap()
    const unsubStream = window.googleAI.onStreamEvent((event) => {
      handleStreamEvent(event)
    })
    const unsubSched = window.googleAI.onScheduledTasksUpdated((tasks) => {
      setScheduledTasks(tasks)
    })
    const unsubOAuth = window.googleAI.onOAuthEvent((evt) => {
      handleOAuthEvent(evt)
    })
    const unsubInteraction = window.googleAI.onInteractionRequest((req) => {
      enqueueInteraction(req)
    })
    const unsubBrowser = window.googleAI.onBrowserOpen((url) => {
      openInAppBrowser(url || undefined)
    })
    return () => {
      unsubStream()
      unsubSched()
      unsubOAuth()
      unsubInteraction()
      unsubBrowser()
    }
  }, [bootstrap, handleStreamEvent, handleOAuthEvent, enqueueInteraction, setScheduledTasks, openInAppBrowser])

  return (
    <div
      className={`flex h-screen w-screen flex-col overflow-hidden ${
        isLight
          ? 'light-theme bg-canvas text-ink'
          : 'dark-theme bg-canvas text-ink'
      }`}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <OnboardingBanner />

          {activeView === 'chat' && <ChatCanvas />}
          {activeView === 'skills' && <SkillsCatalogView />}
          {activeView === 'customizations' && <CustomizationsView />}
          {activeView === 'settings' && <SettingsView />}

          {/* If user is on another view when an Interactive Prompt arrives, dock it cleanly at the bottom without a blocking popup */}
          {activeView !== 'chat' && (
            <div className="shrink-0 px-6 pb-3">
              <div className="mx-auto max-w-3xl">
                <InteractivePromptBar />
              </div>
            </div>
          )}
        </main>

        {auxOpen && <AuxiliaryPane />}
      </div>

      <GoogleOAuthModal />
      <UpdateBanner />
    </div>
  )
}

export default App
