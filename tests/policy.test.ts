import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { withinCall } from '../src/host/call-scope.ts'
import { canonical } from '../src/host/paths.ts'
import { Fence, patchResolve } from '../src/host/policy.ts'
import { BindingStore } from '../src/host/store.ts'
import type { Binding } from '../src/host/store.ts'
import type { SandboxPolicy, SandboxPolicyRequest } from '../src/host/types.ts'
import { childAgent, fakeWorkingDirectory, parentAgent, tempDir } from './helpers.ts'

function setup() {
  const root = tempDir()
  const store = new BindingStore(tempDir())
  const workingDirectory = fakeWorkingDirectory()
  const fence = new Fence({ store, workingDirectory })
  const parent = parentAgent('p1', root)
  const child = childAgent('c1', parent)
  const base: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: root, sessionId: 'c1' }
  const bind = (fields: Partial<Binding> = {}): Binding => {
    const binding: Binding = { version: 1, child: 'c1', parent: 'p1', workspace: join(root, 'sub'), grants: [], ...fields }
    store.set(binding)
    return binding
  }
  return { root, store, workingDirectory, fence, parent, child, base, bind }
}

describe('Fence.narrow', () => {
  it('leaves sessionless calls, top-level sessions, and unbound children alone', () => {
    const { fence, parent, child, base } = setup()
    expect(fence.narrow(base, {})).toBe(base)
    expect(fence.narrow(base, { session: parent.session })).toBe(base)
    expect(fence.narrow(base, { session: child.session })).toBe(base)
  })

  it('roots a bound child at its sub-workspace and drops full access', () => {
    const { fence, child, base, bind, root } = setup()
    bind()
    expect(fence.narrow({ ...base, mode: 'danger-full-access' }, { session: child.session })).toMatchObject({
      mode: 'workspace-write', workspaceRoot: join(root, 'sub'), additionalWritableRoots: [],
    })
  })

  it('keeps read-only read-only', () => {
    const { fence, child, base, bind } = setup()
    bind()
    const readOnly: SandboxPolicy = { ...base, mode: 'read-only' }
    expect(fence.narrow(readOnly, { session: child.session })).toBe(readOnly)
  })

  it('roots a child without a sub-workspace at the temp directory', () => {
    const { fence, child, base, bind } = setup()
    bind({ workspace: null })
    expect(fence.narrow(base, { session: child.session }).workspaceRoot).toBe(canonical(tmpdir()))
  })

  it('gives an inherited child its nearest bound ancestor\'s current access', () => {
    const { fence, store, child, base, bind, root } = setup()
    mkdirSync(join(root, 'docs'))
    bind()
    const grandchild = childAgent('g1', child)
    const great = childAgent('g2', grandchild)
    store.set({ version: 1, child: 'g1', parent: 'c1', workspace: null, grants: [], inherited: true })
    store.set({ version: 1, child: 'g2', parent: 'g1', workspace: null, grants: [], inherited: true })
    expect(fence.narrow(base, { session: great.session })).toMatchObject({ workspaceRoot: join(root, 'sub'), additionalWritableRoots: [] })
    store.addGrants('c1', [{ path: join(root, 'docs'), kind: 'dir', requestId: 'wr-1', at: 1 }])
    expect(fence.narrow(base, { session: great.session }).additionalWritableRoots).toEqual([join(root, 'docs')])
    expect(fence.bindingOf(great.session)).toMatchObject({ child: 'g2', parent: 'g1', inherited: true })
  })

  it('closes an inherited child whose chain is broken', () => {
    const { fence, store, child, base } = setup()
    const orphan = childAgent('g1', child)
    store.set({ version: 1, child: 'g1', parent: 'c1', workspace: null, grants: [], inherited: true })
    expect(fence.narrow(base, { session: orphan.session }).workspaceRoot).toBe(canonical(tmpdir()))
  })

  it('adds directory grants that still exist, after the deployment roots', () => {
    const { fence, child, base, bind, root } = setup()
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'gone'))
    bind({ grants: [
      { path: join(root, 'docs'), kind: 'dir', requestId: 'wr-1', at: 1 },
      { path: join(root, 'gone'), kind: 'dir', requestId: 'wr-1', at: 1 },
      { path: join(root, 'a.txt'), kind: 'file', requestId: 'wr-1', at: 1 },
    ] })
    rmSync(join(root, 'gone'), { recursive: true })
    const policy = fence.narrow({ ...base, additionalWritableRoots: ['/deploy'] }, { session: child.session })
    expect(policy.additionalWritableRoots).toEqual(['/deploy', join(root, 'docs')])
  })

  it('admits a granted file only inside the write or edit call that targets it', () => {
    const { fence, child, parent, base, bind, root, workingDirectory } = setup()
    workingDirectory.directories.set('c1', join(root, 'sub'))
    bind({ grants: [{ path: join(root, 'package.json'), kind: 'file', requestId: 'wr-1', at: 1 }] })
    const call = (name: string, args: unknown, agent = child) => ({ callId: 'x', name, arguments: args, agent, signal: new AbortController().signal })
    const roots = (current: ReturnType<typeof call> | undefined) => {
      const run = () => fence.narrow(base, { session: child.session }).additionalWritableRoots
      return current === undefined ? run() : withinCall(current, run)
    }
    expect(roots(undefined)).toEqual([])
    expect(roots(call('write', { file_path: '../package.json' }))).toEqual([root])
    expect(roots(call('edit', { file_path: join(root, 'package.json') }))).toEqual([root])
    expect(roots(call('str_replace_editor', { path: join(root, 'package.json') }))).toEqual([root])
    expect(roots(call('write', { file_path: '../other.json' }))).toEqual([])
    expect(roots(call('bash', { command: 'touch ../package.json' }))).toEqual([])
    expect(roots(call('write', { file_path: join(root, 'package.json') }, parent))).toEqual([])
  })

  it('roots a file-tool call whose target was granted at that grant, for hosts that read one root', () => {
    const { fence, child, parent, base, bind, root, workingDirectory } = setup()
    const sub = join(root, 'sub')
    const granted = join(root, 'granted')
    mkdirSync(sub)
    mkdirSync(granted)
    workingDirectory.directories.set('c1', sub)
    bind({ grants: [
      { path: granted, kind: 'dir', requestId: 'wr-1', at: 1 },
      { path: join(root, 'package.json'), kind: 'file', requestId: 'wr-1', at: 1 },
    ] })
    const call = (name: string, args: unknown, agent = child) => ({ callId: 'x', name, arguments: args, agent, signal: new AbortController().signal })
    const rootOf = (current: ReturnType<typeof call>) => withinCall(current, () => fence.narrow(base, { session: child.session }).workspaceRoot)
    expect(fence.narrow(base, { session: child.session }).workspaceRoot).toBe(sub)
    expect(rootOf(call('write', { file_path: join(granted, 'deep', 'a.txt') }))).toBe(granted)
    expect(rootOf(call('str_replace_editor', { path: join(granted, 'a.txt') }))).toBe(granted)
    expect(rootOf(call('edit', { file_path: '../package.json' }))).toBe(root)
    expect(rootOf(call('write', { file_path: 'inside.txt' }))).toBe(sub)
    expect(rootOf(call('write', { file_path: join(root, 'elsewhere.txt') }))).toBe(sub)
    expect(rootOf(call('bash', { command: `touch ${join(granted, 'a.txt')}` }))).toBe(sub)
    expect(rootOf(call('write', { file_path: join(granted, 'a.txt') }, parent))).toBe(sub)
  })

  it('keeps a store failure to the session it hit', () => {
    const { child, parent, base, root } = setup()
    const other = childAgent('c2', parent)
    const store = {
      get: (id: string) => {
        if (id === 'c1' || id === 'p1') throw new Error('disk')
        return { version: 1, child: id, parent: 'p1', workspace: join(root, 'other'), grants: [] }
      },
    } as unknown as BindingStore
    const fence = new Fence({ store })
    expect(fence.narrow(base, { session: child.session }).mode).toBe('read-only')
    expect(fence.narrow(base, { session: parent.session })).toBe(base)
    expect(fence.narrow(base, { session: other.session })).toMatchObject({ mode: 'workspace-write', workspaceRoot: join(root, 'other') })
  })

  it('falls back to read-only for a subagent when the store fails', () => {
    const { child, base } = setup()
    const broken = { get: () => { throw new Error('disk') } } as unknown as BindingStore
    const warnings: string[] = []
    const fence = new Fence({ store: broken, warn: message => warnings.push(message) })
    expect(fence.narrow(base, { session: child.session }).mode).toBe('read-only')
    expect(warnings).toHaveLength(1)
  })
})

describe('Fence.canModify', () => {
  it('follows the session mode, its roots, temp directories, and its own file grants', () => {
    const { fence, child, parent, base, bind, root } = setup()
    const policy: SandboxPolicy = { ...base, additionalWritableRoots: ['/extra'] }
    expect(fence.canModify({ ...policy, mode: 'danger-full-access' }, parent.session, '/etc/x', 'file')).toBe(true)
    expect(fence.canModify({ ...policy, mode: 'read-only' }, parent.session, join(root, 'x'), 'file')).toBe(false)
    expect(fence.canModify(policy, parent.session, join(root, 'a', 'b'), 'dir')).toBe(true)
    expect(fence.canModify(policy, parent.session, '/extra/y', 'dir')).toBe(true)
    expect(fence.canModify(policy, parent.session, canonical(join(tmpdir(), 'scratch')), 'dir')).toBe(true)
    expect(fence.canModify(policy, parent.session, '/elsewhere', 'dir')).toBe(false)
    bind({ grants: [{ path: '/elsewhere/f.txt', kind: 'file', requestId: 'wr-1', at: 1 }] })
    const narrowed = fence.narrow(base, { session: child.session })
    expect(fence.canModify(narrowed, child.session, '/elsewhere/f.txt', 'file')).toBe(true)
    expect(fence.canModify(narrowed, child.session, '/elsewhere/f.txt', 'dir')).toBe(false)
    // Test directories live under the temp directory, which is always writable, so
    // "outside" has to be a path outside it.
    expect(fence.canModify(narrowed, child.session, '/elsewhere/other', 'dir')).toBe(false)
  })
})

describe('patchResolve', () => {
  class PolicyService extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sandboxPolicy')
    }

    resolve(request: SandboxPolicyRequest = {}): SandboxPolicy {
      return { mode: 'workspace-write', workspaceRoot: request.session?.header.cwd ?? '/fallback' }
    }
  }

  it('reaches holders of the real cordis service proxy, including ones captured earlier, and restores', async () => {
    const root = new Context()
    root.plugin(PolicyService)
    const services: { resolve(request?: SandboxPolicyRequest): SandboxPolicy }[] = []
    root.inject(['sandboxPolicy'], (ctx) => {
      services.push((ctx as unknown as { sandboxPolicy: typeof services[number] }).sandboxPolicy)
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    const [service] = services
    expect(service).toBeDefined()
    const seen: SandboxPolicyRequest[] = []
    const restore = patchResolve(service as object, (policy, request) => {
      seen.push(request)
      return { ...policy, workspaceRoot: '/narrowed' }
    })
    const session = { id: 's', header: { id: 's', cwd: '/project' } }
    expect(service?.resolve({ session }).workspaceRoot).toBe('/narrowed')
    expect(service?.resolve().workspaceRoot).toBe('/narrowed')
    expect(seen).toEqual([{ session }, {}])
    restore()
    expect(service?.resolve({ session }).workspaceRoot).toBe('/project')
  })

  it('refuses a service without a prototype method', () => {
    const own = { resolve: () => ({ mode: 'read-only', workspaceRoot: '/' }) }
    expect(() => patchResolve(Object.create(null) as object, policy => policy)).toThrow(/not supported/u)
    expect(() => patchResolve(own, policy => policy)).toThrow(/not supported/u)
  })
})
