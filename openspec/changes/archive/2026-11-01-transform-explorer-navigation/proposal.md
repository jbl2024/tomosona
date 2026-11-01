# Proposal

## Why

The explorer exposes files but requires too many steps to find and organize them. It must remain a faithful view of the filesystem while making navigation, reading, and reorganization comfortable even with 500 to 1,000 notes.

## What Changes

- Simplify the toolbar and menus, clarify folder, active-note, selection and protection states, hide `.md` by default, and retain sorting and display options.
- Improve hierarchical local filtering, contextual creation, keyboard navigation, on-demand reveal, and state persistence.
- Provide inline rename, searchable destination and drag-and-drop moves, multiple selection and batch actions, trash and immediate undo, with link safety and synchronized views.
- Add a temporary read-only Markdown preview that respects page protection.
- Add, as the lowest priority, an optional chronological journal view and explicit previewable organization of scattered dated notes.
- Keep the real tree, existing capabilities and a restrained interface; do not duplicate favorites or recent files or add hover previews.

## Capabilities

### New Capabilities

- `explorer-navigation`: tree presentation, filtering, state, keyboard interaction, creation and menus.
- `workspace-organization`: selection, rename, move, deletion, undo and reference integrity.
- `explorer-quick-preview`: temporary note preview without navigation.
- `journal-navigation`: daily opening, chronological view and explicit organization.

### Modified Capabilities

None: the existing `page-protection` and `note-title-heading` guarantees remain applicable.

## Impact

The Vue explorer domain and tests, navigation and editor orchestration, workspace preferences and synchronization, and Rust filesystem, trash and link-resolution commands are affected. Reuse existing APIs and components; native extensions must validate paths and return safe errors. Safe mutations and undo are prerequisites for new organization interactions.
