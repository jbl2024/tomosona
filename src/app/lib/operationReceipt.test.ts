import { describe, expect, it } from 'vitest'
import { createOperationReceipt, planReceiptRestore } from './operationReceipt'

const receipt = createOperationReceipt({
  id: 'op-1',
  kind: 'move',
  now: () => 1000,
  moves: [
    { from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' },
    { from: '/vault/notes', to: '/vault/archive' },
    { from: '/vault/same.md', to: '/vault/same.md' }
  ],
  referenceSnapshots: [
    { path: '/vault/notes/source.md', before: '[[notes/Topic]]', after: '[[projects/Topic]]' }
  ]
})

describe('operation receipt', () => {
  it('normalizes moves and drops no-op entries when creating a receipt', () => {
    expect(receipt.moves.map((move) => [move.from, move.to])).toEqual([
      ['/vault/notes/Topic.md', '/vault/projects/Topic.md'],
      ['/vault/notes', '/vault/archive']
    ])
    expect(receipt.id).toBe('op-1')
    expect(receipt.createdAtMs).toBe(1000)
  })

  it('restores moves and references when the current state still matches', () => {
    const plan = planReceiptRestore({
      receipt,
      currentPaths: ['/vault/projects/Topic.md', '/vault/archive', '/vault/notes/source.md'],
      currentContents: { '/vault/notes/source.md': '[[projects/Topic]]' }
    })
    expect(plan.issues).toEqual([])
    expect(plan.moves).toEqual([
      { from: '/vault/projects/Topic.md', to: '/vault/notes/Topic.md' },
      { from: '/vault/archive', to: '/vault/notes' }
    ])
    expect(plan.referenceRestores).toEqual([{ path: '/vault/notes/source.md', content: '[[notes/Topic]]' }])
  })

  it('never overwrites an occupied original path or a vanished destination', () => {
    const plan = planReceiptRestore({
      receipt,
      currentPaths: ['/vault/projects/Topic.md', '/vault/archive', '/vault/notes/Topic.md'],
      currentContents: {}
    })
    expect(plan.moves).toEqual([{ from: '/vault/archive', to: '/vault/notes' }])
    expect(plan.issues).toContainEqual({ path: '/vault/notes/Topic.md', reason: 'occupied_source' })

    const missing = planReceiptRestore({
      receipt,
      currentPaths: [],
      currentContents: {}
    })
    expect(missing.moves).toEqual([])
    expect(missing.issues).toEqual([
      { path: '/vault/projects/Topic.md', reason: 'missing_destination' },
      { path: '/vault/archive', reason: 'missing_destination' },
      { path: '/vault/notes/source.md', reason: 'changed_content' }
    ])
  })

  it('refuses reference restoration when the file changed and skips already-restored files', () => {
    const changed = planReceiptRestore({
      receipt,
      currentPaths: ['/vault/projects/Topic.md', '/vault/archive', '/vault/notes/source.md'],
      currentContents: { '/vault/notes/source.md': 'edited by someone else' }
    })
    expect(changed.referenceRestores).toEqual([])
    expect(changed.issues).toContainEqual({ path: '/vault/notes/source.md', reason: 'changed_content' })

    const already = planReceiptRestore({
      receipt,
      currentPaths: ['/vault/projects/Topic.md', '/vault/archive', '/vault/notes/source.md'],
      currentContents: { '/vault/notes/source.md': '[[notes/Topic]]' }
    })
    expect(already.referenceRestores).toEqual([])
    expect(already.issues.filter((issue) => issue.reason === 'changed_content')).toEqual([])
  })

  it('treats a trash receipt as a move back out of the trash destination', () => {
    const trashReceipt = createOperationReceipt({
      kind: 'trash',
      moves: [{ from: '/vault/notes/old.md', to: '/vault/.tomosona-trash/old.md' }]
    })
    const plan = planReceiptRestore({
      receipt: trashReceipt,
      currentPaths: ['/vault/.tomosona-trash/old.md'],
      currentContents: {}
    })
    expect(plan.issues).toEqual([])
    expect(plan.moves).toEqual([{ from: '/vault/.tomosona-trash/old.md', to: '/vault/notes/old.md' }])
  })
})
