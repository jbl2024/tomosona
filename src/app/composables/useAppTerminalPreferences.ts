import { ref } from 'vue'

/**
 * Module: useAppTerminalPreferences
 *
 * Owns the persisted, app-wide presentation preferences for xterm.js. Terminal
 * sessions consume this state but do not own it, so changes survive sessions.
 */

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

/** User-configurable xterm.js display options exposed by Settings. */
export type TerminalPreferences = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  scrollback: number
}

export const TERMINAL_PREFERENCES_STORAGE_KEY = 'tomosona.terminal.preferences'

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  fontFamily: 'SF Mono',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

function normalizePreferences(value: unknown): TerminalPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<TerminalPreferences> : {}
  return {
    fontFamily: typeof raw.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : DEFAULT_TERMINAL_PREFERENCES.fontFamily,
    fontSize: clamp(raw.fontSize, DEFAULT_TERMINAL_PREFERENCES.fontSize, 8, 32),
    lineHeight: clamp(raw.lineHeight, DEFAULT_TERMINAL_PREFERENCES.lineHeight, 1, 2),
    letterSpacing: clamp(raw.letterSpacing, DEFAULT_TERMINAL_PREFERENCES.letterSpacing, -2, 5),
    cursorStyle: raw.cursorStyle === 'bar' || raw.cursorStyle === 'underline' ? raw.cursorStyle : 'block',
    cursorBlink: typeof raw.cursorBlink === 'boolean' ? raw.cursorBlink : DEFAULT_TERMINAL_PREFERENCES.cursorBlink,
    scrollback: Math.round(clamp(raw.scrollback, DEFAULT_TERMINAL_PREFERENCES.scrollback, 100, 100000))
  }
}

/** Loads, validates, persists, and updates global terminal preferences. */
export function useAppTerminalPreferences(storageKey = TERMINAL_PREFERENCES_STORAGE_KEY) {
  const terminalPreferences = ref<TerminalPreferences>({ ...DEFAULT_TERMINAL_PREFERENCES })

  function loadTerminalPreferences() {
    if (typeof window === 'undefined') return
    try {
      terminalPreferences.value = normalizePreferences(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
    } catch {
      terminalPreferences.value = { ...DEFAULT_TERMINAL_PREFERENCES }
    }
  }

  function setTerminalPreferences(next: Partial<TerminalPreferences>) {
    terminalPreferences.value = normalizePreferences({ ...terminalPreferences.value, ...next })
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, JSON.stringify(terminalPreferences.value))
  }

  function resetTerminalPreferences() {
    setTerminalPreferences(DEFAULT_TERMINAL_PREFERENCES)
  }

  return { terminalPreferences, loadTerminalPreferences, setTerminalPreferences, resetTerminalPreferences }
}
