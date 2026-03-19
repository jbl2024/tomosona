import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import statusBarSource from './app/components/app/WorkspaceStatusBar.vue?raw'
import shortcutsSource from './app/components/app/ShortcutsModal.vue?raw'
import searchSource from './app/components/app/SearchSidebarPanel.vue?raw'
import codeBlockSource from './domains/editor/components/editor/tiptap/CodeBlockNodeView.vue?raw'

const tailwindSource = readFileSync(resolve(process.cwd(), 'src/assets/tailwind.css'), 'utf-8')
const themeTokensSource = readFileSync(resolve(process.cwd(), 'src/assets/theme-tokens.css'), 'utf-8')
const baseThemeSource = readFileSync(resolve(process.cwd(), 'src/assets/themes/base.css'), 'utf-8')
const editorContentSource = readFileSync(
  resolve(process.cwd(), 'src/domains/editor/components/editor/EditorViewContent.css'),
  'utf-8',
)

describe('Theme typography contracts', () => {
  it('defines global typography tokens and applies them to base surfaces', () => {
    expect(themeTokensSource).toContain('./themes/base.css')
    expect(baseThemeSource).toContain('--font-ui')
    expect(baseThemeSource).toContain('--font-editor')
    expect(baseThemeSource).toContain('--font-code')
    expect(baseThemeSource).toContain('--font-size-xs')
    expect(baseThemeSource).toContain('--font-size-md')
    expect(baseThemeSource).toContain('--editor-font-size-base')
    expect(tailwindSource).toContain('font-family: var(--font-ui);')
  })

  it('routes editor and technical surfaces through typography tokens', () => {
    expect(editorContentSource).toContain('font-family: var(--font-editor);')
    expect(editorContentSource).toContain('var(--editor-font-size-base)')

    expect(codeBlockSource).toContain('font-family: var(--font-code);')
    expect(statusBarSource).toContain('font-family: var(--font-code);')
    expect(shortcutsSource).toContain('font-family: var(--font-code);')
    expect(searchSource).toContain('font-family: var(--font-code);')
  })

  it('keeps the shortcuts modal compact while widening the panel', () => {
    expect(shortcutsSource).toContain('panel-class="shortcuts-modal"')
    expect(shortcutsSource).toContain(':deep(.ui-modal-shell__title)')
    expect(shortcutsSource).toContain(':global(.ui-modal-shell__panel--xl.shortcuts-modal)')
    expect(shortcutsSource).toContain('max-width: 88rem')
    expect(shortcutsSource).toContain('font-size: 0.68rem')
    expect(shortcutsSource).toContain('font-size: 0.72rem')
    expect(shortcutsSource).toContain('font-size: 0.78rem')
  })
})
