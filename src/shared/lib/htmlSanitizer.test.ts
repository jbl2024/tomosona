import { describe, expect, it } from 'vitest'
import { sanitizeHtmlForPreview } from './htmlSanitizer'

describe('sanitizeHtmlForPreview', () => {
  it('strips blocked tags and event handlers', () => {
    const html = '<div onclick="alert(1)"><script>alert(1)</script><p>ok</p></div>'
    const sanitized = sanitizeHtmlForPreview(html)
    expect(sanitized).toContain('<div><p>ok</p></div>')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onclick')
  })

  it('removes unsafe url protocols', () => {
    const html = '<a href="javascript:alert(1)">bad</a><img src="data:text/html,boom">'
    const sanitized = sanitizeHtmlForPreview(html)
    expect(sanitized).toContain('<a>bad</a>')
    expect(sanitized).toContain('<img>')
  })

  it('keeps safe links and image data urls', () => {
    const html = '<a href="https://example.com">ok</a><img src="data:image/png;base64,AAAA">'
    const sanitized = sanitizeHtmlForPreview(html)
    expect(sanitized).toContain('href="https://example.com"')
    expect(sanitized).toContain('src="data:image/png;base64,AAAA"')
  })
})
