import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EditorPathBreadcrumb from './EditorPathBreadcrumb.vue'

afterEach(() => { document.body.innerHTML = '' })

describe('EditorPathBreadcrumb', () => {
  it('keeps the complete relative path accessible when the note changes or is renamed', async () => {
    const root = document.createElement('div'); document.body.appendChild(root)
    const path = ref('/vault/deep/folder/Note.md')
    const app = createApp(() => h(EditorPathBreadcrumb, { path: path.value, workspacePath: '/vault' }))
    app.mount(root)
    const breadcrumb = root.querySelector('.editor-path') as HTMLElement
    expect(breadcrumb.textContent?.trim()).toBe('deep/folder/Note.md')
    expect(breadcrumb.getAttribute('title')).toBe('deep/folder/Note.md')
    expect(breadcrumb.getAttribute('tabindex')).toBe('0')
    path.value = '/vault/deep/folder/Renamed.md'
    await nextTick()
    expect(breadcrumb.getAttribute('aria-label')).toBe('File location: deep/folder/Renamed.md')
    app.unmount()
  })
})
