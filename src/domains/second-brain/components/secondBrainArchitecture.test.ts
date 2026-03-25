import { describe, expect, it } from 'vitest'
import secondBrainViewSource from './SecondBrainView.vue?raw'
import architectureDoc from './ARCHITECTURE.md?raw'

describe('second brain architecture guardrails', () => {
  it('keeps the view as a render shell over the domain composable', () => {
    expect(secondBrainViewSource).toContain('useSecondBrainViewState')
    expect(secondBrainViewSource).not.toContain('runDeliberation')
    expect(secondBrainViewSource).not.toContain('replaceSessionContext')
    expect(secondBrainViewSource).not.toContain('fetchSecondBrainSessions')
    expect(secondBrainViewSource).not.toContain('fetchSecondBrainConfigStatus')
    expect(secondBrainViewSource).not.toContain('subscribeSecondBrainStream')
    expect(secondBrainViewSource).not.toContain('readTextFile')
    expect(secondBrainViewSource).not.toContain('writeClipboardText')
  })

  it('documents the composable-owned orchestration boundary', () => {
    expect(architectureDoc).toContain('useSecondBrainViewState.ts')
    expect(architectureDoc).toContain('useSecondBrainSessionWorkflow.ts')
    expect(architectureDoc).toContain('useSecondBrainConversationRuntime.ts')
    expect(architectureDoc).toContain('render shell')
    expect(architectureDoc).toContain('Do not reintroduce direct backend API calls')
  })
})
