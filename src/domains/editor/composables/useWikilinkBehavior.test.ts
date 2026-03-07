import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWikilinkBehavior } from './useWikilinkBehavior'

function setCollapsedSelection(textNode: Text, offset: number) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function createBehavior(overrides: Partial<Parameters<typeof useWikilinkBehavior>[0]> = {}) {
  const holderEl = document.createElement('div')
  document.body.appendChild(holderEl)

  const currentPath = ref('notes/a.md')
  const dirtyByPath = ref<Record<string, boolean>>({})

  const behavior = useWikilinkBehavior({
    holder: ref(holderEl),
    currentPath,
    dirtyByPath,
    isMacOs: true,
    loadLinkTargets: vi.fn(async () => ['Notes/Alpha', 'Notes/Beta']),
    loadLinkHeadings: vi.fn(async () => ['Intro', 'Next']),
    openLinkTarget: vi.fn(async () => true),
    saveCurrentFile: vi.fn(async () => {}),
    clearAutosaveTimer: vi.fn(),
    setDirty: vi.fn(),
    setSaveError: vi.fn(),
    scheduleAutosave: vi.fn(),
    parseOutlineFromDom: () => [{ level: 2, text: 'Intro' as const }],
    ...overrides
  })

  return { behavior, holderEl, currentPath, dirtyByPath }
}

describe('useWikilinkBehavior', () => {
  it('opens wikilink suggestions from caret query', async () => {
    const { behavior, holderEl } = createBehavior()
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    const textNode = document.createTextNode('[[Al')
    editable.appendChild(textNode)
    holderEl.appendChild(editable)
    editable.focus()
    setCollapsedSelection(textNode, textNode.data.length)

    await behavior.syncWikilinkMenuFromCaret()

    expect(behavior.wikilinkOpen.value).toBe(true)
    expect(behavior.wikilinkResults.value.length).toBeGreaterThan(0)
    expect(behavior.wikilinkResults.value.some((item) => item.target === 'Notes/Alpha')).toBe(true)
  })

  it('extracts target from wikilink anchor dataset and href fallback', () => {
    const { behavior } = createBehavior()

    const withData = document.createElement('a')
    withData.dataset.wikilinkTarget = 'Notes/Today'
    expect(behavior.readWikilinkTargetFromAnchor(withData)).toBe('Notes/Today')

    const withHref = document.createElement('a')
    withHref.setAttribute('href', `wikilink:${encodeURIComponent('Notes/FromHref')}`)
    expect(behavior.readWikilinkTargetFromAnchor(withHref)).toBe('Notes/FromHref')
  })

  it('signals wikilink sync relevance from current selection text', () => {
    const { behavior, holderEl } = createBehavior()
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    const textNode = document.createTextNode('draft [[note')
    editable.appendChild(textNode)
    holderEl.appendChild(editable)
    editable.focus()
    setCollapsedSelection(textNode, textNode.data.length)

    expect(behavior.shouldSyncWikilinkFromSelection()).toBe(true)
  })

  it('saves before opening target when current note is dirty', async () => {
    const openLinkTarget = vi.fn(async () => true)
    const clearAutosaveTimer = vi.fn()
    const dirtyByPath = ref<Record<string, boolean>>({ 'notes/a.md': true })
    const saveCurrentFile = vi.fn(async () => {
      dirtyByPath.value['notes/a.md'] = false
    })

    const { behavior } = createBehavior({
      dirtyByPath,
      openLinkTarget,
      saveCurrentFile,
      clearAutosaveTimer
    })

    await behavior.openLinkTargetWithAutosave('Notes/Destination')

    expect(clearAutosaveTimer).toHaveBeenCalledTimes(1)
    expect(saveCurrentFile).toHaveBeenCalledWith(false)
    expect(openLinkTarget).toHaveBeenCalledWith('Notes/Destination')
  })
})
