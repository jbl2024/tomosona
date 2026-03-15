import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HtmlNodeView from './HtmlNodeView.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => {
    let remainingFrames = 8
    const step = () => {
      remainingFrames -= 1
      if (remainingFrames <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  await nextTick()
}

function mountHarness(options?: { editable?: boolean; initialHtml?: string; initialAutoEdit?: boolean }) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const html = ref(options?.initialHtml ?? '<div>Hello</div>')
  const autoEdit = ref(options?.initialAutoEdit ?? false)
  const editable = options?.editable ?? true
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.html === 'string') {
      html.value = attrs.html
    }
    if (typeof attrs.autoEdit === 'boolean') {
      autoEdit.value = attrs.autoEdit
    }
  })

  const Harness = defineComponent({
    setup() {
      return () => h(HtmlNodeView, {
        node: { attrs: { html: html.value, autoEdit: autoEdit.value } },
        updateAttributes,
        editor: { isEditable: editable }
      })
    }
  })

  const app = createApp(Harness)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)
  return { app, root, html, autoEdit, updateAttributes }
}

describe('HtmlNodeView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders sanitized html preview', async () => {
    const harness = mountHarness({ initialHtml: '<div onclick="boom"><script>alert(1)</script>safe</div>' })
    await flush()
    const preview = harness.root.querySelector('.tomosona-html-preview') as HTMLDivElement
    expect(preview.innerHTML).toContain('safe')
    expect(preview.innerHTML).not.toContain('onclick')
    expect(preview.innerHTML).not.toContain('script')
    harness.app.unmount()
  })

  it('renders wikilink tokens inside html preview as wikilink anchors', async () => {
    const harness = mountHarness({
      initialHtml: '<p>Go to [[docs/note#Section 2|S2]] and [[docs/alpha]]</p>'
    })
    await flush()

    const anchors = Array.from(harness.root.querySelectorAll('.tomosona-html-preview a.wikilink')) as HTMLAnchorElement[]
    expect(anchors).toHaveLength(2)
    expect(anchors[0].getAttribute('data-wikilink-target')).toBe('docs/note#Section 2')
    expect(anchors[0].textContent).toBe('S2')
    expect(anchors[0].getAttribute('href')).toBe('wikilink:docs%2Fnote%23Section%202')
    expect(anchors[1].getAttribute('data-wikilink-target')).toBe('docs/alpha')
    expect(anchors[1].textContent).toBe('docs/alpha')

    harness.app.unmount()
  })

  it('toggles source mode and updates html through textarea input', async () => {
    const harness = mountHarness()
    await flush()

    const toggle = harness.root.querySelector('.tomosona-html-toggle-btn') as HTMLButtonElement
    toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const textarea = harness.root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement
    textarea.value = '<section>Updated</section>'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ html: '<section>Updated</section>' })
    expect(harness.html.value).toBe('<section>Updated</section>')
    harness.app.unmount()
  })

  it('applies edit mode class while source editor is open', async () => {
    const harness = mountHarness()
    await flush()

    const wrapper = harness.root.querySelector('.tomosona-html-node') as HTMLElement
    const toggle = harness.root.querySelector('.tomosona-html-toggle-btn') as HTMLButtonElement
    expect(wrapper.classList.contains('is-editing')).toBe(false)

    toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()
    expect(wrapper.classList.contains('is-editing')).toBe(true)

    const editorToggle = harness.root.querySelector('.tomosona-html-toggle-btn') as HTMLButtonElement
    editorToggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()
    expect(wrapper.classList.contains('is-editing')).toBe(false)

    harness.app.unmount()
  })

  it('opens source mode and focuses textarea when auto-edit is requested', async () => {
    const harness = mountHarness({ initialHtml: '<div>\n  \n</div>', initialAutoEdit: true })
    await flush()

    const wrapper = harness.root.querySelector('.tomosona-html-node') as HTMLElement
    const textarea = harness.root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement
    expect(wrapper.classList.contains('is-editing')).toBe(true)
    expect(textarea).toBeTruthy()
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe('<div>\n  '.length)
    expect(textarea.selectionEnd).toBe('<div>\n  '.length)
    expect(textarea.style.height).toBe('86px')
    expect(harness.updateAttributes).toHaveBeenCalledWith({ autoEdit: false })
    expect(harness.autoEdit.value).toBe(false)

    harness.app.unmount()
  })

  it('supports tab indentation and enter auto-indent', async () => {
    const harness = mountHarness({ initialHtml: '<div>\n  <span>x</span>\n</div>' })
    await flush()

    const toggle = harness.root.querySelector('.tomosona-html-toggle-btn') as HTMLButtonElement
    toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const textarea = harness.root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement
    textarea.setSelectionRange(0, 0)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flush()
    expect(harness.html.value.startsWith('  <div>')).toBe(true)

    const latest = harness.root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement
    const insertPos = latest.value.indexOf('<span')
    latest.setSelectionRange(insertPos, insertPos)
    latest.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flush()
    expect(harness.html.value).toContain('\n  \n  <span')
    harness.app.unmount()
  })

  it('opens source mode on cmd or ctrl click from preview', async () => {
    const harness = mountHarness({ initialHtml: '<div>Hello</div>' })
    await flush()

    const preview = harness.root.querySelector('.tomosona-html-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, metaKey: true }))
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    await flush()

    const wrapper = harness.root.querySelector('.tomosona-html-node') as HTMLElement
    const textarea = harness.root.querySelector('.tomosona-html-textarea') as HTMLTextAreaElement
    expect(wrapper.classList.contains('is-editing')).toBe(true)
    expect(textarea).toBeTruthy()
    expect(document.activeElement).toBe(textarea)

    harness.app.unmount()
  })
})
