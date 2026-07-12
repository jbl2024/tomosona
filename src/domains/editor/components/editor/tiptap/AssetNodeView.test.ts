import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  readImageDataUrl: vi.fn(async () => 'data:image/png;base64,ZmFrZQ==')
}))

vi.mock('../../../../../shared/api/workspaceApi', () => ({
  readImageDataUrl: hoisted.readImageDataUrl
}))

import AssetNodeView from './AssetNodeView.vue'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function mountHarness(options?: {
  editable?: boolean
  initialSrc?: string
  initialAlt?: string
  initialTitle?: string
  initialAutoEdit?: boolean
  mediaItems?: Array<{ id: string; label: string; meta: string; path: string }>
  resolvePreviewSrc?: (src: string) => string | null
  openPreview?: (payload: { src: string; alt: string; title: string; previewSrc: string | null }) => void
  importAssetFiles?: () => Promise<string[]>
}) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const src = ref(options?.initialSrc ?? '')
  const alt = ref(options?.initialAlt ?? '')
  const title = ref(options?.initialTitle ?? '')
  const autoEdit = ref(options?.initialAutoEdit ?? false)
  const editable = options?.editable ?? true
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    if (typeof attrs.src === 'string') src.value = attrs.src
    if (typeof attrs.alt === 'string') alt.value = attrs.alt
    if (typeof attrs.title === 'string') title.value = attrs.title
    if (typeof attrs.autoEdit === 'boolean') autoEdit.value = attrs.autoEdit
  })

  const HarnessComponent = defineComponent({
    setup() {
      return () => h(AssetNodeView, {
        node: { attrs: { src: src.value, alt: alt.value, title: title.value, autoEdit: autoEdit.value } },
        updateAttributes,
        editor: { isEditable: editable },
        extension: {
          options: {
            resolvePreviewSrc: options?.resolvePreviewSrc,
            openPreview: options?.openPreview,
            getAssetBrowserItems: () => options?.mediaItems ?? [],
            importAssetFiles: options?.importAssetFiles
          }
        }
      })
    }
  })

  const app = createApp(HarnessComponent)
  app.provide('onDragStart', () => {})
  app.provide('decorationClasses', ref(''))
  app.mount(root)

  return { app, root, src, alt, title, autoEdit, updateAttributes }
}

describe('AssetNodeView', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates asset fields from inputs', async () => {
    const harness = mountHarness({
      initialSrc: '../../assets/images/Formulaire_GLPI/preview.png',
      initialAlt: 'Preview'
    })
    await flush()

    const editButton = Array.from(harness.root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement
    editButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const srcInput = harness.root.querySelector('.tomosona-asset-src-input') as HTMLInputElement
    srcInput.value = '../../assets/images/Formulaire_GLPI/updated.png'
    srcInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    const altInput = harness.root.querySelector('.tomosona-asset-alt-input') as HTMLInputElement
    altInput.value = 'Updated preview'
    altInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ src: '../../assets/images/Formulaire_GLPI/updated.png' })
    expect(harness.updateAttributes).toHaveBeenCalledWith({ alt: 'Updated preview' })
    expect(harness.src.value).toBe('../../assets/images/Formulaire_GLPI/updated.png')
    expect(harness.alt.value).toBe('Updated preview')

    harness.app.unmount()
  })

  it('opens the media browser from the src row and writes the selected media path', async () => {
    const harness = mountHarness({
      initialSrc: '',
      mediaItems: [
        { id: 'asset-media:/vault/assets/alpha.png', label: 'alpha.png', meta: 'assets/alpha.png', path: '/vault/assets/alpha.png' },
        { id: 'asset-media:/vault/assets/bravo.svg', label: 'bravo.svg', meta: 'assets/bravo.svg', path: '/vault/assets/bravo.svg' }
      ]
    })
    await flush()

    const editButton = Array.from(harness.root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement
    editButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const browseButton = harness.root.querySelector<HTMLButtonElement>('button[aria-label="Browse media"]')
    expect(browseButton).toBeTruthy()
    browseButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    browseButton?.click()
    await flush()

    const menu = document.body.querySelector('.ui-filterable-dropdown-menu')
    expect(menu).toBeTruthy()

    const firstOption = menu?.querySelector<HTMLButtonElement>('.ui-filterable-dropdown-option')
    expect(firstOption).toBeTruthy()
    firstOption?.click()
    await flush()

    expect(harness.updateAttributes).toHaveBeenCalledWith({ src: '/vault/assets/alpha.png' })
    expect(harness.src.value).toBe('/vault/assets/alpha.png')

    harness.app.unmount()
  })

  it('disables the browser button when there are no media items', async () => {
    const harness = mountHarness({
      initialSrc: '',
      mediaItems: []
    })
    await flush()

    const editButton = Array.from(harness.root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement
    editButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    const browseButton = harness.root.querySelector<HTMLButtonElement>('button[aria-label="Browse media"]')
    expect(browseButton?.disabled).toBe(true)

    harness.app.unmount()
  })

  it('uploads files into assets and selects the first imported file', async () => {
    const importAssetFiles = vi.fn(async () => [
      '/vault/assets/photo.png',
      '/vault/assets/report.pdf'
    ])
    const harness = mountHarness({ initialSrc: '', importAssetFiles })
    await flush()

    const editButton = Array.from(harness.root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement
    editButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    harness.root.querySelector<HTMLButtonElement>('button[aria-label="Upload files to assets"]')?.click()
    await flush()

    expect(importAssetFiles).toHaveBeenCalledOnce()
    expect(harness.updateAttributes).toHaveBeenCalledWith({ src: '/vault/assets/photo.png' })
    expect(harness.src.value).toBe('/vault/assets/photo.png')

    harness.app.unmount()
  })

  it('emits a preview payload when the preview is clicked', async () => {
    const openPreview = vi.fn()
    const harness = mountHarness({
      initialSrc: '../../assets/images/Formulaire_GLPI/preview.png',
      initialAlt: 'Preview',
      resolvePreviewSrc: () => '/vault/assets/images/Formulaire_GLPI/preview.png',
      openPreview
    })
    await flush()

    const preview = harness.root.querySelector('.tomosona-asset-preview') as HTMLDivElement
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await flush()

    expect(openPreview).toHaveBeenCalledWith(expect.objectContaining({
      src: '../../assets/images/Formulaire_GLPI/preview.png',
      alt: 'Preview',
      title: '',
      previewSrc: 'data:image/png;base64,ZmFrZQ=='
    }))

    harness.app.unmount()
  })

  it('hydrates a preview when the resolver returns an absolute local image path', async () => {
    const harness = mountHarness({
      initialSrc: '../../assets/images/Formulaire_GLPI/preview.png',
      resolvePreviewSrc: () => '/vault/assets/images/Formulaire_GLPI/preview.png'
    })
    await flush()

    const image = harness.root.querySelector('.tomosona-asset-image') as HTMLImageElement | null
    expect(image).toBeTruthy()
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,ZmFrZQ==')
    expect(hoisted.readImageDataUrl).toHaveBeenCalledWith('/vault/assets/images/Formulaire_GLPI/preview.png')

    harness.app.unmount()
  })

  it('decodes percent-encoded local image paths before reading the preview', async () => {
    const harness = mountHarness({
      initialSrc: '../../assets/images/Formulaire_GLPI/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY%3D.png',
      resolvePreviewSrc: () => '/vault/assets/images/Formulaire_GLPI/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY%3D.png'
    })
    await flush()

    const image = harness.root.querySelector('.tomosona-asset-image') as HTMLImageElement | null
    expect(image).toBeTruthy()
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,ZmFrZQ==')
    expect(hoisted.readImageDataUrl).toHaveBeenCalledWith(
      '/vault/assets/images/Formulaire_GLPI/kyPZV79XlEaFswpDL5cP47SlAfy25fO6fnN9FEM-TUY=.png'
    )

    harness.app.unmount()
  })

  it('hydrates absolute workspace paths even without an explicit resolver', async () => {
    const harness = mountHarness({
      initialSrc: '/vault/assets/images/Formulaire_GLPI/preview.png'
    })
    await flush()

    const image = harness.root.querySelector('.tomosona-asset-image') as HTMLImageElement | null
    expect(image).toBeTruthy()
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,ZmFrZQ==')
    expect(hoisted.readImageDataUrl).toHaveBeenCalledWith('/vault/assets/images/Formulaire_GLPI/preview.png')

    harness.app.unmount()
  })

  it('focuses the source input when auto-edit is requested', async () => {
    const harness = mountHarness({
      initialSrc: '',
      initialAutoEdit: true
    })
    await flush()

    const srcInput = harness.root.querySelector('.tomosona-asset-src-input') as HTMLInputElement
    expect(document.activeElement).toBe(srcInput)
    expect(harness.updateAttributes).toHaveBeenCalledWith({ autoEdit: false })
    expect(harness.autoEdit.value).toBe(false)

    harness.app.unmount()
  })
})
