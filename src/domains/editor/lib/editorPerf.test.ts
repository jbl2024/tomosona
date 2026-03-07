import { describe, expect, it } from 'vitest'

import { collectAffectedCodeBlocks, hasWikilinkHint } from './editorPerf'

function mutationRecordLike(payload: {
  target: Node
  addedNodes?: Node[]
  removedNodes?: Node[]
}): MutationRecord {
  return {
    type: 'childList',
    target: payload.target,
    addedNodes: payload.addedNodes ?? [],
    removedNodes: payload.removedNodes ?? [],
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null
  } as unknown as MutationRecord
}

describe('hasWikilinkHint', () => {
  it('detects bracket-based wikilink typing hints', () => {
    expect(hasWikilinkHint('abc')).toBe(false)
    expect(hasWikilinkHint('[')).toBe(true)
    expect(hasWikilinkHint('[[note')).toBe(true)
    expect(hasWikilinkHint('note]]')).toBe(true)
  })
})

describe('collectAffectedCodeBlocks', () => {
  it('collects code blocks from direct targets and added nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="ce-code" id="code-a"><textarea class="ce-code__textarea"></textarea></div>
      <div class="other" id="other"></div>
    `

    const targetInsideCode = root.querySelector('#code-a .ce-code__textarea') as HTMLElement
    const wrapper = document.createElement('div')
    wrapper.innerHTML = `<div class="ce-code" id="code-b"></div>`
    const newCode = wrapper.firstElementChild as HTMLElement
    ;(root.querySelector('#other') as HTMLElement).appendChild(newCode)

    const records = [
      mutationRecordLike({ target: targetInsideCode }),
      mutationRecordLike({ target: root.querySelector('#other') as HTMLElement, addedNodes: [newCode] })
    ]

    const blocks = collectAffectedCodeBlocks(records, root)
    const ids = blocks.map((node) => node.id).sort()
    expect(ids).toEqual(['code-a', 'code-b'])
  })

  it('does not mark existing code blocks when a non-code sibling is added or removed', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="ce-code" id="code-a"></div>
      <div class="ce-block" id="paragraph"></div>
    `

    const paragraph = root.querySelector('#paragraph') as HTMLElement
    const records = [
      mutationRecordLike({ target: root, addedNodes: [paragraph] }),
      mutationRecordLike({ target: root, removedNodes: [paragraph] })
    ]

    const blocks = collectAffectedCodeBlocks(records, root)
    expect(blocks).toHaveLength(0)
  })

  it('ignores mutations outside the editor root', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div class="ce-code" id="in-root"></div>`
    const external = document.createElement('div')
    external.innerHTML = `<div class="ce-code" id="outside"></div>`

    const records = [mutationRecordLike({ target: external, addedNodes: [external.firstElementChild as Node] })]
    const blocks = collectAffectedCodeBlocks(records, root)
    expect(blocks).toHaveLength(0)
  })
})
