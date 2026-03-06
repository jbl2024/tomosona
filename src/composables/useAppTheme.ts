import { computed, ref } from 'vue'

/**
 * Module: useAppTheme
 *
 * Purpose:
 * - Own app theme preference persistence and DOM class synchronization.
 */

export type ThemePreference = 'light' | 'dark' | 'system'

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

  function applyTheme() {
    const root = options.root ?? document.documentElement
    root.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  function loadThemePreference() {
    const saved = window.localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      themePreference.value = saved
      return
    }
    themePreference.value = 'system'
  }

  function persistThemePreference() {
    window.localStorage.setItem(storageKey, themePreference.value)
  }

  function setThemePreference(next: ThemePreference) {
    themePreference.value = next
    persistThemePreference()
    applyTheme()
  }

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
