/**
 * Facade that assembles the three Second Brain workflows into one view model.
 *
 * The view consumes this surface directly so it does not need to know whether a
 * ref comes from session persistence, stream handling, or composer behavior.
 */
import type { ComputedRef, Ref } from 'vue'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import { useSecondBrainConversationRuntime } from './useSecondBrainConversationRuntime'
import { useSecondBrainSessionWorkflow } from './useSecondBrainSessionWorkflow'
import { useSecondBrainStreamRuntime } from './useSecondBrainStreamRuntime'

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
 * Assembles the Second Brain session, stream, and composer workflows.
 *
 * The split keeps each workflow focused while preserving a single object for
 * the render shell to destructure.
 */
export function useSecondBrainViewState(options: UseSecondBrainViewStateOptions) {
  const session = useSecondBrainSessionWorkflow(options)
  const stream = useSecondBrainStreamRuntime({
    workspacePath: options.workspacePath,
    contextPaths: session.contextPaths,
    messages: session.messages,
    streamByMessage: session.streamByMessage,
    sessionId: session.sessionId,
    scrollRequestNonce: session.scrollRequestNonce
  })
  const conversation = useSecondBrainConversationRuntime({
    workspacePath: options.workspacePath,
    allWorkspaceFiles: options.allWorkspaceFiles,
    contextPaths: session.contextPaths,
    messages: session.messages,
    mentionInfo: session.mentionInfo,
    composerContextPaths: session.composerContextPaths,
    sessionId: session.sessionId,
    sessionTitle: session.sessionTitle,
    selectedAlterId: session.selectedAlterId,
    sessionsIndex: session.sessionsIndex,
    requestInFlight: stream.requestInFlight,
    sending: stream.sending,
    sendError: stream.sendError,
    activeAssistantStreamMessageId: stream.activeAssistantStreamMessageId,
    suppressCancellationError: stream.suppressCancellationError,
    displayMessage: stream.displayMessage,
    scrollThreadToBottom: stream.scrollThreadToBottom,
    mergeContextPaths: session.mergeContextPaths,
    replaceContextPaths: session.replaceContextPaths,
    refreshSessionsIndex: session.refreshSessionsIndex,
    requestedPrompt: options.requestedPrompt,
    requestedPromptNonce: options.requestedPromptNonce
  })

  return {
    ...session,
    ...stream,
    ...conversation
  }
}
