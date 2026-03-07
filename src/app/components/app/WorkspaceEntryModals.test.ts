import { createApp, defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceEntryModals from './WorkspaceEntryModals.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const newFilePath = ref('notes/test')
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(WorkspaceEntryModals, {
          newFileVisible: true,
          newFilePathInput: newFilePath.value,
          newFileError: '',
          newFolderVisible: false,
          newFolderPathInput: '',
          newFolderError: '',
          openDateVisible: false,
          openDateInput: '',
          openDateError: '',
          onCloseNewFile: () => events.push('close-file'),
          onUpdateNewFilePath: (value: string) => {
            newFilePath.value = value
            events.push(`file:${value}`)
          },
          onKeydownNewFile: () => events.push('keydown-file'),
          onSubmitNewFile: () => events.push('submit-file'),
          onCloseNewFolder: () => {},
          onUpdateNewFolderPath: () => {},
          onKeydownNewFolder: () => {},
          onSubmitNewFolder: () => {},
          onCloseOpenDate: () => {},
          onUpdateOpenDate: () => {},
          onKeydownOpenDate: () => {},
          onSubmitOpenDate: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, events, newFilePath }
}

describe('WorkspaceEntryModals', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits new file modal interactions', () => {
    const mounted = mountHarness()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-new-file-input="true"]')

    if (input) {
      input.value = 'notes/updated'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }

    mounted.root.querySelector<HTMLButtonElement>('.confirm-actions button:last-child')?.click()

    expect(mounted.newFilePath.value).toBe('notes/updated')
    expect(mounted.events).toEqual(['file:notes/updated', 'keydown-file', 'submit-file'])

    mounted.app.unmount()
  })
})
