import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import editorViewSource from '../EditorView.vue?raw'

const editorStyles = readFileSync(
  resolve(process.cwd(), 'src/domains/editor/components/editor/EditorViewContent.css'),
  'utf-8'
)
const globalStyles = readFileSync(resolve(process.cwd(), 'src/assets/tailwind.css'), 'utf-8')

describe('editor content styles contract', () => {
  it('shows only the source while editing a quote and only the preview otherwise', () => {
    expect(globalStyles).toContain('.editor-holder .tomosona-quote-source {\n    display: block;')
    expect(globalStyles).toContain('.tomosona-quote.is-editing .tomosona-quote-preview {\n    display: none;')
    expect(globalStyles).toContain('.tomosona-quote:not(.is-editing) .tomosona-quote-source {\n    display: none;')
  })

  it('keeps quote preview paragraphs free of document paragraph margins', () => {
    expect(editorStyles).toMatch(
      /\.editor-holder \.ProseMirror \.tomosona-quote-paragraph\s*\{[\s\S]*?margin:\s*0;/
    )
  })

  it('keeps EditorView stylesheet import', () => {
    expect(editorViewSource).toContain("import './editor/EditorViewContent.css'")
  })

  it('uses plain css selectors (no vue :deep in extracted stylesheet)', () => {
    expect(editorStyles).not.toContain(':deep(')
  })

  it('keeps required core selectors', () => {
    expect(editorStyles).toContain('.editor-content-shell')
    expect(editorStyles).toContain('.editor-holder .ProseMirror')
    expect(editorStyles).toContain('text-decoration-thickness: 1px;')
    expect(editorStyles).toContain('color: var(--tomosona-link-color);')
    expect(editorStyles).not.toContain('background: var(--editor-signal-link-soft);')
    expect(editorStyles).toContain('.editor-holder .ProseMirror table')
    expect(editorStyles).toContain('width: auto;')
    expect(editorStyles).toContain('border-collapse: collapse;')
    expect(editorStyles).toContain('.editor-holder .ProseMirror th')
    expect(editorStyles).toContain('.editor-holder .ProseMirror td')
    expect(editorStyles).toContain('.editor-holder .ProseMirror table p')
    expect(editorStyles).toContain('font-size: inherit;')
    expect(editorStyles).toContain('line-height: inherit;')
    expect(editorStyles).toContain('text-align: left;')
    expect(editorStyles).toContain('font-size: calc(var(--editor-font-size-base) * var(--editor-zoom, 1));')
    expect(editorStyles).toContain('padding: 0.3rem 0.55rem;')
    expect(editorStyles).toContain('table-layout: auto;')
    expect(editorStyles).toContain('li[data-checked="true"] > div > p')
    expect(editorStyles).toContain('.editor-holder .tomosona-quote-source')
    expect(editorStyles).not.toContain('min-height: 72px;')
    expect(editorStyles).toContain('font-size: calc(0.95rem * var(--editor-zoom, 1));')
  })
})
