import { describe, expect, it } from 'vitest'
import {
  buildCosmosHistorySnapshot,
  buildHomeHistorySnapshot,
  buildSecondBrainHistorySnapshot,
  cosmosHistoryLabel,
  cosmosSnapshotStateKey,
  homeHistoryLabel,
  homeSnapshotStateKey,
  readCosmosHistorySnapshot,
  readHomeHistorySnapshot,
  readSecondBrainHistorySnapshot,
  secondBrainHistoryLabel,
  secondBrainSnapshotStateKey
} from './appNavigationHistory'

describe('appNavigationHistory', () => {
  it('reads and normalizes cosmos snapshots', () => {
    expect(
      readCosmosHistorySnapshot({
        query: '  graph  ',
        selectedNodeId: 'node-1',
        focusMode: true,
        focusDepth: 12
      })
    ).toEqual({
      query: '  graph  ',
      selectedNodeId: 'node-1',
      focusMode: true,
      focusDepth: 8
    })

    expect(readCosmosHistorySnapshot({ query: 'x' })).toBeNull()
  })

  it('builds stable cosmos snapshots and labels', () => {
    const snapshot = buildCosmosHistorySnapshot({
      query: '  graph  ',
      selectedNodeId: 'node-1',
      focusMode: false,
      focusDepth: 3
    })

    expect(snapshot).toEqual({
      query: 'graph',
      selectedNodeId: 'node-1',
      focusMode: false,
      focusDepth: 3
    })
    expect(cosmosSnapshotStateKey(snapshot)).toBe(JSON.stringify(snapshot))
    expect(cosmosHistoryLabel(snapshot, () => null)).toBe('Cosmos: graph')
    expect(cosmosHistoryLabel({ ...snapshot, query: '', selectedNodeId: 'node-1' }, (id) => (id === 'node-1' ? 'Node label' : null))).toBe(
      'Cosmos: Node label'
    )
    expect(cosmosHistoryLabel({ ...snapshot, query: '', selectedNodeId: '' }, () => null)).toBe('Cosmos')
  })

  it('reads and labels home and second brain snapshots', () => {
    expect(readHomeHistorySnapshot({ surface: 'hub' })).toEqual({ surface: 'hub' })
    expect(readHomeHistorySnapshot({ surface: 'other' })).toBeNull()
    expect(buildHomeHistorySnapshot()).toEqual({ surface: 'hub' })
    expect(homeSnapshotStateKey({ surface: 'hub' })).toBe('hub')
    expect(homeHistoryLabel({ surface: 'hub' })).toBe('Home')

    expect(readSecondBrainHistorySnapshot({ surface: 'chat' })).toEqual({ surface: 'chat' })
    expect(readSecondBrainHistorySnapshot({ surface: 'sessions' })).toEqual({ surface: 'chat' })
    expect(readSecondBrainHistorySnapshot({ surface: 'other' })).toBeNull()
    expect(buildSecondBrainHistorySnapshot()).toEqual({ surface: 'chat' })
    expect(secondBrainSnapshotStateKey({ surface: 'chat' })).toBe('chat')
    expect(secondBrainHistoryLabel({ surface: 'chat' })).toBe('Second Brain')
  })
})
