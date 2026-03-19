import { describe, expect, it } from 'vitest'
import { renderSecondBrainMarkdownPreview } from './secondBrainMarkdownPreview'

describe('renderSecondBrainMarkdownPreview', () => {
  it('renders soft line breaks as br tags', () => {
    const html = renderSecondBrainMarkdownPreview('Line one\nLine two')
    expect(html).toContain('<p>Line one<br>Line two</p>')
  })

  it('keeps ordered lists as a single list', () => {
    const html = renderSecondBrainMarkdownPreview('1. First\n2. Second\n3. Third')
    expect((html.match(/<ol>/g) ?? []).length).toBe(1)
    expect(html).toContain('<li>First</li>')
    expect(html).toContain('<li>Second</li>')
    expect(html).toContain('<li>Third</li>')
  })

  it('preserves inline formatting inside tables and blockquotes', () => {
    const html = renderSecondBrainMarkdownPreview([
      '| Name | Value |',
      '| --- | --- |',
      '| **Bold** | Line 1<br>Line 2 |',
      '',
      '> Quote line 1',
      '> Quote line 2'
    ].join('\n'))

    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<td>Line 1<br>Line 2</td>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('Quote line 1<br>Quote line 2')
  })
})
