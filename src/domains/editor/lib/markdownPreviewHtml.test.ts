import { describe, expect, it } from 'vitest'

import { renderMarkdownPreviewHtml } from './markdownPreviewHtml'

describe('renderMarkdownPreviewHtml', () => {
  it('renders headings, paragraphs and inline formatting', () => {
    const html = renderMarkdownPreviewHtml('# Title\n\nSome **bold** and *italic* text.')

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>Some <strong>bold</strong> and <em>italic</em> text.</p>')
  })

  it('drops frontmatter from the preview body', () => {
    const html = renderMarkdownPreviewHtml('---\ntitle: Secret\n---\n\nVisible body.')

    expect(html).toContain('Visible body.')
    expect(html).not.toContain('title: Secret')
  })

  it('renders lists, checklists and nested items', () => {
    const html = renderMarkdownPreviewHtml('- one\n- two\n  - nested\n\n- [x] done\n- [ ] todo')

    expect(html).toContain('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>')
    expect(html).toContain('class="preview-checklist"')
    expect(html).toContain('[x]</span> done')
    expect(html).toContain('[ ]</span> todo')
  })

  it('renders ordered lists, quotes and callouts', () => {
    const html = renderMarkdownPreviewHtml('1. first\n2. second\n\n> quoted line\n\n> [!WARNING]\n> careful')

    expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
    expect(html).toContain('<blockquote><p>quoted line</p></blockquote>')
    expect(html).toContain('preview-callout--warning')
    expect(html).toContain('careful')
  })

  it('renders fenced code blocks with escaped content and language class', () => {
    const html = renderMarkdownPreviewHtml('```ts\nconst a = 1 < 2\n```')

    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>')
  })

  it('renders tables with header cells and alignment', () => {
    const html = renderMarkdownPreviewHtml('| a | b |\n| :-- | --: |\n| 1 | 2 |')

    expect(html).toContain('<thead><tr><th style="text-align: left">a</th>')
    expect(html).toContain('<th style="text-align: right">b</th>')
    expect(html).toContain('<tbody><tr><td style="text-align: left">1</td>')
  })

  it('renders images and embedded note placeholders', () => {
    const html = renderMarkdownPreviewHtml('![Diagram](../assets/flow.png)\n\n![[Other note]]')

    expect(html).toContain('<img src="../assets/flow.png" alt="Diagram">')
    expect(html).toContain('Embedded note: Other note')
  })

  it('keeps preview links inert so they cannot navigate the app webview', () => {
    const html = renderMarkdownPreviewHtml('See [[Other note]] and [site](https://example.com).')

    expect(html).toContain('Other note')
    expect(html).toContain('site')
    expect(html).not.toContain('href=')
  })

  it('drops blank-line paragraphs that would double block spacing', () => {
    const html = renderMarkdownPreviewHtml('# Title\n\nBody\n\n## Next')

    expect(html).not.toContain('<p><br></p>')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Next</h2>')
  })

  it('strips scripts and unsafe urls coming from embedded html', () => {
    const html = renderMarkdownPreviewHtml('<div onclick="alert(1)">raw</div>\n\n<script>alert(1)</script>')

    expect(html).toContain('raw')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script')
  })

  it('returns an empty fragment for empty or frontmatter-only notes', () => {
    expect(renderMarkdownPreviewHtml('')).toBe('')
    expect(renderMarkdownPreviewHtml('---\ntitle: only meta\n---\n')).toBe('')
  })
})
