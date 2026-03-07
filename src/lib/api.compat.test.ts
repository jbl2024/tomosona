import { describe, expect, it } from 'vitest'
import * as api from './api'
import * as indexApi from './indexApi'
import * as pulseIpcApi from './pulseIpcApi'
import * as secondBrainIpcApi from './secondBrainIpcApi'
import * as settingsApi from './settingsApi'
import * as workspaceApi from './workspaceApi'

describe('api compatibility facade', () => {
  it('re-exports workspace commands from the domain module', () => {
    expect(api.selectWorkingFolder).toBe(workspaceApi.selectWorkingFolder)
    expect(api.writeTextFile).toBe(workspaceApi.writeTextFile)
    expect(api.listenWorkspaceFsChanged).toBe(workspaceApi.listenWorkspaceFsChanged)
  })

  it('re-exports indexing commands from the domain module', () => {
    expect(api.ftsSearch).toBe(indexApi.ftsSearch)
    expect(api.computeEchoesPack).toBe(indexApi.computeEchoesPack)
    expect(api.readPropertyTypeSchema).toBe(indexApi.readPropertyTypeSchema)
  })

  it('re-exports settings commands from the domain module', () => {
    expect(api.readAppSettings).toBe(settingsApi.readAppSettings)
    expect(api.discoverCodexModels).toBe(settingsApi.discoverCodexModels)
  })

  it('re-exports second brain commands from the domain module', () => {
    expect(api.readSecondBrainConfigStatus).toBe(secondBrainIpcApi.readSecondBrainConfigStatus)
    expect(api.sendSecondBrainMessage).toBe(secondBrainIpcApi.sendSecondBrainMessage)
  })

  it('re-exports pulse commands from the domain module', () => {
    expect(api.runPulseTransformation).toBe(pulseIpcApi.runPulseTransformation)
    expect(api.listenPulseStream).toBe(pulseIpcApi.listenPulseStream)
  })
})
