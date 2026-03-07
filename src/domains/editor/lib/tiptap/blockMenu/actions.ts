import type { Editor } from '@tiptap/vue-3'
import { Fragment, type Node as ProseNode, type Schema } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { BlockMenuTarget, TurnIntoType } from './types'

function createInlineContent(schema: Schema, text = ''): ProseNode[] | undefined {
  if (!text) return undefined
  const hardBreak = schema.nodes.hardBreak
  if (!hardBreak || !text.includes('\n')) {
    return [schema.text(text)]
  }

  const parts = text.split('\n')
  const content: ProseNode[] = []
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]) content.push(schema.text(parts[i]))
    if (i < parts.length - 1) content.push(hardBreak.create())
  }
  return content.length ? content : undefined
}

function extractInlineFragmentFromNode(node: ProseNode): Fragment | null {
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    return node.content.size > 0 ? node.content : null
  }

  if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i)
      if (child.type.name !== 'paragraph') continue
      return child.content.size > 0 ? child.content : null
    }
  }

  return null
}

function createParagraph(schema: Schema, text = '', inlineFragment?: Fragment | null): ProseNode | null {
  const paragraph = schema.nodes.paragraph
  if (!paragraph) return null
  if (inlineFragment && inlineFragment.size > 0) {
    return paragraph.create(null, inlineFragment)
  }
  const content = createInlineContent(schema, text)
  return paragraph.create(null, content)
}

function createTurnIntoNode(schema: Schema, type: TurnIntoType, sourceNode: ProseNode, text: string): ProseNode | null {
  const inlineFragment = extractInlineFragmentFromNode(sourceNode)
  const paragraph = createParagraph(schema, text, inlineFragment)
  if (!paragraph) return null

  if (type === 'paragraph') return paragraph

  if (type === 'heading1' || type === 'heading2' || type === 'heading3') {
    const heading = schema.nodes.heading
    if (!heading) return null
    const level = Number(type.slice(-1))
    return heading.create({ level }, paragraph.content)
  }

  if (type === 'quote') {
    const quoteBlock = schema.nodes.quoteBlock
    if (!quoteBlock) return null
    return quoteBlock.create({ text })
  }

  if (type === 'codeBlock') {
    const codeBlock = schema.nodes.codeBlock
    if (!codeBlock) return null
    return codeBlock.create(null, text ? [schema.text(text)] : undefined)
  }

  if (type === 'bulletList' || type === 'orderedList') {
    const listType = type === 'orderedList' ? schema.nodes.orderedList : schema.nodes.bulletList
    const listItem = schema.nodes.listItem
    if (!listType || !listItem) return null
    return listType.create(null, [listItem.create(null, [paragraph])])
  }

  if (type === 'taskList') {
    const taskList = schema.nodes.taskList
    const taskItem = schema.nodes.taskItem
    if (!taskList || !taskItem) return null
    return taskList.create(null, [taskItem.create({ checked: false }, [paragraph])])
  }

  return null
}

function lineText(node: ProseNode | null | undefined): string {
  if (!node) return ''
  switch (node.type.name) {
    case 'quoteBlock':
      return String(node.attrs.text ?? '')
    case 'calloutBlock':
      return String(node.attrs.message ?? '')
    case 'mermaidBlock':
      return String(node.attrs.code ?? '')
    case 'htmlBlock':
      return String(node.attrs.html ?? '')
    case 'hardBreak':
      return '\n'
    case 'codeBlock':
    case 'paragraph':
    case 'heading':
      return node.textContent ?? ''
    case 'listItem':
    case 'taskItem': {
      const lines: string[] = []
      node.forEach((child) => {
        if (child.type.name === 'bulletList' || child.type.name === 'orderedList' || child.type.name === 'taskList') {
          const nested = lineText(child)
          if (nested) lines.push(nested)
          return
        }
        const text = lineText(child)
        if (text) lines.push(text)
      })
      return lines.join('\n')
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const items: string[] = []
      node.forEach((child) => {
        const text = lineText(child)
        if (text) items.push(text)
      })
      return items.join('\n')
    }
    case 'table': {
      const rows: string[] = []
      node.forEach((row) => {
        if (row.type.name !== 'tableRow') return
        const cells: string[] = []
        row.forEach((cell) => {
          const cellLines: string[] = []
          cell.forEach((child) => {
            const text = lineText(child)
            if (text) cellLines.push(text)
          })
          cells.push(cellLines.join('\n'))
        })
        rows.push(cells.join(' | '))
      })
      return rows.join('\n')
    }
    default: {
      if (!node.childCount) return node.textContent ?? ''
      const lines: string[] = []
      node.forEach((child) => {
        const text = lineText(child)
        if (text) lines.push(text)
      })
      return lines.length ? lines.join('\n') : (node.textContent ?? '')
    }
  }
}

function sourceTextForTurnInto(node: ProseNode): string {
  return lineText(node) || node.textContent || ''
}

function isListTypeName(typeName: string): boolean {
  return typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList'
}

function listTypeNodeFromTurnIntoType(schema: Schema, type: TurnIntoType): ProseNode['type'] | null {
  if (type === 'bulletList') return schema.nodes.bulletList ?? null
  if (type === 'orderedList') return schema.nodes.orderedList ?? null
  if (type === 'taskList') return schema.nodes.taskList ?? null
  return null
}

function listItemTypeNodeForList(schema: Schema, listTypeName: string): ProseNode['type'] | null {
  if (listTypeName === 'taskList') return schema.nodes.taskItem ?? null
  if (listTypeName === 'bulletList' || listTypeName === 'orderedList') return schema.nodes.listItem ?? null
  return null
}

function findAncestorListEntry(editor: Editor, pos: number): { pos: number; node: ProseNode } | null {
  const resolved = editor.state.doc.resolve(Math.max(1, Math.min(pos + 1, editor.state.doc.content.size)))
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    const node = resolved.node(depth)
    if (!isListTypeName(node.type.name)) continue
    const before = depth === 0 ? 0 : resolved.before(depth)
    return { pos: before, node }
  }
  return null
}

function createParagraphFromListItem(schema: Schema, item: ProseNode): ProseNode | null {
  for (let i = 0; i < item.childCount; i += 1) {
    const child = item.child(i)
    if (child.type.name !== 'paragraph') continue
    return createParagraph(schema, child.textContent ?? '', child.content)
  }
  return createParagraph(schema, lineText(item))
}

function convertListNode(schema: Schema, listNode: ProseNode, type: TurnIntoType): ProseNode | null {
  const nextListType = listTypeNodeFromTurnIntoType(schema, type)
  if (!nextListType) return null
  const nextItemType = listItemTypeNodeForList(schema, nextListType.name)
  if (!nextItemType) return null

  const convertedItems: ProseNode[] = []
  listNode.forEach((item) => {
    if (item.type.name !== 'listItem' && item.type.name !== 'taskItem') return
    const paragraph = createParagraphFromListItem(schema, item)
    if (!paragraph) return

    const nestedChildren: ProseNode[] = []
    item.forEach((child) => {
      if (child.type.name === 'paragraph') return
      nestedChildren.push(child)
    })
    const attrs = nextItemType.name === 'taskItem'
      ? { checked: item.type.name === 'taskItem' ? Boolean(item.attrs?.checked) : false }
      : null
    convertedItems.push(nextItemType.create(attrs, [paragraph, ...nestedChildren]))
  })

  if (!convertedItems.length) return null
  return nextListType.create(null, convertedItems)
}

function focusNearPos(editor: Editor, pos: number) {
  const { doc } = editor.state
  const max = Math.max(1, doc.content.size)
  const nextPos = Math.max(1, Math.min(pos, max))
  const resolved = doc.resolve(nextPos)
  const nextSelection = TextSelection.findFrom(resolved, 1, true) ?? TextSelection.findFrom(resolved, -1, true)
  if (!nextSelection) {
    editor.commands.focus()
    return
  }
  editor.view.dispatch(editor.state.tr.setSelection(nextSelection))
  editor.commands.focus(nextSelection.from)
}

function topLevelEntryByPos(editor: Editor, pos: number): { index: number; pos: number; node: ProseNode } | null {
  const { doc } = editor.state
  let found: { index: number; pos: number; node: ProseNode } | null = null
  doc.forEach((node, offset, index) => {
    if (found) return
    if (offset === pos) {
      found = { index, pos: offset, node }
    }
  })
  return found
}

function topLevelEntryByIndex(editor: Editor, index: number): { index: number; pos: number; node: ProseNode } | null {
  const { doc } = editor.state
  let found: { index: number; pos: number; node: ProseNode } | null = null
  doc.forEach((node, offset, currentIndex) => {
    if (found) return
    if (currentIndex === index) {
      found = { index: currentIndex, pos: offset, node }
    }
  })
  return found
}

export function canMoveUp(editor: Editor, target: BlockMenuTarget): boolean {
  const current = topLevelEntryByPos(editor, target.pos)
  if (!current) return false
  return current.index > 0
}

export function canMoveDown(editor: Editor, target: BlockMenuTarget): boolean {
  const current = topLevelEntryByPos(editor, target.pos)
  if (!current) return false
  return current.index < editor.state.doc.childCount - 1
}

export function insertAbove(editor: Editor, target: BlockMenuTarget): boolean {
  const node = createParagraph(editor.state.schema)
  if (!node) return false
  const tr = editor.state.tr.insert(target.pos, node)
  editor.view.dispatch(tr)
  focusNearPos(editor, target.pos + 1)
  return true
}

export function insertBelow(editor: Editor, target: BlockMenuTarget): boolean {
  const node = createParagraph(editor.state.schema)
  if (!node) return false
  const insertPos = target.pos + target.nodeSize
  const tr = editor.state.tr.insert(insertPos, node)
  editor.view.dispatch(tr)
  focusNearPos(editor, insertPos + 1)
  return true
}

export function duplicateNode(editor: Editor, target: BlockMenuTarget): boolean {
  const node = editor.state.doc.nodeAt(target.pos)
  if (!node) return false
  const clone = editor.state.schema.nodeFromJSON(node.toJSON())
  const insertPos = target.pos + node.nodeSize
  const tr = editor.state.tr.insert(insertPos, clone)
  editor.view.dispatch(tr)
  focusNearPos(editor, insertPos + 1)
  return true
}

export function moveNodeUp(editor: Editor, target: BlockMenuTarget): boolean {
  const current = topLevelEntryByPos(editor, target.pos)
  if (!current || current.index === 0) return false
  const previous = topLevelEntryByIndex(editor, current.index - 1)
  if (!previous) return false

  const from = previous.pos
  const to = current.pos + current.node.nodeSize
  const fragment = Fragment.fromArray([current.node, previous.node])
  const tr = editor.state.tr.replaceWith(from, to, fragment)
  editor.view.dispatch(tr)
  focusNearPos(editor, from + 1)
  return true
}

export function moveNodeDown(editor: Editor, target: BlockMenuTarget): boolean {
  const current = topLevelEntryByPos(editor, target.pos)
  if (!current || current.index >= editor.state.doc.childCount - 1) return false
  const next = topLevelEntryByIndex(editor, current.index + 1)
  if (!next) return false

  const from = current.pos
  const to = next.pos + next.node.nodeSize
  const fragment = Fragment.fromArray([next.node, current.node])
  const tr = editor.state.tr.replaceWith(from, to, fragment)
  editor.view.dispatch(tr)
  focusNearPos(editor, next.pos + 1)
  return true
}

export function deleteNode(editor: Editor, target: BlockMenuTarget): boolean {
  const node = editor.state.doc.nodeAt(target.pos)
  if (!node) return false
  const tr = editor.state.tr.delete(target.pos, target.pos + node.nodeSize)
  const fallback = Math.max(1, Math.min(target.pos, tr.doc.content.size))
  tr.setSelection(TextSelection.near(tr.doc.resolve(fallback), -1))
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}

export function turnInto(editor: Editor, target: BlockMenuTarget, type: TurnIntoType): boolean {
  const node = editor.state.doc.nodeAt(target.pos)
  if (!node) return false

  if (type === 'bulletList' || type === 'orderedList' || type === 'taskList') {
    const listAncestor = findAncestorListEntry(editor, target.pos)
    if (listAncestor) {
      const convertedList = convertListNode(editor.state.schema, listAncestor.node, type)
      if (!convertedList) return false
      const tr = editor.state.tr.replaceWith(listAncestor.pos, listAncestor.pos + listAncestor.node.nodeSize, convertedList)
      editor.view.dispatch(tr)
      focusNearPos(editor, listAncestor.pos + 1)
      return true
    }
  }

  const replacement = createTurnIntoNode(editor.state.schema, type, node, sourceTextForTurnInto(node))
  if (!replacement) return false

  const tr = editor.state.tr.replaceWith(target.pos, target.pos + node.nodeSize, replacement)
  editor.view.dispatch(tr)
  focusNearPos(editor, target.pos + 1)
  return true
}
