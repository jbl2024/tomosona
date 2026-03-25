import type { ComputedRef, Ref } from 'vue'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import { useSecondBrainConversationRuntime } from './useSecondBrainConversationRuntime'
import { useSecondBrainSessionWorkflow } from './useSecondBrainSessionWorkflow'

export type UseSecondBrainViewStateOptions = {
  workspacePath: Ref<string>
  allWorkspaceFiles: Ref<string[]>
  requestedSessionId: Ref<string>
  requestedSessionNonce: Ref<number>
  requestedPrompt: Ref<string>
  requestedPromptNonce: Ref<number>
  requestedAlterId: Ref<string>
  requestedAlterNonce: Ref<number>
  echoesRefreshToken: Ref<number>
  settings: ComputedRef<AppSettingsAlters>
  emitContextChanged: (paths: string[]) => void
  emitSessionChanged: (sessionId: string) => void
  emitOpenNote: (path: string) => void
}

/**
 * Facade for the Second Brain view state.
 *
 * The session workflow owns session/context persistence, while the conversation
 * runtime owns composition, streaming, copy, and Pulse affordances. The view
 * binds the returned refs directly and stays a render shell.
 */
export function useSecondBrainViewState(options: UseSecondBrainViewStateOptions) {
  const session = useSecondBrainSessionWorkflow(options)
  const conversation = useSecondBrainConversationRuntime({
    workspacePath: options.workspacePath,
    allWorkspaceFiles: options.allWorkspaceFiles,
    contextPaths: session.contextPaths,
    messages: session.messages,
    streamByMessage: session.streamByMessage,
    mentionInfo: session.mentionInfo,
    composerContextPaths: session.composerContextPaths,
    sessionId: session.sessionId,
    sessionTitle: session.sessionTitle,
    selectedAlterId: session.selectedAlterId,
    sessionsIndex: session.sessionsIndex,
    scrollRequestNonce: session.scrollRequestNonce,
    mergeContextPaths: session.mergeContextPaths,
    replaceContextPaths: session.replaceContextPaths,
    refreshSessionsIndex: session.refreshSessionsIndex,
    requestedPrompt: options.requestedPrompt,
    requestedPromptNonce: options.requestedPromptNonce
  })

  return {
    ...session,
    ...conversation
  }
}
