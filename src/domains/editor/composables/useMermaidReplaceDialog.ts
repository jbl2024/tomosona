import { ref } from 'vue'

/**
 * useMermaidReplaceDialog
 *
 * Owns the asynchronous confirmation dialog state used by Mermaid templates when
 * they are about to replace an existing diagram block.
 */

/**
 * Dialog state for mermaid template replacement confirmation.
 */
export type MermaidReplaceDialogState = {
  visible: boolean
  templateLabel: string
  resolve: ((approved: boolean) => void) | null
}

export function useMermaidReplaceDialog() {
  const mermaidReplaceDialog = ref<MermaidReplaceDialogState>({
    visible: false,
    templateLabel: '',
    resolve: null
  })

  /**
   * Resolves the currently pending confirmation and resets dialog state.
   */
  function resolveMermaidReplaceDialog(approved: boolean) {
    const resolver = mermaidReplaceDialog.value.resolve
    mermaidReplaceDialog.value = {
      visible: false,
      templateLabel: '',
      resolve: null
    }
    resolver?.(approved)
  }

  /**
   * Opens a confirmation dialog and returns a promise resolved by user choice.
   */
  function requestMermaidReplaceConfirm(payload: { templateLabel: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Touchy: if multiple confirmations race, fail older one first.
      if (mermaidReplaceDialog.value.resolve) {
        mermaidReplaceDialog.value.resolve(false)
      }
      mermaidReplaceDialog.value = {
        visible: true,
        templateLabel: payload.templateLabel,
        resolve
      }
    })
  }

  return {
    mermaidReplaceDialog,
    resolveMermaidReplaceDialog,
    requestMermaidReplaceConfirm
  }
}
