import { describe, expect, it } from 'vitest'
import {
  buildHomeHistorySnapshot,
  buildSecondBrainHistorySnapshot,
  homeHistoryLabel,
  homeSnapshotStateKey,
  readHomeHistorySnapshot,
  readSecondBrainHistorySnapshot,
  secondBrainHistoryLabel,
  secondBrainSnapshotStateKey
} from './appNavigationHistory'

describe('appNavigationHistory', () => {

  it('reads and labels home and second brain snapshots', () => {
    expect(readHomeHistorySnapshot({ surface: 'hub' })).toEqual({ surface: 'hub' })
    expect(readHomeHistorySnapshot({ surface: 'other' })).toBeNull()
    expect(buildHomeHistorySnapshot()).toEqual({ surface: 'hub' })
    expect(homeSnapshotStateKey({ surface: 'hub' })).toBe('hub')
    expect(homeHistoryLabel({ surface: 'hub' })).toBe('Home')

    expect(readSecondBrainHistorySnapshot({ surface: 'chat' })).toEqual({ surface: 'chat' })
    expect(readSecondBrainHistorySnapshot({ surface: 'sessions' })).toBeNull()
    expect(readSecondBrainHistorySnapshot({ surface: 'other' })).toBeNull()
    expect(buildSecondBrainHistorySnapshot()).toEqual({ surface: 'chat' })
    expect(secondBrainSnapshotStateKey({ surface: 'chat' })).toBe('chat')
    expect(secondBrainHistoryLabel({ surface: 'chat' })).toBe('Second Brain')
  })
})
