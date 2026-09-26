/**
 * Module: useAppShellRuntimeLifecycle
 *
 * Purpose:
 * - Own the app-shell runtime boot and teardown that should stay out of App.vue.
 * - Keep the component focused on composing ports while this controller wires
 *   and unwires global side effects.
 */
import { warmupSpellcheckDictionaries } from '../../domains/editor/lib/tiptap/extensions/Spellcheck'

/** Groups the shell persistence bootstrap hooks used during runtime startup. */
export type AppShellRuntimePersistencePort = {
  initializeShellPersistence: () => void
}

/** Groups the workspace lifecycle hooks that need runtime start/stop orchestration. */
export type AppShellRuntimeWorkspaceLifecyclePort = {
  start: () => Promise<void>
  dispose: () => void
}

/** Groups the global spellcheck preference boot hook. */
export type AppShellRuntimeSpellcheckPort = {
  loadSpellcheckPreference: () => void
}

/** Groups the window-level handlers that the runtime attaches and detaches. */
export type AppShellRuntimeWindowPort = {
  onGlobalPointerDown: (event: MouseEvent) => void
  onWindowResize: () => void
  onPointerMove: (event: MouseEvent) => void
  stopResize: () => void
}

/** Groups the system theme change handler and media-query source. */
export type AppShellRuntimeThemePort = {
  mediaQuery: MediaQueryList | null
  onSystemThemeChanged: () => void
}

/** Declares the dependencies required by the app-shell runtime lifecycle controller. */
export type UseAppShellRuntimeLifecycleOptions = {
  persistencePort: AppShellRuntimePersistencePort
  spellcheckPort: AppShellRuntimeSpellcheckPort
  workspaceLifecyclePort: AppShellRuntimeWorkspaceLifecyclePort
  windowPort: AppShellRuntimeWindowPort
  themePort: AppShellRuntimeThemePort
}

/**
 * Owns the global boot/teardown sequence for the shell runtime.
 *
 * Boundary:
 * - This composable only wires global side effects.
 * - Domain and workspace behavior remain in their existing owners.
 */
export function useAppShellRuntimeLifecycle(options: UseAppShellRuntimeLifecycleOptions) {
  let started = false
  let startPromise: Promise<void> | null = null
  let lifecycleGeneration = 0

  function addGlobalListeners() {
    options.themePort.mediaQuery?.addEventListener('change', options.themePort.onSystemThemeChanged)
    window.addEventListener('mousedown', options.windowPort.onGlobalPointerDown, true)
    window.addEventListener('resize', options.windowPort.onWindowResize)
    window.addEventListener('mousemove', options.windowPort.onPointerMove)
    window.addEventListener('mouseup', options.windowPort.stopResize)
  }

  function removeGlobalListeners() {
    options.themePort.mediaQuery?.removeEventListener('change', options.themePort.onSystemThemeChanged)
    window.removeEventListener('mousedown', options.windowPort.onGlobalPointerDown, true)
    window.removeEventListener('resize', options.windowPort.onWindowResize)
    window.removeEventListener('mousemove', options.windowPort.onPointerMove)
    window.removeEventListener('mouseup', options.windowPort.stopResize)
  }

  async function start() {
    if (started) {
      return startPromise ?? undefined
    }

    started = true
    const currentGeneration = ++lifecycleGeneration
    startPromise = (async () => {
      void warmupSpellcheckDictionaries()
      options.persistencePort.initializeShellPersistence()
      options.spellcheckPort.loadSpellcheckPreference()
      addGlobalListeners()
      if (currentGeneration !== lifecycleGeneration) return
      await options.workspaceLifecyclePort.start()
    })()

    try {
      await startPromise
    } catch (err) {
      started = false
      throw err
    } finally {
      startPromise = null
    }
  }

  function dispose() {
    started = false
    startPromise = null
    lifecycleGeneration += 1
    removeGlobalListeners()
    options.workspaceLifecyclePort.dispose()
  }

  return {
    start,
    dispose
  }
}
