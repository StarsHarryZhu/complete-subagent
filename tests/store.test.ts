import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BindingStore, defaultStoreDirectory } from '../src/host/store.ts'
import type { Binding } from '../src/host/store.ts'
import { tempDir } from './helpers.ts'

const binding = (child: string): Binding => ({ version: 1, child, parent: 'p1', workspace: '/w', grants: [] })

describe('defaultStoreDirectory', () => {
  it('follows DSH_HOME, then ~/.dsh', () => {
    expect(defaultStoreDirectory({ DSH_HOME: '/h' })).toBe('/h/plugin-data/complete-subagent/children')
    expect(defaultStoreDirectory({})).toBe(join(homedir(), '.dsh', 'plugin-data', 'complete-subagent', 'children'))
  })
})

describe('BindingStore', () => {
  it('survives a new store instance (a restart)', () => {
    const directory = join(tempDir(), 'children')
    new BindingStore(directory).set(binding('c/1'))
    expect(new BindingStore(directory).get('c/1')).toEqual(binding('c/1'))
    expect(readdirSync(directory)).toEqual(['c%2F1.json'])
  })

  it('returns undefined for unknown children and ignores malformed files', () => {
    const directory = tempDir()
    writeFileSync(join(directory, 'bad.json'), '{not json')
    writeFileSync(join(directory, 'other.json'), JSON.stringify({ ...binding('someone-else'), child: 'someone-else' }))
    const store = new BindingStore(directory)
    expect(store.get('missing')).toBeUndefined()
    expect(store.get('bad')).toBeUndefined()
    expect(store.get('other')).toBeUndefined()
  })

  it('keeps the inherited mark across a restart', () => {
    const directory = tempDir()
    new BindingStore(directory).set({ ...binding('g1'), workspace: null, inherited: true })
    expect(new BindingStore(directory).get('g1')).toEqual({ ...binding('g1'), workspace: null, inherited: true })
    expect(new BindingStore(directory).get('g1')).not.toHaveProperty('inherited', undefined)
  })

  it('forgets a deleted child, in memory and on disk', () => {
    const directory = tempDir()
    const store = new BindingStore(directory)
    store.set(binding('c1'))
    store.delete('c1')
    store.delete('never-bound')
    expect(store.get('c1')).toBeUndefined()
    expect(existsSync(join(directory, 'c1.json'))).toBe(false)
  })

  it('caches a miss until the child is bound', () => {
    const store = new BindingStore(tempDir())
    expect(store.get('c1')).toBeUndefined()
    store.set(binding('c1'))
    expect(store.get('c1')?.workspace).toBe('/w')
  })

  it('adds grants without duplicates and persists them', () => {
    const directory = tempDir()
    const store = new BindingStore(directory)
    store.set(binding('c1'))
    const grant = { path: '/x', kind: 'dir' as const, requestId: 'wr-1', at: 1 }
    store.addGrants('c1', [grant])
    store.addGrants('c1', [{ ...grant, requestId: 'wr-2' }, { path: '/x', kind: 'file', requestId: 'wr-2', at: 2 }])
    expect(new BindingStore(directory).get('c1')?.grants.map(item => `${item.kind}:${item.path}`)).toEqual(['dir:/x', 'file:/x'])
    expect(() => store.addGrants('nobody', [grant])).toThrow(/no binding/u)
  })

  it('removes grants by path, of either kind, and persists the rest', () => {
    const directory = tempDir()
    const store = new BindingStore(directory)
    store.set({ ...binding('c1'), grants: [
      { path: '/x', kind: 'dir', requestId: 'wr-1', at: 1 },
      { path: '/x', kind: 'file', requestId: 'wr-1', at: 1 },
      { path: '/y', kind: 'file', requestId: 'spawn', at: 1 },
    ] })
    expect(store.removeGrants('c1', ['/x', '/z']).map(grant => grant.kind)).toEqual(['dir', 'file'])
    expect(new BindingStore(directory).get('c1')?.grants.map(grant => grant.path)).toEqual(['/y'])
    expect(store.removeGrants('c1', ['/z'])).toEqual([])
    expect(() => store.removeGrants('nobody', ['/y'])).toThrow(/no binding/u)
  })
})
