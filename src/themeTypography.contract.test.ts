import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import statusBarSource from './components/app/WorkspaceStatusBar.vue?raw'
import shortcutsSource from './components/app/ShortcutsModal.vue?raw'
import searchSource from './components/app/SearchSidebarPanel.vue?raw'
import codeBlockSource from './components/editor/tiptap/CodeBlockNodeView.vue?raw'

const themeSource = readFileSync(resolve(process.cwd(), 'src/assets/tailwind.css'), 'utf-8')
const editorContentSource = readFileSync(
  resolve(process.cwd(), 'src/components/editor/EditorViewContent.css'),
  'utf-8',
)

describe('Theme typography contracts', () => {
  it('defines global typography tokens and applies them to base surfaces', () => {
    expect(themeSource).toContain('--font-ui')
    expect(themeSource).toContain('--font-editor')
    expect(themeSource).toContain('--font-code')
    expect(themeSource).toContain('--font-size-xs')
    expect(themeSource).toContain('--font-size-md')
    expect(themeSource).toContain('--editor-font-size-base')
    expect(themeSource).toContain('font-family: var(--font-ui);')
  })

  it('routes editor and technical surfaces through typography tokens', () => {
    expect(editorContentSource).toContain('font-family: var(--font-editor);')
    expect(editorContentSource).toContain('var(--editor-font-size-base)')

    expect(codeBlockSource).toContain('font-family: var(--font-code);')
    expect(statusBarSource).toContain('font-family: var(--font-code);')
    expect(shortcutsSource).toContain('font-family: var(--font-code);')
    expect(searchSource).toContain('font-family: var(--font-code);')
  })
})
