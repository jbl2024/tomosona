# Echoes

Design Specification  
Local-First Knowledge Environment  
(Tauri 2 + Vue 3)

## 1. Purpose

This document defines **Echoes**, a contextual assistance feature for Tomosona.

Echoes automatically composes a small, relevant, and explainable working context
around what the user is doing now.

It is not a new storage model.  
It is not an autonomous agent.  
It is not automatic vault/workspace restructuring.

It is a lightweight contextual layer that reduces the cognitive cost of
reconstructing a topic across multiple notes.

## 2. Product Definition

### 2.1 One-line definition

Echoes automatically brings the most relevant subset of the workspace back into
view for the action the user is currently taking.

### 2.2 Product value

The value of Echoes is not "semantic links exist".

The value is:

- less manual note hunting,
- less forgotten context,
- less context switching,
- better continuity when resuming work,
- better AI interactions because relevant context is preassembled.

### 2.3 Naming

User-facing name:

- **Echoes**

Functional description:

- automatic context packs

Rationale:

- "Echoes" is shorter, more distinctive, and more product-like than "Auto Context Packs".
- "Auto Context Packs" remains useful as an internal descriptive label for implementation and discussion.

## 3. Core Principles

### 3.1 Context, not structure

Echoes creates a temporary working context. It does not replace folders, tags,
properties, wikilinks, or intentional note structure.

### 3.2 Suggest, never force

Echoes proposes a context. The user can ignore it, trim it, or extend it.

### 3.3 Small and actionable

Echoes must remain short. The goal is not exhaustive retrieval. The goal is to
surface the few items that are most useful right now.

### 3.4 Explainable enough

Each suggested item must carry a short human-readable reason.

Examples:

- `Direct link`
- `Semantically related`
- `Recently active`
- `Same project`

The user does not need a full ranking model explanation.

### 3.5 Ephemeral by default

An Echoes pack is computed for the current action. It is not a persistent vault
object.

### 3.6 Local-first

Echoes must rely on local workspace data and existing local indexes. It must not
require a cloud service.

## 4. Scope

### 4.1 MVP entry points

Echoes v1 should activate in only two situations:

1. when a user opens a note,
2. when a user starts or uses a Second Brain session from a note or workspace context.

### 4.2 Post-MVP entry points

Future extensions may add Echoes to:

- search result flows,
- draft writing flows,
- command palette actions,
- project/folder dashboard views.

## 5. What an Echoes Pack Contains

An Echoes pack is a temporary, scored selection of relevant workspace items
associated with a current anchor.

In v1, pack items are markdown notes only.

Later versions may include:

- Second Brain sessions,
- saved summaries,
- decisions,
- open questions,
- tasks,
- draft artifacts.

## 6. Anchor Types

Echoes starts from a single anchor.

Supported anchor types:

- open note,
- active Second Brain session,
- explicitly selected note when launching AI.

Future anchor types:

- search query,
- draft buffer,
- folder or project surface.

## 7. Signal Sources

Echoes should compose a pack from multiple signals rather than from semantic
similarity alone.

### 7.1 MVP signals

- explicit wikilinks from the anchor note,
- backlinks to the anchor note,
- semantic neighbors of the anchor note,
- recent activity signals related to the same local area of work.

### 7.2 Later signals

- shared frontmatter properties,
- same folder or project grouping,
- notes frequently opened together,
- notes recently sent together to Second Brain,
- pinned or manually promoted notes,
- contradiction or alternative-position signals.

## 8. Ranking Model

### 8.1 Product requirement

Ranking must be:

- simple,
- predictable,
- diverse,
- tunable,
- robust when some signals are missing.

### 8.2 MVP composition strategy

Echoes v1 should use a bounded, diversity-first selection strategy instead of a
complex learned ranker.

Recommended default pack:

- up to `2` direct-link items,
- up to `2` semantic-neighbor items,
- up to `1` recent-activity item,
- hard cap of `5` items by default,
- optional expanded cap of `8` items.

### 8.3 Diversity rule

The pack should not be dominated by a single signal family.

Examples:

- do not return five nearly identical semantic neighbors,
- do not return only recent notes from one folder,
- prefer a slightly less relevant but distinct item over a duplicate-shaped one.

### 8.4 Confidence rule

If the system has weak evidence, Echoes should show fewer items, not more.

Low-confidence behavior is acceptable. Noisy overproduction is not.

## 9. User Experience

### 9.1 Note open flow

When a note opens, Tomosona computes a small Echoes pack and shows it near the
current working surface.

Each item should show:

- note title,
- compact path or parent location,
- one short reason,
- quick action to open,
- quick action to add to AI context when relevant.

### 9.2 Second Brain flow

When a user opens or starts a Second Brain session, Tomosona should prepare a
recommended context pack based on:

- the current note if one exists,
- the session context if one already exists,
- the Echoes signals around the current anchor.

The UI must clearly distinguish:

- **Suggested by Echoes**
- **Actually included in current AI context**

The user must be able to add or remove suggested items before sending.

### 9.3 Interaction model

For each Echoes item, v1 should support:

- `Open`
- `Add to context` or `Remove from context` in Second Brain surfaces
- `Dismiss`

Dismissal in v1 may be session-local only.

### 9.4 Visibility

Echoes should be visible but not dominant.

It should behave like an assistive layer, not a modal interruption.

## 10. Non-Goals

Echoes v1 does not:

- replace manual organization,
- rewrite, merge, rename, or move notes,
- create persistent links automatically,
- guarantee complete context,
- auto-send context to an LLM without user control,
- expose a complex scoring debugger in the main UI.

## 11. UX Copy Guidance

Echoes should use short, calm, operational language.

Recommended reason labels:

- `Direct link`
- `Backlink`
- `Semantically related`
- `Recently active`
- `Same project`

Avoid:

- confidence percentages in the main UI,
- opaque labels such as `Ranked #3`,
- verbose technical explanations.

## 12. Functional Requirements

### 12.1 Echoes service contract

The runtime should expose a typed backend/front-end boundary for:

- computing a pack from an anchor,
- returning scored items with short reason labels,
- returning signal metadata for telemetry and tuning,
- handling partial-signal fallback safely.

### 12.2 Pack item shape

Each item should include:

- stable workspace-relative path,
- display title,
- item kind,
- primary reason label,
- optional secondary reason labels,
- aggregate score,
- source signal set.

### 12.3 Failure behavior

If semantic signals are unavailable, Echoes should still work with explicit-link
and recent-activity signals.

If all signals are weak or unavailable, the UI should show no pack rather than a
low-quality filler list.

## 13. MVP Implementation Plan

### 13.1 Backend

Add an Echoes composition layer that reuses existing local data:

- wikilink graph,
- backlinks index,
- semantic neighbors,
- recent note activity metadata.

The backend should return a compact, deterministic payload.

### 13.2 Frontend

Add two v1 surfaces:

1. note-level Echoes panel or section,
2. Second Brain suggested-context section.

The first version should prioritize clarity over density.

### 13.3 Data reuse

Echoes should prefer existing indexes and existing note metadata before adding
new persistence layers.

### 13.4 Persistence

Echoes packs themselves should not be stored as durable vault entities.

User overrides may later justify lightweight ephemeral memory, but this is not
required in v1.

## 14. Success Criteria

Echoes is successful if users:

- open fewer "just in case" tabs,
- click suggested context items regularly,
- use Second Brain with less manual context assembly,
- recover interrupted project context faster,
- report that Tomosona feels aware of the current subject without feeling intrusive.

Primary product success is behavioral, not algorithmic.

## 15. Risks

### 15.1 Noise risk

If Echoes returns too many weak items, it becomes another sidebar users ignore.

### 15.2 Black-box risk

If suggestions are not understandable, users will not trust them.

### 15.3 Over-automation risk

If Echoes acts like an autonomous system instead of a controlled assistant, it
will create friction.

### 15.4 Scope risk

If v1 attempts to include search, drafting, AI, contradictions, tasks, and
workspace memory together, the feature will become too diffuse to validate.

## 16. Recommended v1 Decision

Ship Echoes v1 with:

- note-open support,
- Second Brain suggested-context support,
- direct links,
- backlinks,
- semantic neighbors,
- recent activity signal,
- short reason labels,
- add/remove/open actions,
- strict pack size cap.

Do not ship v1 with:

- persistent pack entities,
- advanced user tuning UI,
- automatic vault modifications,
- search integration,
- contradiction detection,
- multi-object packs beyond markdown notes.

## 17. Summary

Echoes is not a smarter backlinks panel.

It is a contextual assistance layer that automatically reconstructs a compact,
actionable working set around the user's current topic.

Its job is simple:

bring the right parts of the knowledge space back into view at the right moment,
with enough explanation and enough user control to remain trustworthy.
