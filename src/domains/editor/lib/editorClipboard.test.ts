import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  extractSelectionClipboardPayload,
  writeSelectionPayloadToClipboard,
  type ClipboardSelectionPayload
} from './editorClipboard'

function makeSelection(range: Range): Selection {
  const selection = window.getSelection()
  if (!selection) throw new Error('Selection API unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

describe('extractSelectionClipboardPayload', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    const selection = window.getSelection()
    selection?.removeAllRanges()
  })

  it('extracts plain/html/markdown from a non-empty selection inside root', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Hello <strong>world</strong></p>'
    document.body.appendChild(root)

    const strongEl = root.querySelector('strong') as HTMLElement
    const range = document.createRange()
    range.setStartBefore(strongEl)
    range.setEndAfter(strongEl)
    const selection = makeSelection(range)

    const payload = extractSelectionClipboardPayload(root, selection)
    expect(payload).toBeTruthy()
    expect(payload?.plain).toBe('world')
    expect(payload?.html).toContain('<strong>world</strong>')
    expect(payload?.markdown).toBeTruthy()
  })

  it('ignores selections outside the editor root', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Inside</p>'
    document.body.appendChild(root)

    const outside = document.createElement('p')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)

    const textNode = outside.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = makeSelection(range)

    expect(extractSelectionClipboardPayload(root, selection)).toBeNull()
  })
})

describe('writeSelectionPayloadToClipboard', () => {
  const payload: ClipboardSelectionPayload = {
    plain: 'hello',
    html: '<strong>hello</strong>',
    markdown: '**hello**'
  }

  it('falls back to writeText when rich clipboard API is unavailable', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    vi.stubGlobal('ClipboardItem', undefined)

    await writeSelectionPayloadToClipboard(payload, 'markdown')
    expect(writeText).toHaveBeenCalledWith('**hello**')
  })

  it('writes markdown in text/plain for explicit markdown copy', async () => {
    const write = vi.fn<(items: Array<{ data: Record<string, Blob> }>) => Promise<void>>(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText: vi.fn(async () => {}) }
    })
    class ClipboardItemMock {
      data: Record<string, Blob>
      constructor(data: Record<string, Blob>) {
        this.data = data
      }
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemMock as unknown as typeof ClipboardItem)

    await writeSelectionPayloadToClipboard(payload, 'markdown')
    expect(write).toHaveBeenCalledTimes(1)

    const items = write.mock.calls[0]?.[0] ?? []
    expect(items).toHaveLength(1)
    const plainBlob = items[0].data['text/plain'] as Blob
    const markdownBlob = items[0].data['text/markdown'] as Blob
    expect(plainBlob).toBeTruthy()
    expect(markdownBlob).toBeTruthy()
    expect(plainBlob.size).toBe('**hello**'.length)
    expect(markdownBlob.size).toBe('**hello**'.length)
  })
})
