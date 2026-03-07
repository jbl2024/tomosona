export type WorkspaceSetupUseCase = 'knowledge-base' | 'journal' | 'projects'
export type WorkspaceSetupOption =
  | 'daily-notes'
  | 'inbox'
  | 'projects-folder'
  | 'areas-folder'
  | 'references-folder'

export type WorkspaceSetupEntry = {
  kind: 'folder' | 'file'
  path: string
}

const DEFAULT_OPTIONS: Record<WorkspaceSetupUseCase, WorkspaceSetupOption[]> = {
  'knowledge-base': ['daily-notes', 'inbox', 'projects-folder'],
  journal: ['daily-notes'],
  projects: ['projects-folder', 'references-folder']
}

const STARTER_FILES: Record<WorkspaceSetupUseCase, WorkspaceSetupEntry[]> = {
  'knowledge-base': [
    { kind: 'file', path: 'Inbox.md' },
    { kind: 'file', path: 'Welcome.md' }
  ],
  journal: [
    { kind: 'file', path: 'Today.md' }
  ],
  projects: [
    { kind: 'file', path: 'Project template.md' }
  ]
}

const OPTION_ENTRIES: Record<WorkspaceSetupOption, WorkspaceSetupEntry[]> = {
  'daily-notes': [
    { kind: 'folder', path: 'Daily' },
    { kind: 'folder', path: 'Monthly' }
  ],
  inbox: [
    { kind: 'folder', path: 'Inbox' }
  ],
  'projects-folder': [
    { kind: 'folder', path: 'Projects' }
  ],
  'areas-folder': [
    { kind: 'folder', path: 'Areas' }
  ],
  'references-folder': [
    { kind: 'folder', path: 'References' },
    { kind: 'folder', path: 'Sources' }
  ]
}

/**
 * Returns the recommended default option set for a workspace intent.
 */
export function recommendedOptionsForUseCase(useCase: WorkspaceSetupUseCase): WorkspaceSetupOption[] {
  return [...DEFAULT_OPTIONS[useCase]]
}

/**
 * Builds a deduplicated filesystem plan for the setup wizard review step.
 */
export function buildWorkspaceSetupPlan(
  useCase: WorkspaceSetupUseCase,
  options: WorkspaceSetupOption[]
): WorkspaceSetupEntry[] {
  const selected = new Set(options)
  const plan = new Map<string, WorkspaceSetupEntry>()

  for (const option of selected) {
    for (const entry of OPTION_ENTRIES[option]) {
      plan.set(`${entry.kind}:${entry.path}`, entry)
    }
  }

  for (const entry of STARTER_FILES[useCase]) {
    plan.set(`${entry.kind}:${entry.path}`, entry)
  }

  return Array.from(plan.values()).sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1
    }
    return left.path.localeCompare(right.path)
  })
}
