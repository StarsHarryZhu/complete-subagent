import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideAccess } from '../src/host/access.ts'
import type { AccessRequest } from '../src/host/access.ts'
import { Fence } from '../src/host/policy.ts'
import { BindingStore } from '../src/host/store.ts'
import type { SandboxPolicy } from '../src/host/types.ts'
import { fakeWorkingDirectory, parentAgent, tempDir } from './helpers.ts'

function setup() {
  const root = tempDir()
  const store = new BindingStore(tempDir())
  const workingDirectory = fakeWorkingDirectory()
  const fence = new Fence({ store, workingDirectory })
  const resolvePolicy = (): SandboxPolicy => ({ mode: 'workspace-write', workspaceRoot: root })
  const parent = parentAgent('p1', root)
  const decide = (fields: Partial<AccessRequest> = {}) =>
    decideAccess({ store, fence, workingDirectory, resolvePolicy }, { parent, cwd: undefined, writablePaths: undefined, ...fields })
  return { root, decide }
}

describe('decideAccess', () => {
  it('creates a cwd inside the parent area and makes it the sub-workspace', async () => {
    const { root, decide } = setup()
    await expect(decide({ cwd: 'work/a' })).resolves.toEqual({ cwd: join(root, 'work', 'a'), workspace: join(root, 'work', 'a'), grants: [] })
    expect(existsSync(join(root, 'work', 'a'))).toBe(true)
  })

  it('gives no sub-workspace without a cwd, and lets the child inherit the directory', async () => {
    const { decide } = setup()
    await expect(decide()).resolves.toEqual({ workspace: null, grants: [] })
    await expect(decide({ cwd: '  ' })).resolves.toEqual({ workspace: null, grants: [] })
  })

  it('gives no sub-workspace for a cwd outside the parent area, and creates nothing', async () => {
    const { decide } = setup()
    await expect(decide({ cwd: '/dbs-outside-of-everything/x' })).resolves.toEqual({ cwd: '/dbs-outside-of-everything/x', workspace: null, grants: [] })
    expect(existsSync('/dbs-outside-of-everything')).toBe(false)
  })

  it('gives no sub-workspace when the cwd is an existing file', async () => {
    const { root, decide } = setup()
    writeFileSync(join(root, 'file'), 'x')
    await expect(decide({ cwd: 'file' })).resolves.toMatchObject({ cwd: join(root, 'file'), workspace: null })
  })

  it('turns writable_paths into grants, creating directories named with a slash', async () => {
    const { root, decide } = setup()
    const access = await decide({ cwd: 'sub', writablePaths: ['README.md', 'shared/'] })
    expect(existsSync(join(root, 'shared'))).toBe(true)
    expect(access.grants.map(grant => `${grant.kind}:${grant.path}:${grant.requestId}`)).toEqual([
      `file:${join(root, 'README.md')}:spawn`, `dir:${join(root, 'shared')}:spawn`,
    ])
  })

  it('refuses bad arguments and writable_paths the parent cannot modify, before creating anything', async () => {
    const { root, decide } = setup()
    await expect(decide({ cwd: 'sub', writablePaths: ['/etc/dbs-test-file'] })).rejects.toThrow(/outside your own sandbox/u)
    await expect(decide({ writablePaths: 'README.md' })).rejects.toThrow(/list of paths/u)
    await expect(decide({ cwd: 3 })).rejects.toThrow(/cwd must be a path/u)
    expect(existsSync(join(root, 'sub'))).toBe(false)
  })
})
