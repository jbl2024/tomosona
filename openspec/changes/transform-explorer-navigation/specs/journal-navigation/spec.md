# Journal Navigation

## Purpose

Make daily notes easy to find and optionally organize chronologically while preserving the real file hierarchy.

## ADDED Requirements

### Requirement: Daily note location
The user SHALL be able to declare the journal folder in preferences. Opening today's journal SHALL open or create the daily note according to the journal's year/month/date convention, without overwriting an existing note. Existing workspaces SHALL retain their current default convention unless configured otherwise.

#### Scenario: Open existing daily note
- **WHEN** today's canonical daily note exists
- **THEN** opening today opens that file without creating a duplicate

### Requirement: Optional chronological view
The declared journal SHALL offer tree and chronological views. The chronological view SHALL find valid dated Markdown notes across journal subfolders, group them by month and year in reverse chronological order, identify today’s entry as such, and open the corresponding real files without moving them.

#### Scenario: Today in the timeline
- **WHEN** a dated entry corresponds to the user's current local date
- **THEN** the chronological view identifies it as today

#### Scenario: Duplicate date in different locations
- **WHEN** two journal files have the same date
- **THEN** both are shown with enough path information to distinguish them

#### Scenario: Invalid or undated files
- **WHEN** a filename is not a valid calendar date in the daily-note format
- **THEN** it is not misrepresented as a dated entry and remains accessible in the tree

### Requirement: Explicit journal organization
The user SHALL be able to preview a proposed move of dispersed dated notes into the configured year/month hierarchy before confirming. The preview SHALL show source, destination and collisions; cancellation SHALL change nothing. Execution SHALL use the same reference safety, conflict handling and undo guarantees as other moves.

#### Scenario: Collision on same date
- **WHEN** a destination already contains a note for the same date
- **THEN** the collision is identified before execution and no existing note is silently overwritten
