export type BlockMenuActionId =
  | 'insert_above'
  | 'insert_below'
  | 'move_up'
  | 'move_down'
  | 'turn_into'
  | 'duplicate'
  | 'delete'
  | 'copy_anchor'

export type TurnIntoType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'codeBlock'
  | 'quote'

export type BlockMenuTarget = {
  pos: number
  nodeType: string
  nodeSize: number
  canDelete: boolean
  canConvert: boolean
  text: string
  isVirtualTitle: boolean
}

export type BlockMenuActionItem = {
  id: string
  actionId: BlockMenuActionId
  label: string
  turnIntoType?: TurnIntoType
  disabled?: boolean
}
