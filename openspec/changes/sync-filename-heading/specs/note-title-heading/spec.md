# Note Title Heading Specification

## Purpose

Keeps a note's file name, its first level-1 heading, and the editor title field in sync: a first line that merely repeats the file name is treated as the note title instead of duplicated body content, and new notes start with that heading so files stay portable to other markdown tools.

## ADDED Requirements

### Requirement: Hide a first heading that repeats the file name
When the first non-empty line of a note's body (after frontmatter) is a level-1 heading whose text, trimmed, equals the file name without extension, the rich text editor SHALL NOT render that heading in the body. The title field SHALL show that text as the note title.

#### Scenario: Matching first heading is hidden
- **WHEN** a note `My Note.md` whose body starts with `# My Note` is opened in the rich text editor
- **THEN** the heading is not rendered in the body and the title field shows `My Note`

#### Scenario: Non-matching first heading stays visible
- **WHEN** the first body heading text differs from the file name without extension, or the first heading is not level 1
- **THEN** the heading renders as normal body content and the title field still derives from the file name

#### Scenario: Comparison ignores surrounding whitespace
- **WHEN** the first body line is `# My Note ` (trailing space) for `My Note.md`
- **THEN** the comparison is made on trimmed text and the heading is hidden

#### Scenario: Blank lines before the heading still match
- **WHEN** the body of `My Note.md` starts with a blank line (or several) followed by `# My Note`, as is common after frontmatter
- **THEN** the heading is hidden, and the first save normalizes the stored content to a single canonical `# My Note` line (consuming the leading blank lines)

### Requirement: Title edits update the hidden heading
While a note's first heading is hidden, editing the note title SHALL rename the file following the existing title-driven rename flow, and subsequent saves SHALL write the first body line as `# ` followed by the resulting file name without extension.

#### Scenario: Rename rewrites the heading on save
- **WHEN** the title of a note with a hidden heading is edited to `Renamed` and the note is saved
- **THEN** the file is renamed accordingly and its content starts with `# Renamed`

#### Scenario: Sanitized titles self-heal the sync
- **WHEN** a requested title contains characters that are sanitized in the file name (for example `A/B` becoming `A-B.md`)
- **THEN** the stored first line is regenerated from the resulting file name stem (`# A-B`), so the heading stays hidden and the sync holds without requiring a reload

### Requirement: Saves preserve the hidden heading
While a note's heading is hidden, saves made from the rich text editor SHALL regenerate `# <title>` as the first line of the body on disk. Within the rich text editor the heading is derived from the title and MUST NOT be lost by editing, saving, or autosaving the note.

#### Scenario: Body edits keep the first line intact
- **WHEN** body content is edited and saved in a note with a hidden heading
- **THEN** the stored file starts with `# <title>` followed by the edited body

#### Scenario: Opening the saved file elsewhere
- **WHEN** a note with a hidden heading is saved and opened in an external markdown tool
- **THEN** the first line of the file is `# <title>`

### Requirement: New notes are seeded with the title heading
Creating a new empty markdown note SHALL seed its initial content with `# ` followed by the file name without extension as the first line. A new note whose content is only that seeded heading SHALL keep the existing title-only save behavior and not be persisted by autosave.

#### Scenario: New note content
- **WHEN** the user creates a new note named `Fresh Idea.md`
- **THEN** the note starts with `# Fresh Idea` as its first line, hidden from the body, and the title field shows `Fresh Idea`

#### Scenario: Heading-only new note is not auto-persisted
- **WHEN** a newly created note contains only its seeded heading and autosave runs
- **THEN** no file is written to disk, matching the existing behavior for title-only new notes

#### Scenario: Templates are written verbatim
- **WHEN** a new note is created with a selected template
- **THEN** the template content is stored as provided, without seeding or altering its first line

### Requirement: Non-matching notes are untouched by opening
The system SHALL NOT rewrite a note's content merely because it was opened. The heading sync applies only while the match condition holds; when the file name changes outside the editor, the next load SHALL show the stored heading as visible body content.

#### Scenario: External rename ends the sync
- **WHEN** a file `My Note.md` starting with `# My Note` is renamed externally to `Other.md` and reopened in the editor
- **THEN** the stored first line `# My Note` renders as visible body content and the file is not modified

### Requirement: Source mode is verbatim
The heading sync SHALL apply only to the rich text editor. Source mode SHALL display the file exactly as stored, including the first heading, and SHALL save the edited raw text verbatim: the hidden heading is not regenerated by source-mode saves, and the sync re-evaluates on the next rich editor load.

#### Scenario: Source mode display is unaffected
- **WHEN** a note with a hidden heading is viewed in source mode
- **THEN** the raw content is displayed as stored, with the first heading visible

#### Scenario: Deleting the heading in source mode is preserved
- **WHEN** the user deletes the first heading in source mode and saves from source mode
- **THEN** the stored file no longer contains the heading and nothing regenerates it; on the next rich editor load the heading sync is inactive for that note
