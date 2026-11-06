import { describe, expect, it } from 'vitest'
import { presetScope, sessionPreset } from '../src/host/scope.ts'
import { readChildPreset, readOwnModel, readPresets } from '../src/shared/settings.ts'
import type { AgentPresetsLike, SessionLike, SessionProjectionsLike } from '../src/host/types.ts'
import { parentAgent } from './helpers.ts'

const session = (id: string): SessionLike => parentAgent(id, '/').session

/** A preset registry over fixed session presets, the way newer hosts have it. */
const registry = (presets: Record<string, string | null>): AgentPresetsLike => ({
  presetForSession: target => presets[target.id] ?? null,
})

/** The projection registry over fixed session presets. */
const projections = (presets: Record<string, string | null>): SessionProjectionsLike => ({
  stateOf: (target, key) => key === 'agentPreset' ? presets[target.id] ?? null : undefined,
})

/** Sources with a newer host's registry method. */
const current = (presets: Record<string, string | null>) => ({
  agentPresets: () => registry(presets),
  sessionProjections: () => { throw new Error('read the deprecated projection') },
})

/** Sources like 0.2.1-rc.5: the registry exists without the method. */
const rc5 = (presets: Record<string, string | null>) => ({
  agentPresets: (): AgentPresetsLike => ({}),
  sessionProjections: () => projections(presets),
})

describe('readPresets', () => {
  it('keeps non-empty strings once, in their stored order', () => {
    expect(readPresets(['dsh-assisstant', '', 'standard', 'dsh-assisstant', 3, null])).toEqual(['dsh-assisstant', 'standard'])
    expect(readPresets(undefined)).toEqual([])
    expect(readPresets('dsh-assisstant')).toEqual([])
  })
})

describe('readChildPreset', () => {
  it('keeps a non-blank preset id and reads anything else as none', () => {
    expect(readChildPreset(' dsh-assisstant-worker ')).toBe('dsh-assisstant-worker')
    expect(readChildPreset('')).toBeUndefined()
    expect(readChildPreset('  ')).toBeUndefined()
    expect(readChildPreset(undefined)).toBeUndefined()
    expect(readChildPreset(['dsh-assisstant-worker'])).toBeUndefined()
  })
})

describe('readOwnModel', () => {
  it('is on unless the field says false', () => {
    expect(readOwnModel(false)).toBe(false)
    expect(readOwnModel(true)).toBe(true)
    expect(readOwnModel(undefined)).toBe(true)
    expect(readOwnModel('false')).toBe(true)
  })
})

describe('sessionPreset', () => {
  it('uses the registry method when the host has it, and never the deprecated projection', () => {
    expect(sessionPreset(session('a'), current({ a: 'dsh-assisstant' }))).toBe('dsh-assisstant')
  })

  it('reads the projection when the registry has no such method', () => {
    expect(sessionPreset(session('a'), rc5({ a: 'dsh-assisstant' }))).toBe('dsh-assisstant')
  })

  it('reads the projection when there is no registry at all', () => {
    expect(sessionPreset(session('a'), { agentPresets: () => undefined, sessionProjections: () => projections({ a: 'x' }) })).toBe('x')
  })

  it('reads a session without a recorded preset as undefined on every host', () => {
    expect(sessionPreset(session('a'), current({ a: null }))).toBeUndefined()
    expect(sessionPreset(session('a'), rc5({ a: null }))).toBeUndefined()
    expect(sessionPreset(session('a'), { agentPresets: () => undefined, sessionProjections: () => undefined })).toBeUndefined()
  })

  it('calls the registry method on the registry', () => {
    class Registry implements AgentPresetsLike {
      private readonly preset = 'dsh-assisstant'
      presetForSession(): string { return this.preset }
    }
    expect(sessionPreset(session('a'), { agentPresets: () => new Registry(), sessionProjections: () => undefined })).toBe('dsh-assisstant')
  })
})

describe('presetScope', () => {
  it('serves every session when no preset is listed, without reading anything', () => {
    const fail = () => { throw new Error('read a preset') }
    const serves = presetScope([], { agentPresets: fail, sessionProjections: fail })
    expect(serves(session('a'))).toBe(true)
  })

  for (const [host, sources] of [['newer hosts', current], ['0.2.1-rc.5', rc5]] as const) {
    it(`serves only sessions that run a listed preset on ${host}`, () => {
      const serves = presetScope(['dsh-assisstant'], sources({ a: 'dsh-assisstant', b: 'standard', c: null }))
      expect(serves(session('a'))).toBe(true)
      expect(serves(session('b'))).toBe(false)
      expect(serves(session('c'))).toBe(false)
    })
  }

  it('serves nothing when the preset cannot be read', () => {
    const none = { agentPresets: () => undefined, sessionProjections: () => undefined }
    expect(presetScope(['dsh-assisstant'], none)(session('a'))).toBe(false)
    const broken: AgentPresetsLike = { presetForSession: () => { throw new Error('no projection') } }
    expect(presetScope(['dsh-assisstant'], { ...none, agentPresets: () => broken })(session('a'))).toBe(false)
    const brokenProjection: SessionProjectionsLike = { stateOf: () => { throw new Error('no projection') } }
    expect(presetScope(['dsh-assisstant'], { ...none, sessionProjections: () => brokenProjection })(session('a'))).toBe(false)
  })
})
