import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidPreviewDialog } from './useMermaidPreviewDialog'

describe('useMermaidPreviewDialog', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let originalAnchorClick: typeof HTMLAnchorElement.prototype.click
  let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext
  let originalCanvasToBlob: typeof HTMLCanvasElement.prototype.toBlob
  let imageSrcSetter: PropertyDescriptor | undefined
  let createObjectURLMock: ReturnType<typeof vi.fn>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>
  let anchorClickMock: ReturnType<typeof vi.fn>
  let originalCreateImageBitmap: unknown

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    originalAnchorClick = HTMLAnchorElement.prototype.click
    originalCanvasGetContext = HTMLCanvasElement.prototype.getContext
    originalCanvasToBlob = HTMLCanvasElement.prototype.toBlob
    imageSrcSetter = Object.getOwnPropertyDescriptor(Image.prototype, 'src')
    originalCreateImageBitmap = (globalThis as any).createImageBitmap

    createObjectURLMock = vi.fn(() => 'blob:mock')
    revokeObjectURLMock = vi.fn()
    anchorClickMock = vi.fn()

    URL.createObjectURL = createObjectURLMock
    URL.revokeObjectURL = revokeObjectURLMock
    HTMLAnchorElement.prototype.click = anchorClickMock
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn()
    }) as unknown as CanvasRenderingContext2D) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(['png'], { type: 'image/png' }))
    }) as typeof HTMLCanvasElement.prototype.toBlob
    Object.defineProperty(Image.prototype, 'src', {
      configurable: true,
      set() {
        queueMicrotask(() => {
          ;(this as HTMLImageElement).onload?.(new Event('load'))
        })
      }
    })
    Reflect.set(globalThis as object, 'createImageBitmap', undefined)
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    HTMLAnchorElement.prototype.click = originalAnchorClick
    HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
    HTMLCanvasElement.prototype.toBlob = originalCanvasToBlob
    if (imageSrcSetter) {
      Object.defineProperty(Image.prototype, 'src', imageSrcSetter)
    }
    Reflect.set(globalThis as object, 'createImageBitmap', originalCreateImageBitmap)
  })

  it('opens and closes preview state cleanly', () => {
    const dialog = useMermaidPreviewDialog()

    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 10 10"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })
    expect(dialog.mermaidPreviewDialog.value.visible).toBe(true)
    expect(dialog.mermaidPreviewDialog.value.templateId).toBe('flowchart')

    dialog.closeMermaidPreview()
    expect(dialog.mermaidPreviewDialog.value).toEqual({
      visible: false,
      svg: '',
      code: '',
      templateId: '',
      exportError: ''
    })
  })

  it('exports svg through a blob download with the rendered svg element', () => {
    const dialog = useMermaidPreviewDialog()
    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 10 10"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })
    const previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    previewSvg.setAttribute('viewBox', '0 0 10 10')
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    div.innerHTML = 'Line 1<br>Line 2'
    foreignObject.appendChild(div)
    previewSvg.appendChild(foreignObject)

    dialog.exportMermaidSvg(previewSvg)

    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(anchorClickMock).toHaveBeenCalledTimes(1)
    expect(dialog.mermaidPreviewDialog.value.exportError).toBe('')
  })

  it('exports png through canvas rendering', async () => {
    const dialog = useMermaidPreviewDialog()
    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 12 8"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })

    await dialog.exportMermaidPng()

    expect(createObjectURLMock).toHaveBeenCalledTimes(2)
    expect(anchorClickMock).toHaveBeenCalledTimes(1)
    expect(dialog.mermaidPreviewDialog.value.exportError).toBe('')
  })

  it('prefers createImageBitmap when available', async () => {
    const close = vi.fn()
    Reflect.set(globalThis as object, 'createImageBitmap', vi.fn(async () => ({
      close
    } as unknown as ImageBitmap)))
    const dialog = useMermaidPreviewDialog()
    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 12 8"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })

    await dialog.exportMermaidPng()

    expect((globalThis as any).createImageBitmap).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(dialog.mermaidPreviewDialog.value.exportError).toBe('')
  })

  it('stores a clear error when png export is unavailable', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const dialog = useMermaidPreviewDialog()
    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 12 8"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })

    await dialog.exportMermaidPng()

    expect(dialog.mermaidPreviewDialog.value.exportError).toBe('PNG export is not available in this environment.')
  })

  it('reports a decoding-specific png export failure', async () => {
    Object.defineProperty(Image.prototype, 'src', {
      configurable: true,
      set() {
        queueMicrotask(() => {
          ;(this as HTMLImageElement).onerror?.(new Event('error'))
        })
      }
    })
    const dialog = useMermaidPreviewDialog()
    dialog.openMermaidPreview({ svg: '<svg viewBox="0 0 12 8"></svg>', code: 'graph TD\nA-->B', templateId: 'flowchart' })

    await dialog.exportMermaidPng()

    expect(dialog.mermaidPreviewDialog.value.exportError).toBe('PNG export failed while decoding SVG.')
  })
})
