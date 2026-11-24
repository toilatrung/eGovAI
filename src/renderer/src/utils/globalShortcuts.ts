import { useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'

export const SIDEBAR_SEARCH_ID = 'sidebar-search'

let installed = false

function focusSidebarSearch(attempt = 0): void {
  const el = document.getElementById(SIDEBAR_SEARCH_ID) as HTMLInputElement | null
  if (el) {
    el.focus()
    el.select()
    return
  }
  if (attempt < 5) requestAnimationFrame(() => focusSidebarSearch(attempt + 1))
}

function onKeyDown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  const key = e.key.toLowerCase()
  const state = useAppStore.getState()

  if (key === 'n') {
    e.preventDefault()
    if (!state.activeProjectId) return
    state.createNewConversation(null)
    requestAnimationFrame(() => document.getElementById('composer-input')?.focus())
    return
  }

  if (key === 'k') {
    e.preventDefault()
    if (!state.sidebarOpen) state.toggleSidebar()
    focusSidebarSearch()
  }
}

/**
 * App-wide shortcuts: Ctrl+N new conversation, Ctrl+K focus conversation
 * search. Installed once for the lifetime of the window, whichever component
 * mounts first, so they keep working when the sidebar or chat view unmounts.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    if (installed) return
    installed = true
    window.addEventListener('keydown', onKeyDown)
  }, [])
}
