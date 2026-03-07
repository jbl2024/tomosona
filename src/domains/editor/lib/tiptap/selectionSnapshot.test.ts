import { describe, expect, it } from 'vitest'
import { NodeSelection } from '@tiptap/pm/state'
import { toPersistedTextSelection } from './selectionSnapshot'

describe('toPersistedTextSelection', () => {
  it('keeps text selection range', () => {
    const selection = { from: 3, to: 9 } as unknown as Parameters<typeof toPersistedTextSelection>[0]
    expect(toPersistedTextSelection(selection)).toEqual({ from: 3, to: 9 })
  })

  it('normalizes reversed text range', () => {
    const selection = { from: 12, to: 5 } as unknown as Parameters<typeof toPersistedTextSelection>[0]
    expect(toPersistedTextSelection(selection)).toEqual({ from: 5, to: 12 })
  })

  it('collapses node selection to caret', () => {
    const selection = Object.create(NodeSelection.prototype) as NodeSelection
    Object.defineProperty(selection, 'from', { value: 14, configurable: true })
    Object.defineProperty(selection, 'to', { value: 19, configurable: true })
    expect(toPersistedTextSelection(selection)).toEqual({ from: 14, to: 14 })
  })
})
