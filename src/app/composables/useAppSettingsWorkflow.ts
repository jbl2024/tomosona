/**
 * Module: useAppSettingsWorkflow
 *
 * Purpose:
 * - Own the shell-level settings hydration and save-result reactions.
 *
 * Boundary:
 * - The settings modal still owns form editing and IPC writes.
 * - This composable only keeps the follow-up notifications that App.vue
 *   previously handled inline.
 */
import type { WriteAppSettingsResult } from '../../shared/api/apiTypes'

export type UseAppSettingsWorkflowOptions = {
  markIndexOutOfSync?: () => void
  notifySuccess: (message: string) => void
  notifyInfo?: (message: string) => void
  closeSettingsModal: () => void
}

/**
 * Owns the shell's settings hydration and save-result side effects.
 *
 * The modal and IPC transport stay elsewhere; this composable keeps the root
 * shell's responses explicit and easy to test.
 */
export function useAppSettingsWorkflow(options: UseAppSettingsWorkflowOptions) {

  /**
   * Applies the result of a successful settings save to shell state.
   *
   * This keeps the side effects in one place so App.vue does not have to
   * inline the indexing and notification rules.
   */
  function onSettingsSaved(result: WriteAppSettingsResult) {
    options.notifySuccess(`Settings saved at ${result.path}.`)
    options.closeSettingsModal()
  }

  return {
    onSettingsSaved,
  }
}
