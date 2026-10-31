import { describe, expect, it } from 'vitest'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { getDrawSelectionConfig } from '@codemirror/view'
import { resolveSourceCursorExtensions } from './sourceEditorCursor'

describe('resolveSourceCursorExtensions', () => {
  it('keeps the native caret for the bar style and unknown values', () => {
    expect(resolveSourceCursorExtensions('bar', true)).toEqual([])
    expect(resolveSourceCursorExtensions(undefined, undefined)).toEqual([])
  })

  it('draws a themed cursor for block and underline styles', () => {
    expect(resolveSourceCursorExtensions('block', true).length).toBeGreaterThan(0)
    expect(resolveSourceCursorExtensions('underline', true).length).toBeGreaterThan(0)
  })

  it('slows the blink cycle to 2.4s while blinking is enabled', () => {
    const state = EditorState.create({
      extensions: [basicSetup, ...resolveSourceCursorExtensions('block', true)]
    })
    expect(getDrawSelectionConfig(state).cursorBlinkRate).toBe(2400)
  })

  it('disables blinking without registering a second cursor layer', () => {
    const state = EditorState.create({
      extensions: [basicSetup, ...resolveSourceCursorExtensions('block', false)]
    })
    expect(getDrawSelectionConfig(state).cursorBlinkRate).toBe(0)
  })
})
