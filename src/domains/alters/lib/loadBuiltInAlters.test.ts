import { describe, expect, it } from 'vitest'
import { builtInAlters, parseBuiltInAlterMarkdown } from './loadBuiltInAlters'

describe('loadBuiltInAlters', () => {
  it('loads the bundled alters from markdown files', () => {
    expect(builtInAlters.length).toBeGreaterThan(0)
    expect(builtInAlters.map((item) => item.id)).toContain('antifragile-strategist')
  })

  it('parses explicit ids and keeps colon-containing values intact', () => {
    expect(
      parseBuiltInAlterMarkdown(
        '/data/custom-alter.md',
        '---\nid: custom-alter\nlabel: Clear: Writer\ngroup: Build: Ops\n---\nPrompt body'
      )
    ).toEqual({
      id: 'custom-alter',
      label: 'Clear: Writer',
      group: 'Build: Ops',
      prompt: 'Prompt body'
    })
  })

  it('falls back to the filename when the id is missing', () => {
    expect(
      parseBuiltInAlterMarkdown(
        '/data/clear-writer.md',
        '---\nlabel: Clear Writer\ngroup: Create\n---\nPrompt body'
      )
    ).toEqual({
      id: 'clear-writer',
      label: 'Clear Writer',
      group: 'Create',
      prompt: 'Prompt body'
    })
  })

  it('returns null when the document is missing frontmatter metadata', () => {
    expect(parseBuiltInAlterMarkdown('/data/missing.md', 'Prompt body')).toBeNull()
  })
})
