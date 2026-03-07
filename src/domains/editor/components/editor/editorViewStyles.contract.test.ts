import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import editorViewSource from '../EditorView.vue?raw'

const editorStyles = readFileSync(
  resolve(process.cwd(), 'src/domains/editor/components/editor/EditorViewContent.css'),
  'utf-8'
)

describe('editor content styles contract', () => {
  it('keeps EditorView stylesheet import', () => {
    expect(editorViewSource).toContain("import './editor/EditorViewContent.css'")
  })

  it('uses plain css selectors (no vue :deep in extracted stylesheet)', () => {
    expect(editorStyles).not.toContain(':deep(')
  })

  it('keeps required core selectors', () => {
    expect(editorStyles).toContain('.editor-content-shell')
    expect(editorStyles).toContain('.editor-holder .ProseMirror')
    expect(editorStyles).toContain('.editor-holder .ProseMirror table')
    expect(editorStyles).toContain('width: 100%;')
    expect(editorStyles).toContain('.editor-holder .ProseMirror th')
    expect(editorStyles).toContain('.editor-holder .ProseMirror td')
    expect(editorStyles).toContain('.editor-holder .ProseMirror table p')
    expect(editorStyles).toContain('font-size: inherit;')
    expect(editorStyles).toContain('line-height: inherit;')
    expect(editorStyles).toContain('text-align: left;')
    expect(editorStyles).toContain('font-size: calc(0.82rem * var(--editor-zoom, 1));')
    expect(editorStyles).toContain('padding: 0.24rem 0.34rem;')
    expect(editorStyles).toContain('min-width: 2.6rem;')
    expect(editorStyles).toContain('.editor-holder .tomosona-quote-source')
    expect(editorStyles).toContain('min-height: 72px;')
    expect(editorStyles).toContain('font-size: calc(0.95rem * var(--editor-zoom, 1));')
  })
})
