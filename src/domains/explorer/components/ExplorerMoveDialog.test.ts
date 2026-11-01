import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExplorerMoveDialog from './ExplorerMoveDialog.vue'

const parentOf = (path: string) => {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

type DialogProps = {
  root: string
  folders: string[]
  sources: string[]
  recentDestinations?: string[]
  parentOf: (path: string) => string
  onConfirm?: (destinationPath: string) => void
}

function mountDialog(props: DialogProps) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(() => h(ExplorerMoveDialog, props))
  app.mount(root)
  return { root, app }
}

describe('ExplorerMoveDialog', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const baseProps = {
    root: '/vault',
    folders: ['/vault', '/vault/notes', '/vault/notes/deep', '/vault/projects'],
    sources: ['/vault/notes/deep'],
    recentDestinations: ['/vault/projects'],
    parentOf
  }

  it('lists destinations with the root first, recents next, and disabled reasons', async () => {
    const { root, app } = mountDialog(baseProps)
    await nextTick()
    const labels = Array.from(root.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim())
    expect(labels[0]).toContain('Workspace root')
    expect(labels[1]).toContain('projects')
    const disabled = Array.from(root.querySelectorAll('[role="option"][aria-disabled="true"]'))
    expect(disabled.map((el) => el.textContent)).toContainEqual(expect.stringContaining('Already in this folder'))
    app.unmount()
  })

  it('filters destinations by query and emits confirm with the selected path', async () => {
    const onConfirm = vi.fn()
    const { root, app } = mountDialog({ ...baseProps, onConfirm })
    await nextTick()

    const input = root.querySelector('input') as HTMLInputElement
    input.value = 'proj'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('projects')

    const moveButton = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Move') as HTMLButtonElement
    expect(moveButton.disabled).toBe(false)
    moveButton.click()
    expect(onConfirm).toHaveBeenCalledWith('/vault/projects')
    app.unmount()
  })

  it('disables Move when every destination is invalid for the selection', async () => {
    const onConfirm = vi.fn()
    // Selecting the workspace root disables the root and every descendant folder.
    const { root, app } = mountDialog({ ...baseProps, sources: ['/vault'], onConfirm })
    await nextTick()

    const moveButton = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Move') as HTMLButtonElement
    expect(moveButton.disabled).toBe(true)
    moveButton.click()
    expect(onConfirm).not.toHaveBeenCalled()
    app.unmount()
  })
})
