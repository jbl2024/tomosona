import { computed, ref } from 'vue'

/**
 * Module: useAppTheme
 *
 * Purpose:
 * - Own app theme preference persistence and DOM class synchronization.
 */

/** Stores the explicit user choice or the sentinel value that follows the OS. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Configures storage and environment hooks for the app theme controller. */
export type UseAppThemeOptions = {
  storageKey?: string
  root?: HTMLElement
  matchMedia?: () => boolean
}

/** Owns theme preference state and synchronizes `.dark` on the provided root. */
export function useAppTheme(options: UseAppThemeOptions = {}) {
  const storageKey = options.storageKey ?? 'tomosona.theme.preference'
  const themePreference = ref<ThemePreference>('system')
  const isSystemDark = options.matchMedia ?? (() =>
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia) &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  const resolvedTheme = computed<'light' | 'dark'>(() => {
    if (themePreference.value === 'system') {
      return isSystemDark() ? 'dark' : 'light'
    }
    return themePreference.value
  })

  /** Applies the resolved theme to the configured root element. */
  function applyTheme() {
    const root = options.root ?? document.documentElement
    root.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  /** Loads the persisted preference, defaulting back to `system` when absent or invalid. */
  function loadThemePreference() {
    const saved = window.localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      themePreference.value = saved
      return
    }
    themePreference.value = 'system'
  }

  /** Persists the current preference without altering the DOM. */
  function persistThemePreference() {
    window.localStorage.setItem(storageKey, themePreference.value)
  }

  /** Updates preference, persists it, and synchronizes the DOM in one step. */
  function setThemePreference(next: ThemePreference) {
    themePreference.value = next
    persistThemePreference()
    applyTheme()
  }

  /** Reapplies the theme only when the user follows the system color scheme. */
  function onSystemThemeChanged() {
    if (themePreference.value === 'system') {
      applyTheme()
    }
  }

  return {
    themePreference,
    resolvedTheme,
    applyTheme,
    loadThemePreference,
    persistThemePreference,
    setThemePreference,
    onSystemThemeChanged
  }
}
