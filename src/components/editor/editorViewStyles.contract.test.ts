import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import editorViewSource from '../EditorView.vue?raw'

const editorStyles = readFileSync(
  resolve(process.cwd(), 'src/components/editor/EditorViewContent.css'),
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
    expect(editorStyles).toContain('.editor-holder .ProseMirror th')
    expect(editorStyles).toContain('.editor-holder .ProseMirror td')
    expect(editorStyles).toContain('.editor-holder .tomosona-quote-source')
    expect(editorStyles).toContain('min-height: 72px;')
    expect(editorStyles).toContain('font-size: calc(0.95rem * var(--editor-zoom, 1));')
  })
})
