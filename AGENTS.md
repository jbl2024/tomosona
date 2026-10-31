# AGENTS.md

This file defines repository-wide agent behavior for `tomosona`.

## Scope
- Applies to the entire repository unless a deeper `AGENTS.md` overrides specific rules.

## Project Context
- Desktop app stack: `Tauri 2` + `Rust` backend + `Vue 3` frontend.
- Frontend is in `src`.
- Tauri/Rust code is in `src-tauri`.

## Core Rules
- Keep changes minimal, targeted, and compatible with current behavior unless a behavior change is requested.
- Do not revert unrelated local changes.
- Prefer `rg` and `rg --files` for searching.
- Avoid dependency upgrades unless explicitly requested.

## Engineering Philosophy
- Prefer KISS over cleverness: choose the simplest design that solves the real problem well.
- Keep behavior explicit and local; avoid introducing abstraction layers, indirection, or architectural patterns unless they clearly reduce ongoing complexity.
- Manage complexity proactively: when a file, component, or composable starts coordinating too many concerns, split it along real ownership boundaries.
- Optimize for long-term readability and maintainability, not short-term compression or novelty.
- Preserve existing behavior unless a change in behavior is explicitly requested or required to fix a defect.
- Reuse existing public APIs and patterns before creating new ones.

## Tauri 2 Rules
- For all `#[tauri::command]` functions, error type must satisfy Tauri IPC requirements.
- Use `Result<T, E>` where `E: Into<tauri::ipc::InvokeError>`.
- Keep native/system access in Rust commands, not in the Vue layer.
- Validate and normalize filesystem paths passed from the frontend.
- Return safe error messages suitable for UI display (avoid leaking sensitive paths or secrets).

## Vue 3 Rules
- Use Composition API with `<script setup>` for new or modified components.
- Keep components focused; extract reusable stateful logic into composables.
- Prefer explicit props/events contracts and one-way data flow.
- Keep Tauri `invoke` calls centralized behind typed frontend service wrappers.
- Keep shell/orchestration logic separate from domain logic when a workflow coordinates multiple parts of the app.
- Avoid "misc" composables or cosmetic extractions that only move refs around without owning a clear workflow.

## Editing Standards
- Prefer small, reviewable patches.
- Follow existing naming and code style in touched files.
- Use ASCII unless file content already requires Unicode.
- Add comments only when code intent is not obvious.
- Refactor to reduce complexity when touching dense code paths, but keep the change set incremental and safe.
- Prefer deleting duplicated or obsolete logic over layering new logic on top of it.
- Do not add framework-heavy solutions when a small composable, helper, or typed contract is sufficient.

## Documentation Standards
- Document modules and exported APIs as first-class maintenance surfaces.
- Use TSDoc/JSDoc for exported TypeScript APIs (`export function`, `export type`, `export class`) with concise intent-focused descriptions.
- Add a short module header comment to non-trivial composables, controllers, and helpers that explains purpose, ownership, and boundaries.
- Document exported functions with intent, important side effects, invariants, and notable failure behavior.
- When a workflow coordinates multiple domains or async steps, document the boundary and why the logic lives there.
- For internal/private helpers, add comments only when behavior is non-obvious, stateful, or has side effects/invariants.
- Prefer short "why/invariant" notes over line-by-line narration.
- For regexes that drive behavior, add a short comment with at least one concrete detection example.

## Verification
- Run relevant checks after meaningful changes when feasible.
- Backend changes: run `cargo check` in `src-tauri`.
- Frontend changes: run relevant build/test command for the Vite/Vue app.
- If checks are not run, state that clearly.

## Testing Standards
- Treat automated tests as required design support for non-trivial changes, not optional follow-up work.
- Add or update tests whenever behavior, orchestration, parsing, persistence, or state transitions change.
- Cover both the happy path and edge cases, including failure paths, invalid input, stale state, and regression-prone interactions.
- Prefer focused unit tests for extracted logic and integration tests for user-visible flows across boundaries.
- Keep tests readable and intention-revealing; a future maintainer should understand what behavior is protected and why.
- When extracting logic from a dense file, add dedicated tests for the extracted unit and keep or extend integration coverage for the original workflow.

## Changelog Workflow
- Do not edit `CHANGELOG.md`: it is managed automatically by `make release`, which prepares the changelog entry, version files, tag, and push (see the `pre-release`/`release` targets in the `Makefile`).
- Feature and fix commits must not include changelog modifications.

## Review Priorities
- Prioritize correctness, regressions, and security-sensitive behavior.
- Call out missing tests for changed logic.
- Include precise file references when reporting issues.

## Response Requirements
- Summarize what changed and why.
- Include verification commands and outcomes.
- After each completed change set, provide exactly one suggested commit message.

## Commit Message Requirement
- Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- Required format: `<type>[optional scope]: <short description>`.
- Never co-author commits: do not add a `Co-Authored-By` trailer or any generated-by footer.
- Supported types include: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Use `!` before `:` or add a `BREAKING CHANGE:` footer when applicable.
- Example: `fix(theme): add system-aware light/dark switcher`.
