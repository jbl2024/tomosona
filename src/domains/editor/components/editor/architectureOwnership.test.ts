import { describe, expect, it } from 'vitest'
import editorViewSource from '../EditorView.vue?raw'
import blockControlsSource from '../../composables/useBlockMenuControls.ts?raw'
import tableControlsSource from '../../composables/useTableToolbarControls.ts?raw'
import fileLifecycleSource from '../../composables/useEditorFileLifecycle.ts?raw'
import architectureDoc from './ARCHITECTURE.md?raw'

describe('editor architecture ownership guardrails', () => {
  it('keeps lifecycle/table/block ownership composables wired in EditorView', () => {
    expect(editorViewSource).toContain('useEditorSessionLifecycle')
    expect(editorViewSource).toContain('useBlockMenuControls')
    expect(editorViewSource).toContain('useTableToolbarControls')
    expect(editorViewSource).not.toContain('pathLoadToken')
    expect(editorViewSource).not.toContain('tableEdgeTopSeenAt')
  })

  it('avoids no-op overlay forwarding and mega overlay component', () => {
    expect(editorViewSource).not.toContain('EditorFloatingOverlays')
    expect(editorViewSource).not.toContain('@menu-el="() => {}"')
    expect(editorViewSource).not.toContain('useEditorPersistence')
    expect(editorViewSource).not.toContain('useWikilinkMenu')
  })

  it('keeps editor hot logic extracted from EditorView', () => {
    expect(editorViewSource).toContain('useEditorTiptapSetup')
    expect(editorViewSource).toContain('useEditorWikilinkOverlayState')
    expect(editorViewSource).toContain('useEditorWikilinkDataSource')
    expect(editorViewSource).toContain('useEditorSlashInsertion')
    expect(editorViewSource).toContain('useEditorTableInteractions')
    expect(editorViewSource).toContain('useEditorPathWatchers')
    expect(editorViewSource).toContain('useEditorMountedSessions')
    expect(editorViewSource).toContain('useEditorBlockHandleControls')
    expect(editorViewSource).toContain('useEditorVirtualTitleDocument')
    expect(editorViewSource).not.toContain('function createEditorOptions(')
    expect(editorViewSource).not.toContain('function syncWikilinkUiFromPluginState(')
    expect(editorViewSource).not.toContain('function applyWikilinkCandidateToken(')
    expect(editorViewSource).not.toContain('function closeBlockMenu(')
    expect(editorViewSource).not.toContain('function toggleBlockMenu(')
    expect(editorViewSource).not.toContain('function onBlockHandleNodeChange(')
    expect(editorViewSource).not.toContain('function extractPlainText(')
    expect(editorViewSource).not.toContain('function withVirtualTitle(')
    expect(editorViewSource).not.toContain('function loadWikilinkTargets(')
    expect(editorViewSource).not.toContain('function loadWikilinkHeadings(')
    expect(editorViewSource).not.toContain('switch (type)')
    expect(editorViewSource).not.toContain('function onEditorMouseMove(')
  })

  it('keeps multi-instance editor content rendering wired by session path', () => {
    expect(editorViewSource).toContain('v-for="sessionPath in renderPaths"')
    expect(editorViewSource).toContain('editor-content:${sessionPath}')
    expect(editorViewSource).not.toContain('editor-content:${currentPath}')
  })

  it('kept composables avoid computed side-effect pattern', () => {
    expect(blockControlsSource).not.toMatch(/computed\([^)]*=>\s*\{[^}]*\.value\s*=/s)
    expect(tableControlsSource).not.toMatch(/computed\([^)]*=>\s*\{[^}]*\.value\s*=/s)
  })

  it('documents ownership map and anti-patterns', () => {
    expect(architectureDoc).toContain('Ownership Map')
    expect(architectureDoc).toContain('Anti-patterns')
    expect(architectureDoc).toContain('useEditorSessionLifecycle')
    expect(architectureDoc).toContain('useEditorFileLifecycle')
    expect(architectureDoc).toContain('renderStabilizer')
  })

  it('uses grouped ports in file lifecycle and removes dead load options', () => {
    expect(fileLifecycleSource).toContain('sessionPort')
    expect(fileLifecycleSource).toContain('documentPort')
    expect(fileLifecycleSource).toContain('uiPort')
    expect(fileLifecycleSource).toContain('ioPort')
    expect(fileLifecycleSource).toContain('requestPort')
    expect(fileLifecycleSource).toContain('waitForHeavyRenderIdle')
    expect(fileLifecycleSource).toContain('hasPendingHeavyRender')
    expect(fileLifecycleSource).not.toContain('skipActivate')
  })

  it('keeps heavy render coordination out of EditorView and in lifecycle/stabilizer modules', () => {
    expect(editorViewSource).toContain('waitForHeavyRenderIdle')
    expect(editorViewSource).not.toContain('beginHeavyRender(')
    expect(editorViewSource).not.toContain('endHeavyRender(')
    expect(fileLifecycleSource).toContain('isHeavyRenderMarkdown')
  })
})
