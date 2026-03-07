import { describe, expect, it } from 'vitest'
import { useMermaidReplaceDialog } from './useMermaidReplaceDialog'

describe('useMermaidReplaceDialog', () => {
  it('opens dialog and resolves confirmation result', async () => {
    const dialog = useMermaidReplaceDialog()

    const pending = dialog.requestMermaidReplaceConfirm({ templateLabel: 'Flow' })

    expect(dialog.mermaidReplaceDialog.value.visible).toBe(true)
    expect(dialog.mermaidReplaceDialog.value.templateLabel).toBe('Flow')

    dialog.resolveMermaidReplaceDialog(true)

    await expect(pending).resolves.toBe(true)
    expect(dialog.mermaidReplaceDialog.value.visible).toBe(false)
  })

  it('rejects previous pending confirmation when a new one starts', async () => {
    const dialog = useMermaidReplaceDialog()

    const first = dialog.requestMermaidReplaceConfirm({ templateLabel: 'First' })
    const second = dialog.requestMermaidReplaceConfirm({ templateLabel: 'Second' })

    await expect(first).resolves.toBe(false)
    expect(dialog.mermaidReplaceDialog.value.templateLabel).toBe('Second')

    dialog.resolveMermaidReplaceDialog(true)
    await expect(second).resolves.toBe(true)
  })
})
