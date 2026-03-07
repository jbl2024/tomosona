export const CANONICAL_CALLOUT_KINDS = [
  'NOTE',
  'ABSTRACT',
  'INFO',
  'TIP',
  'SUCCESS',
  'QUESTION',
  'WARNING',
  'FAILURE',
  'DANGER',
  'BUG',
  'EXAMPLE',
  'QUOTE'
] as const

export type CanonicalCalloutKind = (typeof CANONICAL_CALLOUT_KINDS)[number]

const ALIAS_TO_KIND: Record<string, CanonicalCalloutKind> = {
  NOTE: 'NOTE',
  ABSTRACT: 'ABSTRACT',
  SUMMARY: 'ABSTRACT',
  TLDR: 'ABSTRACT',
  INFO: 'INFO',
  TODO: 'INFO',
  TIP: 'TIP',
  HINT: 'TIP',
  IMPORTANT: 'TIP',
  SUCCESS: 'SUCCESS',
  CHECK: 'SUCCESS',
  DONE: 'SUCCESS',
  QUESTION: 'QUESTION',
  HELP: 'QUESTION',
  FAQ: 'QUESTION',
  WARNING: 'WARNING',
  CAUTION: 'WARNING',
  ATTENTION: 'WARNING',
  FAILURE: 'FAILURE',
  FAIL: 'FAILURE',
  MISSING: 'FAILURE',
  DANGER: 'DANGER',
  ERROR: 'DANGER',
  BUG: 'BUG',
  EXAMPLE: 'EXAMPLE',
  QUOTE: 'QUOTE',
  CITE: 'QUOTE'
}

export function normalizeCalloutKind(input: string | undefined): CanonicalCalloutKind {
  const token = String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '')

  return ALIAS_TO_KIND[token] ?? 'NOTE'
}

export function calloutKindLabel(kind: CanonicalCalloutKind): string {
  return kind[0] + kind.slice(1).toLowerCase()
}
