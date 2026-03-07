import { computed, ref, type Ref } from 'vue'
import type { BlockMenuActionItem, BlockMenuTarget, TurnIntoType } from '../lib/tiptap/blockMenu/types'
import { canCopyAnchor, canTurnInto } from '../lib/tiptap/blockMenu/guards'
import { canMoveDown, canMoveUp } from '../lib/tiptap/blockMenu/actions'
import { resolveActiveTarget } from '../lib/tiptap/blockMenu/dragHandleState'
import type { Editor } from '@tiptap/vue-3'

/**
 * useBlockMenuControls
 *
 * Purpose:
 * - Encapsulate block-menu target/action derivation.
 *
 * Responsibilities:
 * - Resolve active target from transient and stable values.
 * - Build enabled/disabled action rows for move/duplicate/delete/copy.
 * - Build "turn into" action rows from allowed block types.
 *
 * Boundary:
 * - This composable only derives menu state; command execution remains in the caller.
 */
export function useBlockMenuControls(options: {
  getEditor: () => Editor | null
  turnIntoTypes: TurnIntoType[]
  turnIntoLabels: Record<TurnIntoType, string>
  activeTarget: Ref<BlockMenuTarget | null>
  stableTarget: Ref<BlockMenuTarget | null>
}) {
  const blockMenuOpen = ref(false)
  const blockMenuIndex = ref(0)
  const blockMenuTarget = ref<BlockMenuTarget | null>(null)

  const actionTarget = computed(() => resolveActiveTarget(options.activeTarget.value, options.stableTarget.value))

  const actions = computed<BlockMenuActionItem[]>(() => {
    const editor = options.getEditor()
    const target = actionTarget.value
    const moveUp = Boolean(editor && target && !target.isVirtualTitle && canMoveUp(editor, target))
    const moveDown = Boolean(editor && target && !target.isVirtualTitle && canMoveDown(editor, target))

    return [
      { id: 'insert_above', actionId: 'insert_above', label: 'Insert above', disabled: !target },
      { id: 'insert_below', actionId: 'insert_below', label: 'Insert below', disabled: !target },
      { id: 'move_up', actionId: 'move_up', label: 'Move up', disabled: !moveUp },
      { id: 'move_down', actionId: 'move_down', label: 'Move down', disabled: !moveDown },
      { id: 'duplicate', actionId: 'duplicate', label: 'Duplicate', disabled: !target },
      { id: 'copy_anchor', actionId: 'copy_anchor', label: 'Copy anchor', disabled: !canCopyAnchor(target) },
      { id: 'delete', actionId: 'delete', label: 'Delete', disabled: !target?.canDelete }
    ]
  })

  const convertActions = computed<BlockMenuActionItem[]>(() => {
    const target = actionTarget.value
    return options.turnIntoTypes.map((turnIntoType) => ({
      id: `turn_into:${turnIntoType}`,
      actionId: 'turn_into' as const,
      turnIntoType,
      label: options.turnIntoLabels[turnIntoType],
      disabled: !canTurnInto(target, turnIntoType)
    }))
  })

  return {
    blockMenuOpen,
    blockMenuIndex,
    blockMenuTarget,
    actionTarget,
    actions,
    convertActions
  }
}
