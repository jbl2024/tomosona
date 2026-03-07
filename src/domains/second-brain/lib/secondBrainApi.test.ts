import { describe, expect, it } from 'vitest'
import { parseMessageCitations } from './secondBrainApi'
import type { SecondBrainMessage } from '../../../shared/api/apiTypes'

function message(citationsJson: string): SecondBrainMessage {
  return {
    id: 'm1',
    role: 'assistant',
    mode: 'freestyle',
    content_md: 'x',
    citations_json: citationsJson,
    attachments_json: '[]',
    created_at_ms: 0
  }
}

describe('parseMessageCitations', () => {
  it('parses valid array payload', () => {
    expect(parseMessageCitations(message('["a.md","b.md"]'))).toEqual(['a.md', 'b.md'])
  })

  it('returns empty on invalid json', () => {
    expect(parseMessageCitations(message('{'))).toEqual([])
  })

  it('filters non-string entries', () => {
    expect(parseMessageCitations(message('[1,"a",null]'))).toEqual(['a'])
  })
})
