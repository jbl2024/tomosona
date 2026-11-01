/**
 * Module: noteReferencePlan
 *
 * Purpose:
 * - Plan and apply reference rewrites for one note's content after proposed
 *   path moves, using the shared resolution semantics from noteLinkResolution.
 *
 * Boundaries:
 * - Read-only planning: planContentReferenceImpact never touches files.
 * - Uncertain references become warnings and are never rewritten silently;
 *   callers decide whether to warn, ask for confirmation or cancel.
 * - applyContentReferencePlan only replaces the exact spans reported by the
 *   plan, preserving labels, aliases, fragments and surrounding syntax.
 */

import { extractNoteReferences } from './noteReferences'
import { planNoteReferenceImpact, type NoteReferenceImpactInput } from './noteReferenceImpact'

/** A reference that cannot be updated safely and must be surfaced to the user. */
export type ContentReferenceWarning = {
  kind: 'wikilink' | 'markdown'
  target: string
  reason: 'ambiguous_paths' | 'unresolved_target' | 'unsupported_target'
}

/** One target span to replace inside the original content. */
export type ContentReferenceRewrite = {
  start: number
  end: number
  replacement: string
}

/** Planned outcome for one note content: safe rewrites plus explicit warnings. */
export type ContentReferencePlan = {
  rewrites: ContentReferenceRewrite[]
  warnings: ContentReferenceWarning[]
}

/** Planning inputs shared by every reference found in the content. */
export type ContentReferencePlanInput = Omit<NoteReferenceImpactInput, 'kind' | 'target'>

/**
 * Plans how each reference in the content should change for the given moves.
 *
 * References that still resolve to the moved destination are left untouched;
 * resolvable ones are collected as rewrites; ambiguous, unresolved or
 * unsupported ones are collected as warnings.
 */
export function planContentReferenceImpact(content: string, input: ContentReferencePlanInput): ContentReferencePlan {
  const rewrites: ContentReferenceRewrite[] = []
  const warnings: ContentReferenceWarning[] = []

  for (const reference of extractNoteReferences(content)) {
    const impact = planNoteReferenceImpact({ ...input, kind: reference.kind, target: reference.target })
    if (impact.kind === 'rewrite') {
      rewrites.push({ start: reference.start, end: reference.end, replacement: impact.target })
    } else if (impact.kind === 'uncertain') {
      warnings.push({ kind: reference.kind, target: reference.target, reason: impact.reason })
    }
  }

  return { rewrites, warnings }
}

/**
 * Applies a plan to the original content, replacing rewrite spans from the
 * end backwards so earlier offsets stay valid. Warning spans are untouched.
 */
export function applyContentReferencePlan(content: string, plan: ContentReferencePlan): string {
  let result = String(content ?? '')
  const ordered = [...plan.rewrites].sort((left, right) => right.start - left.start)
  for (const rewrite of ordered) {
    result = result.slice(0, rewrite.start) + rewrite.replacement + result.slice(rewrite.end)
  }
  return result
}
