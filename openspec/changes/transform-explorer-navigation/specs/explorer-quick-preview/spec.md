# Explorer Quick Preview

## Purpose

Allow a note to be read briefly from the explorer without changing the user's editing or navigation context.

## ADDED Requirements

### Requirement: Temporary rendered preview
Space on a selected note or its context action SHALL open a temporary read-only rendered Markdown preview with its title, path, open-note and close actions. Opening and closing the preview SHALL NOT change tabs, navigation history, tree selection or scroll position. It SHALL NOT open merely on hover.

#### Scenario: Close and resume
- **WHEN** the user closes a preview with Escape, Space or the close action
- **THEN** focus returns to the selected explorer row and the previous editing context remains unchanged

#### Scenario: Open from preview
- **WHEN** the user chooses open note in the preview
- **THEN** the preview closes and normal note navigation occurs

### Requirement: Respect page protection
Preview SHALL use the existing protected-page access rules: locked content SHALL NOT be displayed; unlocked content SHALL be available for preview in the current session. Preview SHALL NOT persist decrypted content or alter the page.

#### Scenario: Locked protected page
- **WHEN** a preview is requested for a locked protected page
- **THEN** no content is revealed and a clear access explanation is shown

#### Scenario: Unlocked protected page
- **WHEN** a preview is requested for a protected page unlocked in the current session
- **THEN** its decrypted Markdown is rendered read-only without persisting plaintext or changing tabs or history

#### Scenario: Unreadable or removed note
- **WHEN** the note cannot be read or disappears before preview
- **THEN** an actionable error is shown without changing tabs or history
