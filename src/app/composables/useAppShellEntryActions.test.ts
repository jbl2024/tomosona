import { describe, expect, it, vi } from 'vitest'
import { useAppShellEntryActions } from './useAppShellEntryActions'

describe('useAppShellEntryActions', () => {
  it('binds launchpad entrypoints to the supplied shell actions', async () => {
    const entryActions = useAppShellEntryActions()
    const openQuickOpen = vi.fn(async (_initialQuery?: string) => true)
    const openCommandPalette = vi.fn(async () => true)
    const openTodayNote = vi.fn(async () => true)

    entryActions.bindLaunchpadActionPort({
      openQuickOpen,
      openCommandPalette,
      openTodayNote
    })

    expect(await entryActions.launchpadActionPort.openQuickOpen('>')).toBe(true)
    expect(await entryActions.launchpadActionPort.openCommandPalette()).toBe(true)
    expect(await entryActions.launchpadActionPort.openTodayNote()).toBe(true)

    expect(openQuickOpen).toHaveBeenCalledWith('>')
    expect(openCommandPalette).toHaveBeenCalledTimes(1)
    expect(openTodayNote).toHaveBeenCalledTimes(1)
  })

  it('binds palette and theme actions without changing the return contract', async () => {
    const entryActions = useAppShellEntryActions()
    const openHomeViewFromPalette = vi.fn(() => true)
    const openThemePickerFromPalette = vi.fn(() => true)
    const setThemeFromPalette = vi.fn(async () => false)

    entryActions.bindShellPaletteActionPort({
      openHomeViewFromPalette
    })
    entryActions.bindThemeActionPort({
      openThemePickerFromPalette,
      setThemeFromPalette
    })

    expect(entryActions.shellPaletteActionPort.openHomeViewFromPalette()).toBe(true)
    expect(await entryActions.shellPaletteActionPort.openThemePickerFromPalette()).toBe(true)
    expect(await entryActions.shellPaletteActionPort.setThemeFromPalette('system')).toBe(false)

    expect(openHomeViewFromPalette).toHaveBeenCalledTimes(1)
    expect(openThemePickerFromPalette).toHaveBeenCalledTimes(1)
    expect(setThemeFromPalette).toHaveBeenCalledWith('system')
  })
})
