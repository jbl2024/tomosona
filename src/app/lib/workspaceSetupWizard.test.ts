import { describe, expect, it } from 'vitest'
import { buildWorkspaceSetupPlan, recommendedOptionsForUseCase } from './workspaceSetupWizard'

describe('workspaceSetupWizard', () => {
  it('returns default options for each use case', () => {
    expect(recommendedOptionsForUseCase('knowledge-base')).toEqual(['daily-notes', 'inbox', 'projects-folder'])
    expect(recommendedOptionsForUseCase('journal')).toEqual(['daily-notes'])
  })

  it('builds a deduplicated plan with folders first', () => {
    const plan = buildWorkspaceSetupPlan('projects', ['projects-folder', 'references-folder', 'projects-folder'])

    expect(plan).toEqual([
      { kind: 'folder', path: 'Projects' },
      { kind: 'folder', path: 'References' },
      { kind: 'folder', path: 'Sources' },
      { kind: 'file', path: 'Project template.md' }
    ])
  })
})
