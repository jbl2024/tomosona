import { describe, expect, it } from 'vitest'
import { shouldRefocusEditorAfterTabSwitch } from './editorFocusPolicy'

describe('shouldRefocusEditorAfterTabSwitch', () => {
  it('returns true when active element is inside editor holder', () => {
    const holder = document.createElement('div')
    holder.className = 'editor-holder'
    const editable = document.createElement('div')
    editable.className = 'ProseMirror'
    holder.appendChild(editable)
    document.body.appendChild(holder)

    expect(shouldRefocusEditorAfterTabSwitch(editable)).toBe(true)
  })

  it('returns false for non-editor focused elements', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    expect(shouldRefocusEditorAfterTabSwitch(button)).toBe(false)
  })

  it('returns false for null active element', () => {
    expect(shouldRefocusEditorAfterTabSwitch(null)).toBe(false)
  })
})
