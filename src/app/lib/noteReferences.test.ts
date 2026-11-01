import { describe, expect, it } from 'vitest'
import { extractNoteReferences } from './noteReferences'

describe('note reference extraction', () => {
  it('finds wikilinks, embeds and markdown note links with exact target spans', () => {
    const content = 'a [[x/y#h|Ali]] b ![e](i.png) c [t](./n.md#s "T") d [[z]] e ![note](notes/embed.md)'
    const references = extractNoteReferences(content)
    expect(references.map((reference) => [reference.kind, reference.target])).toEqual([
      ['wikilink', 'x/y#h|Ali'],
      ['markdown', './n.md#s'],
      ['wikilink', 'z']
    ])
    for (const reference of references) {
      expect(content.slice(reference.start, reference.end)).toBe(reference.target)
    }
  })

  it('keeps the embed prefix outside the replaceable span', () => {
    const content = 'before ![[assets/pic.png]] after'
    const [reference] = extractNoteReferences(content)
    expect(reference).toMatchObject({ kind: 'wikilink', target: 'assets/pic.png' })
    expect(content.slice(reference.start, reference.end)).toBe('assets/pic.png')
    expect(content[reference.start - 3]).toBe('!')
  })

  it('ignores urls, pure anchors, assets and images but keeps angle-bracket hrefs', () => {
    const content = [
      '[web](https://example.com)',
      '[anchor](#section)',
      '[img](assets/pic.png)',
      '![image](assets/pic.png)',
      '[doc](<./my notes/doc.md>)',
      '[plain](notes/Topic.md)'
    ].join('\n')
    const references = extractNoteReferences(content)
    expect(references.map((reference) => reference.target)).toEqual(['./my notes/doc.md', 'notes/Topic.md'])
    for (const reference of references) {
      expect(content.slice(reference.start, reference.end)).toBe(reference.target)
    }
  })

  it('returns an empty list for content without references', () => {
    expect(extractNoteReferences('')).toEqual([])
    expect(extractNoteReferences('# Title\n\nplain text [[broken')).toEqual([])
  })
})
