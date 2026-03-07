const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base'
])

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster'])
const DATA_IMAGE_RE = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);(?:base64,|charset=[^;,]+,)/i

function normalizeProtocolCheck(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase()
}

function isUnsafeUrl(value: string, attrName: string, tagName: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  const normalized = normalizeProtocolCheck(trimmed)
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return true
  if (normalized.startsWith('data:')) {
    return !(tagName === 'img' && attrName === 'src' && DATA_IMAGE_RE.test(trimmed))
  }

  return false
}

function sanitizeElementAttributes(element: Element) {
  const tagName = element.tagName.toLowerCase()
  const attrs = Array.from(element.attributes)
  attrs.forEach((attr) => {
    const name = attr.name.toLowerCase()
    const value = attr.value ?? ''
    if (name.startsWith('on') || name === 'srcdoc') {
      element.removeAttribute(attr.name)
      return
    }
    if (URL_ATTRS.has(name) && isUnsafeUrl(value, name, tagName)) {
      element.removeAttribute(attr.name)
    }
  })
}

function sanitizeNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (BLOCKED_TAGS.has(tag)) {
    element.remove()
    return
  }

  sanitizeElementAttributes(element)
  Array.from(element.childNodes).forEach((child) => sanitizeNode(child))
}

export function sanitizeHtmlForPreview(raw: string): string {
  const value = String(raw ?? '')
  if (!value.trim()) return ''

  const template = document.createElement('template')
  template.innerHTML = value
  Array.from(template.content.childNodes).forEach((node) => sanitizeNode(node))
  return template.innerHTML
}
