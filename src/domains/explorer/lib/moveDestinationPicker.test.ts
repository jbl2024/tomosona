import { describe, expect, it } from 'vitest'
import { filterMoveDestinations, listMoveDestinations } from './moveDestinationPicker'

const parentOf = (path: string) => {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

const input = {
  root: '/vault',
  folders: ['/vault', '/vault/notes', '/vault/notes/deep', '/vault/projects', '/vault/archive'],
  sources: ['/vault/notes/deep'],
  recentDestinations: ['/vault/projects'],
  parentOf
}

describe('move destination picker', () => {
  it('lists the root first, then recent destinations, then folders alphabetically', () => {
    const destinations = listMoveDestinations(input)
    expect(destinations.map((destination) => destination.label)).toEqual([
      'Workspace root',
      'projects',
      'archive',
      'notes',
      'notes/deep'
    ])
  })

  it('disables the source itself, its descendants and the shared current parent with reasons', () => {
    const destinations = listMoveDestinations(input)
    const byPath = new Map(destinations.map((destination) => [destination.path, destination]))

    expect(byPath.get('/vault/notes/deep')).toMatchObject({ disabled: true, reason: 'This folder is part of the selection' })
    // The parent of the moved folder is a no-op destination.
    expect(byPath.get('/vault/notes')).toMatchObject({ disabled: true, reason: 'Already in this folder' })
    expect(byPath.get('/vault/projects')).toMatchObject({ disabled: false })
    expect(byPath.get('/vault')).toMatchObject({ disabled: false, label: 'Workspace root' })
  })

  it('disables descendants of a moved folder', () => {
    const destinations = listMoveDestinations({
      ...input,
      sources: ['/vault/notes'],
      recentDestinations: []
    })
    const byPath = new Map(destinations.map((destination) => [destination.path, destination]))
    expect(byPath.get('/vault/notes/deep')).toMatchObject({ disabled: true, reason: 'Inside a moved folder' })
    expect(byPath.get('/vault/notes')).toMatchObject({ disabled: true, reason: 'This folder is part of the selection' })
    expect(byPath.get('/vault/projects')).toMatchObject({ disabled: false })
  })

  it('disables the root when the root itself is selected', () => {
    const destinations = listMoveDestinations({ ...input, sources: ['/vault'], recentDestinations: [] })
    expect(destinations[0]).toMatchObject({ path: '/vault', disabled: true, reason: 'The workspace root cannot be moved' })
  })

  it('filters by query on the label', () => {
    const destinations = listMoveDestinations(input)
    expect(filterMoveDestinations(destinations, 'proj').map((d) => d.label)).toEqual(['projects'])
    expect(filterMoveDestinations(destinations, '')).toHaveLength(destinations.length)
  })
})
