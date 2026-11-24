import { create } from 'zustand'
import type { UpdateState } from '../../../shared/types'

/** Renderer mirror of the main-process updater (kept apart from useAppStore). */
interface UpdateStoreState {
  update: UpdateState | null
  /** Version the user hid with "Để sau" for this session. */
  dismissedVersion: string | null
  /** The user pressed "Cập nhật ngay" — download/verify errors are then shown in the toast. */
  installRequested: boolean
  init: () => () => void
  check: () => Promise<void>
  install: () => Promise<void>
  skip: (version: string) => Promise<void>
  dismiss: (version: string) => void
  setAutoCheck: (enabled: boolean) => Promise<void>
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  update: null,
  dismissedVersion: null,
  installRequested: false,
  init: () => {
    void window.googleAI.getUpdateState().then((s) => {
      if (s) set({ update: s })
    })
    return window.googleAI.onUpdateState((s) => set({ update: s }))
  },
  check: async () => {
    set({ dismissedVersion: null, installRequested: false })
    const s = await window.googleAI.checkForUpdates()
    if (s) set({ update: s })
  },
  install: async () => {
    set({ installRequested: true, dismissedVersion: null })
    const s = await window.googleAI.installUpdate()
    if (s) set({ update: s })
  },
  skip: async (version) => {
    const s = await window.googleAI.skipUpdateVersion(version)
    set({ dismissedVersion: version, installRequested: false, ...(s ? { update: s } : {}) })
  },
  dismiss: (version) => set({ dismissedVersion: version, installRequested: false }),
  setAutoCheck: async (enabled) => {
    const s = await window.googleAI.setAutoUpdateCheck(enabled)
    if (s) set({ update: s })
  }
}))

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  return `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}
