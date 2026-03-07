import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockMenuTarget } from '../lib/tiptap/blockMenu/types'
import type { DragHandleUiState } from '../lib/tiptap/blockMenu/dragHandleState'
import { useBlockMenuControls } from './useBlockMenuControls'
import { useEditorBlockHandleControls } from './useEditorBlockHandleControls'

function createTarget(): BlockMenuTarget {
  return {
    pos: 1,
    nodeSize: 2,
    nodeType: 'paragraph',
    text: 'Hello',
    isVirtualTitle: false,
    canDelete: true,
    canConvert: true
  }
}

describe('useEditorBlockHandleControls', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function createHarness() {
    const dragHandleUiState = ref<DragHandleUiState>({
      menuOpen: false,
      gutterHover: false,
      controlsHover: false,
      dragging: false,
      activeTarget: createTarget()
    })
    const stableTarget = ref<BlockMenuTarget | null>(createTarget())
    const blockMenuControls = useBlockMenuControls({
      getEditor: () => ({ state: { doc: { resolve: () => ({ index: () => 1 }) } } } as any),
      turnIntoTypes: ['paragraph'],
      turnIntoLabels: { paragraph: 'Paragraph' } as any,
      activeTarget: computed(() => dragHandleUiState.value.activeTarget),
      stableTarget
    })

    const editor = {
      state: {
        doc: {
          nodeAt: vi.fn(() => ({
            type: { name: 'paragraph' },
            nodeSize: 2,
            textContent: 'Hello',
            attrs: { id: 'a' }
          }))
        }
      },
      commands: {
        setMeta: vi.fn()
      }
    } as any

    const controls = useEditorBlockHandleControls({
      getEditor: () => editor,
      blockMenuOpen: blockMenuControls.blockMenuOpen,
      blockMenuIndex: blockMenuControls.blockMenuIndex,
      blockMenuTarget: blockMenuControls.blockMenuTarget,
      blockMenuActionTarget: blockMenuControls.actionTarget,
      dragHandleUiState,
      lastStableBlockMenuTarget: stableTarget,
      setBlockMenuPos: vi.fn(),
      setDragHandleLockMeta: vi.fn(),
      closeSlashMenu: vi.fn(),
      closeWikilinkMenu: vi.fn(),
      openSlashAtSelection: vi.fn(),
      copyTextToClipboard: vi.fn()
    })

    return { controls, blockMenuControls, dragHandleUiState, editor }
  }

  it('opens and closes menu with drag lock sync', () => {
    const { controls, blockMenuControls } = createHarness()
    const trigger = document.createElement('button')
    const event = new MouseEvent('click')
    Object.defineProperty(event, 'currentTarget', { value: trigger })

    controls.toggleBlockMenu(event)
    expect(blockMenuControls.blockMenuOpen.value).toBe(true)

    controls.closeBlockMenu()
    expect(blockMenuControls.blockMenuOpen.value).toBe(false)
  })

  it('guards opening when drag handle root indicates active dragging', () => {
    const { controls, dragHandleUiState } = createHarness()
    const root = document.createElement('div')
    root.className = 'tomosona-drag-handle'
    root.setAttribute('data-dragging', 'true')
    const btn = document.createElement('button')
    root.appendChild(btn)
    const event = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(event, 'currentTarget', { value: btn })

    controls.toggleBlockMenu(event)

    expect(dragHandleUiState.value.dragging).toBe(true)
  })

  it('updates target from node-change payload and dedupes lock meta updates', () => {
    const { controls, dragHandleUiState } = createHarness()

    controls.onBlockHandleNodeChange({
      pos: 1,
      node: { type: { name: 'paragraph' }, nodeSize: 2, attrs: {}, textContent: 'Hello' }
    })

    expect(dragHandleUiState.value.activeTarget?.nodeType).toBe('paragraph')

    controls.syncDragHandleLockFromState('a')
    controls.syncDragHandleLockFromState('b')
  })

  it('keeps target briefly on null node change before clearing', () => {
    vi.useFakeTimers()
    const { controls, dragHandleUiState } = createHarness()

    controls.onBlockHandleNodeChange({ pos: 1, node: null })
    expect(dragHandleUiState.value.activeTarget).not.toBeNull()

    vi.advanceTimersByTime(130)
    expect(dragHandleUiState.value.activeTarget).toBeNull()
  })

  it('does not clear target while controls are hovered', () => {
    vi.useFakeTimers()
    const { controls, dragHandleUiState } = createHarness()

    controls.onHandleControlsEnter()
    controls.onBlockHandleNodeChange({ pos: 1, node: null })
    vi.advanceTimersByTime(130)

    expect(dragHandleUiState.value.activeTarget).not.toBeNull()
    expect(dragHandleUiState.value.controlsHover).toBe(true)
    expect(dragHandleUiState.value.gutterHover).toBe(true)
  })
})
