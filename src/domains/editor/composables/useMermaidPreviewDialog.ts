import { ref } from 'vue'

export type MermaidPreviewPayload = {
  svg: string
  code: string
  templateId: string
}

export type MermaidPreviewDialogState = MermaidPreviewPayload & {
  visible: boolean
  exportError: string
}

function parseSvgSize(svgMarkup: string, liveSvg?: SVGElement | null) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml')
  const svg = doc.documentElement
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/\s+/).map(Number) ?? []
  if (viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
    return { width: Math.max(1, viewBox[2]), height: Math.max(1, viewBox[3]) }
  }

  const widthAttr = Number.parseFloat(svg.getAttribute('width') ?? '')
  const heightAttr = Number.parseFloat(svg.getAttribute('height') ?? '')
  if (Number.isFinite(widthAttr) && Number.isFinite(heightAttr) && widthAttr > 0 && heightAttr > 0) {
    return { width: widthAttr, height: heightAttr }
  }

  const rect = liveSvg?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }

  return { width: 1600, height: 900 }
}

function cloneAndNormalizeSvgElement(svg: SVGElement, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGElement
  if (!clone || clone.tagName.toLowerCase() !== 'svg') {
    throw new Error('Export failed: invalid SVG markup.')
  }

  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  if (!clone.getAttribute('width')) {
    clone.setAttribute('width', String(Math.ceil(width)))
  }
  if (!clone.getAttribute('height')) {
    clone.setAttribute('height', String(Math.ceil(height)))
  }
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${Math.ceil(width)} ${Math.ceil(height)}`)
  }

  return clone
}

function normalizeSvgMarkup(svgMarkup: string, width: number, height: number, liveSvg?: SVGElement | null) {
  if (liveSvg) {
    return new XMLSerializer().serializeToString(cloneAndNormalizeSvgElement(liveSvg, width, height))
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgMarkup.replace(/<br(?!\s*\/)>/gi, '<br />'), 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Export failed: invalid SVG markup.')
  }

  return new XMLSerializer().serializeToString(cloneAndNormalizeSvgElement(svg as unknown as SVGElement, width, height))
}

function sanitizeFilenameSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  }, 0)
}

export function useMermaidPreviewDialog() {
  const mermaidPreviewDialog = ref<MermaidPreviewDialogState>({
    visible: false,
    svg: '',
    code: '',
    templateId: '',
    exportError: ''
  })

  function closeMermaidPreview() {
    mermaidPreviewDialog.value = {
      visible: false,
      svg: '',
      code: '',
      templateId: '',
      exportError: ''
    }
  }

  function openMermaidPreview(payload: MermaidPreviewPayload) {
    mermaidPreviewDialog.value = {
      visible: true,
      svg: payload.svg,
      code: payload.code,
      templateId: payload.templateId,
      exportError: ''
    }
  }

  function exportFilename(extension: 'svg' | 'png') {
    const template = sanitizeFilenameSegment(mermaidPreviewDialog.value.templateId || 'mermaid')
    return `mermaid-${template}.${extension}`
  }

  function exportMermaidSvg(previewSvg?: SVGElement | null) {
    if (!mermaidPreviewDialog.value.svg) return
    mermaidPreviewDialog.value.exportError = ''
    const { width, height } = parseSvgSize(mermaidPreviewDialog.value.svg, previewSvg)
    let normalizedSvg = ''
    try {
      normalizedSvg = normalizeSvgMarkup(mermaidPreviewDialog.value.svg, width, height, previewSvg)
    } catch (err) {
      mermaidPreviewDialog.value.exportError = err instanceof Error ? err.message : 'SVG export failed.'
      return
    }
    triggerDownload(
      new Blob([normalizedSvg], { type: 'image/svg+xml;charset=utf-8' }),
      exportFilename('svg')
    )
  }

  async function exportMermaidPng(previewSvg?: SVGElement | null) {
    if (!mermaidPreviewDialog.value.svg) return
    mermaidPreviewDialog.value.exportError = ''

    const { width, height } = parseSvgSize(mermaidPreviewDialog.value.svg, previewSvg)
    let normalizedSvg = ''
    try {
      normalizedSvg = normalizeSvgMarkup(mermaidPreviewDialog.value.svg, width, height, previewSvg)
    } catch (err) {
      mermaidPreviewDialog.value.exportError = err instanceof Error ? err.message : 'PNG export failed.'
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width)
    canvas.height = Math.ceil(height)
    const context = canvas.getContext('2d')
    if (!context) {
      mermaidPreviewDialog.value.exportError = 'PNG export is not available in this environment.'
      return
    }

    const svgBlob = new Blob([normalizedSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    try {
      const createImageBitmapFn = (
        globalThis as typeof globalThis & {
          createImageBitmap?: (image: Blob) => Promise<ImageBitmap>
        }
      ).createImageBitmap

      if (typeof createImageBitmapFn === 'function') {
        const bitmap = await createImageBitmapFn(svgBlob)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        if (typeof bitmap.close === 'function') {
          bitmap.close()
        }
        URL.revokeObjectURL(url)
      } else {
        await new Promise<void>((resolve, reject) => {
          const image = new Image()
          image.onload = () => {
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            URL.revokeObjectURL(url)
            resolve()
          }
          image.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('PNG export failed while decoding SVG.'))
          }
          image.src = url
        })
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), 'image/png')
      })

      if (!blob) {
        mermaidPreviewDialog.value.exportError = 'PNG export failed while encoding PNG.'
        return
      }

      triggerDownload(blob, exportFilename('png'))
    } catch (err) {
      mermaidPreviewDialog.value.exportError = err instanceof Error ? err.message : 'PNG export failed.'
    }
  }

  return {
    mermaidPreviewDialog,
    openMermaidPreview,
    closeMermaidPreview,
    exportMermaidSvg,
    exportMermaidPng
  }
}
