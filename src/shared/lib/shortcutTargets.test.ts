import { describe, expect, it } from 'vitest'

import { hasActiveTextSelectionInEditor, shouldBlockGlobalShortcutsFromTarget } from './shortcutTargets'

describe('shouldBlockGlobalShortcutsFromTarget', () => {
  it('does not block when target is null', () => {
    expect(shouldBlockGlobalShortcutsFromTarget(null)).toBe(false)
  })

  it('blocks for regular form controls', () => {
    expect(shouldBlockGlobalShortcutsFromTarget(document.createElement('input'))).toBe(true)
    expect(shouldBlockGlobalShortcutsFromTarget(document.createElement('textarea'))).toBe(true)
    expect(shouldBlockGlobalShortcutsFromTarget(document.createElement('select'))).toBe(true)
  })

  it('allows shortcuts in search panel input', () => {
    const input = document.createElement('input')
    input.setAttribute('data-search-input', 'true')
    expect(shouldBlockGlobalShortcutsFromTarget(input)).toBe(false)
  })

  it('blocks contenteditable outside editor shell', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(shouldBlockGlobalShortcutsFromTarget(div)).toBe(true)
  })

  it('allows contenteditable inside editor shell', () => {
    const shell = document.createElement('div')
    shell.className = 'editor-shell'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    shell.appendChild(editable)
    document.body.appendChild(shell)

    expect(shouldBlockGlobalShortcutsFromTarget(editable)).toBe(false)

    shell.remove()
  })
})

describe('hasActiveTextSelectionInEditor', () => {
  it('returns false when selection is empty', () => {
    const shell = document.createElement('div')
    shell.className = 'editor-shell'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.textContent = 'hello world'
    shell.appendChild(editable)
    document.body.appendChild(shell)

    const selection = window.getSelection()
    selection?.removeAllRanges()

    expect(hasActiveTextSelectionInEditor(editable)).toBe(false)
    shell.remove()
  })

  it('returns true for non-empty selection inside editor shell', () => {
    const shell = document.createElement('div')
    shell.className = 'editor-shell'
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.textContent = 'hello world'
    shell.appendChild(editable)
    document.body.appendChild(shell)

    const text = editable.firstChild as Text | null
    const range = document.createRange()
    if (!text) throw new Error('expected editable text node')
    range.setStart(text, 0)
    range.setEnd(text, 5)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(hasActiveTextSelectionInEditor(editable)).toBe(true)

    selection?.removeAllRanges()
    shell.remove()
  })
})
