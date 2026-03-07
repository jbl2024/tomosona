/**
 * Echoes transport and view-model types.
 *
 * This module keeps Echoes-specific contracts out of generic API helpers so the
 * feature can evolve without turning `api.ts` into a dumping ground.
 */

export type EchoesSignalSource = 'direct' | 'backlink' | 'semantic' | 'recent'

export type EchoesItemDto = {
  path: string
  title: string
  reason_label: string
  reason_labels: string[]
  score: number
  signal_sources: EchoesSignalSource[]
}

export type EchoesPackDto = {
  anchor_path: string
  generated_at_ms: number
  items: EchoesItemDto[]
}

export type EchoesItem = {
  path: string
  title: string
  reasonLabel: string
  reasonLabels: string[]
  score: number
  signalSources: EchoesSignalSource[]
}

export type EchoesPack = {
  anchorPath: string
  generatedAtMs: number
  items: EchoesItem[]
}

/**
 * Normalizes backend Echoes payload casing for frontend usage.
 */
export function toEchoesPack(dto: EchoesPackDto): EchoesPack {
  return {
    anchorPath: dto.anchor_path,
    generatedAtMs: dto.generated_at_ms,
    items: dto.items.map((item) => ({
      path: item.path,
      title: item.title,
      reasonLabel: item.reason_label,
      reasonLabels: item.reason_labels,
      score: item.score,
      signalSources: item.signal_sources
    }))
  }
}
