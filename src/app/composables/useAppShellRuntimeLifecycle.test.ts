import { afterEach, describe, expect, it, vi } from 'vitest'

const warmupSpellcheckDictionaries = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../../domains/editor/lib/tiptap/extensions/Spellcheck', () => ({
  warmupSpellcheckDictionaries
}))

import { useAppShellRuntimeLifecycle } from './useAppShellRuntimeLifecycle'

describe('useAppShellRuntimeLifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    warmupSpellcheckDictionaries.mockClear()
  })

  it('boots global runtime effects once and tears them down symmetrically', async () => {
    const mediaQuery = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as MediaQueryList

    const initializeShellPersistence = vi.fn()
    const loadSpellcheckPreference = vi.fn()
    const workspaceStart = vi.fn(async () => {})
    const workspaceDispose = vi.fn()
    const onSystemThemeChanged = vi.fn()
    const onGlobalPointerDown = vi.fn()
    const onWindowResize = vi.fn()
    const onPointerMove = vi.fn()
    const stopResize = vi.fn()
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const runtime = useAppShellRuntimeLifecycle({
      persistencePort: {
        initializeShellPersistence
      },
      spellcheckPort: {
        loadSpellcheckPreference
      },
      workspaceLifecyclePort: {
        start: workspaceStart,
        dispose: workspaceDispose
      },
      windowPort: {
        onGlobalPointerDown,
        onWindowResize,
        onPointerMove,
        stopResize
      },
      themePort: {
        mediaQuery,
        onSystemThemeChanged
      }
    })

    await runtime.start()
    await runtime.start()

    expect(initializeShellPersistence).toHaveBeenCalledTimes(1)
    expect(loadSpellcheckPreference).toHaveBeenCalledTimes(1)
    expect(warmupSpellcheckDictionaries).toHaveBeenCalledTimes(1)
    expect(workspaceStart).toHaveBeenCalledTimes(1)
    expect(mediaQuery.addEventListener).toHaveBeenCalledWith('change', onSystemThemeChanged)
    expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', onGlobalPointerDown, true)
    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', onWindowResize)
    expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', onPointerMove)
    expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', stopResize)

    runtime.dispose()

    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', onSystemThemeChanged)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', onGlobalPointerDown, true)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', onWindowResize)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', onPointerMove)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', stopResize)
    expect(workspaceDispose).toHaveBeenCalledTimes(1)
  })
})
