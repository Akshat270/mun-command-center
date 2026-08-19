import { create } from 'zustand'
import { api } from './api'

export type Toast = { id: number; text: string; tone: 'info' | 'good' | 'warn' | 'bad' }

type AppState = {
  status: any | null
  settings: any | null
  session: any | null
  aiAvailable: boolean
  dbOk: boolean
  online: boolean
  toasts: Toast[]
  paletteOpen: boolean
  sourceChunkId: string | null

  refreshStatus: () => Promise<void>
  setSession: (s: any) => void
  startSession: (name?: string) => Promise<any>
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  setPalette: (open: boolean) => void
  viewSource: (chunkId: string | null) => void
  saveSetting: (key: string, value: unknown) => Promise<void>
}

let toastId = 0

export const useApp = create<AppState>((set, get) => ({
  status: null,
  settings: null,
  session: null,
  aiAvailable: false,
  dbOk: true,
  online: navigator.onLine,
  toasts: [],
  paletteOpen: false,
  sourceChunkId: null,

  refreshStatus: async () => {
    try {
      const [status, settings, session] = await Promise.all([
        api.status(),
        api.settings().catch(() => null),
        api.activeSession().catch(() => null),
      ])
      set({
        status,
        settings,
        session,
        aiAvailable: Boolean(status?.ai?.available),
        dbOk: Boolean(status?.db?.ok),
      })
    } catch {
      // Server unreachable — keep the last known state and flag it once.
      set({ dbOk: false })
    }
  },

  setSession: (session) => set({ session }),

  startSession: async (name) => {
    const session = await api.startSession(name)
    set({ session })
    get().toast('Session started', 'good')
    return session
  },

  toast: (text, tone = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), tone === 'bad' ? 6000 : 3200)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setPalette: (paletteOpen) => set({ paletteOpen }),

  viewSource: (sourceChunkId) => set({ sourceChunkId }),

  saveSetting: async (key, value) => {
    set((s) => ({ settings: { ...(s.settings || {}), [key]: value } }))
    try { await api.saveSettings({ [key]: value }) } catch { /* local state already updated */ }
  },
}))

// Offline detection drives the top-bar indicator and the AI banner copy.
window.addEventListener('online', () => useApp.setState({ online: true }))
window.addEventListener('offline', () => useApp.setState({ online: false }))
