import { createApp, defineComponent, h, nextTick, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PaneSurfaceHost from './PaneSurfaceHost.vue'

const api = vi.hoisted(() => ({
  pageProtectionStatus: vi.fn(), unlockPage: vi.fn(),
  isPageLockedError: (value: unknown) => Boolean(value && typeof value === 'object' && 'code' in value && value.code === 'PageLocked')
}))
vi.mock('../../../shared/api/pageProtectionApi', () => api)
vi.mock('../../../domains/editor/components/EditorView.vue', () => ({
  default: defineComponent({
    props: ['path', 'readNoteSnapshot'],
    setup(props) {
      const content = ref('')
      watch(() => props.path, async (path) => {
        content.value = ''
        const result = await props.readNoteSnapshot(path)
        if (path === props.path) content.value = result.content
      }, { immediate: true })
      return () => h('div', { class: 'fake-editor' }, [h('textarea', { value: content.value })])
    }
  })
}))

async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }

describe('protected page in a pane', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('replaces the editor with a retryable form until the note is unlocked', async () => {
    let locked = true
    let finishUnlock!: () => void
    api.pageProtectionStatus.mockImplementation(async ([path]: string[]) => [{ path, isProtected: true, isLocked: locked }])
    api.unlockPage.mockImplementation(async (_path: string, password: string) => {
      if (password !== 'secret') throw 'Incorrect password or damaged file.'
      await new Promise<void>((resolve) => { finishUnlock = resolve })
      locked = false
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const read = vi.fn(async (path: string) => {
      if (locked) throw { code: 'PageLocked', path }
      return { path, content: 'Private text', version: null }
    })
    const app = createApp(() => h(PaneSurfaceHost, {
      paneId: 'pane', activeTab: { id: 'a', type: 'document', path: '/vault/a.md', pinned: false },
      openTabs: [], openDocumentPaths: ['/vault/a.md'], activeDocumentPath: '/vault/a.md', workspacePath: '/vault',
      getStatus: () => ({ dirty: false, saving: false, saveError: '' }), readNoteSnapshot: read,
      renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
      loadLinkTargets: async () => [], loadLinkHeadings: async () => [], loadPropertyTypeSchema: async () => ({}),
      savePropertyTypeSchema: async () => {}, openLinkTarget: async () => false,
      launchpad: { showExperience: false, mode: 'workspace-launchpad', workspaceLabel: '', recentWorkspaces: [], recentViewedNotes: [], recentUpdatedNotes: [], showWizardAction: false }
    }))
    app.mount(root)
    await settle()
    expect((root.querySelector('.fake-editor') as HTMLElement).style.display).toBe('none')
    expect(root.textContent).toContain('Protected note')
    const input = root.querySelector('input[type=password]') as HTMLInputElement
    input.value = 'wrong'; input.dispatchEvent(new Event('input', { bubbles: true }))
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Incorrect password')
    expect((root.querySelector('.fake-editor') as HTMLElement).style.display).toBe('none')
    input.value = 'secret'; input.dispatchEvent(new Event('input', { bubbles: true }))
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    const submitButton = root.querySelector('button[type=submit]') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(submitButton.textContent).toContain('Unlocking note')
    expect(submitButton.querySelector('.locked-page-progress')).toBeTruthy()
    expect((root.querySelector('.fake-editor') as HTMLElement).style.display).toBe('none')
    finishUnlock()
    await settle()
    expect(root.querySelector('input[type=password]')).toBeNull()
    expect((root.querySelector('.fake-editor') as HTMLElement).style.display).not.toBe('none')
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Private text')
    app.unmount()
  })
  it('hides an already open editor on lock and restores its existing session after unlock', async () => {
    let locked = false
    api.pageProtectionStatus.mockImplementation(async ([path]: string[]) => [{ path, isProtected: true, isLocked: locked }])
    api.unlockPage.mockImplementation(async () => { locked = false })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const read = vi.fn(async (path: string) => ({ path, content: 'Existing content', version: null }))
    const app = createApp(() => h(PaneSurfaceHost, {
      paneId: 'pane', activeTab: { id: 'a', type: 'document', path: '/vault/a.md', pinned: false },
      openTabs: [], openDocumentPaths: ['/vault/a.md'], activeDocumentPath: '/vault/a.md', workspacePath: '/vault',
      getStatus: () => ({ dirty: false, saving: false, saveError: '' }), readNoteSnapshot: read,
      renameFileFromTitle: async (path: string, title: string) => ({ path, title }),
      loadLinkTargets: async () => [], loadLinkHeadings: async () => [], loadPropertyTypeSchema: async () => ({}),
      savePropertyTypeSchema: async () => {}, openLinkTarget: async () => false,
      launchpad: { showExperience: false, mode: 'workspace-launchpad', workspaceLabel: '', recentWorkspaces: [], recentViewedNotes: [], recentUpdatedNotes: [], showWizardAction: false }
    }))
    app.mount(root)
    await settle()
    const editor = root.querySelector('.fake-editor') as HTMLElement
    expect(editor.style.display).not.toBe('none')
    locked = true
    window.dispatchEvent(new Event('page-protection-changed'))
    await settle()
    expect(editor.style.display).toBe('none')
    const input = root.querySelector('input[type=password]') as HTMLInputElement
    input.value = 'secret'; input.dispatchEvent(new Event('input', { bubbles: true }))
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(root.querySelector('.fake-editor')).toBe(editor)
    expect(editor.style.display).not.toBe('none')
    expect((editor.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Existing content')
    expect(read).toHaveBeenCalledOnce()
    app.unmount()
  })

})
