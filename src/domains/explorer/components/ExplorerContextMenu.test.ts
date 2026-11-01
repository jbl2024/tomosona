import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ExplorerContextMenu from './ExplorerContextMenu.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(ExplorerContextMenu, {
          x: 24,
          y: 24,
          canOpen: true,
          canPaste: true,
          canRename: true,
          canDelete: true,
          canConvert: true,
          onAction: (action: string) => events.push(action)
        })
    }
  }))

  app.mount(root)
  return { app, events }
}

describe('ExplorerContextMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps icons limited to high-signal actions and marks destructive rows', async () => {
    const mounted = mountHarness()
    await nextTick()

    const menu = document.body.querySelector('.explorer-context-menu')
    const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('.explorer-context-menu-item') ?? [])
    const iconLabels = buttons
      .filter((button) => button.querySelector('svg'))
      .map((button) => button.textContent?.trim())

    expect(iconLabels).toEqual([
      'Open externally',
      'Delete',
      'New note',
      'New folder'
    ])
    expect(buttons.find((button) => button.textContent?.includes('Delete'))?.getAttribute('data-tone')).toBe('danger')
    expect(buttons.find((button) => button.textContent?.includes('Open'))?.querySelector('.ui-menu-item-icon-spacer')).toBeTruthy()

    mounted.app.unmount()
  })

  it('renders convert to Word only when a markdown target can be converted', async () => {
    const events: string[] = []
    const mounted = createApp(defineComponent({
      setup() {
        return () =>
          h(ExplorerContextMenu, {
            x: 24,
            y: 24,
            canOpen: true,
            canPaste: true,
            canRename: true,
            canDelete: true,
            canConvert: true,
            onAction: (action: string) => events.push(action)
          })
      }
    }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    mounted.mount(root)
    await nextTick()

    const convertButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Convert to Word'
    ) as HTMLButtonElement | undefined

    expect(convertButton).toBeDefined()
    convertButton?.click()
    await nextTick()
    expect(events).toContain('convert-to-word')

    mounted.unmount()
  })

  it('explains disabled actions with a reason instead of hiding them silently', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(ExplorerContextMenu, {
            x: 24,
            y: 24,
            canOpen: false,
            canPaste: false,
            canRename: false,
            canDelete: false,
            canConvert: false,
            onAction: () => {}
          })
      }
    }))
    app.mount(root)
    await nextTick()

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.explorer-context-menu-item'))
    const pasteButton = buttons.find((button) => button.textContent?.trim() === 'Paste')!
    expect(pasteButton.disabled).toBe(true)
    expect(pasteButton.getAttribute('aria-disabled')).toBe('true')
    expect(pasteButton.title).toBe('Copy or cut something first')

    const openButton = buttons.find((button) => button.textContent?.trim() === 'Open')!
    expect(openButton.disabled).toBe(true)
    expect(openButton.title).toBe('Select a file or folder first')

    app.unmount()
  })
})
