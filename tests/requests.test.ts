import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Fence } from '../src/host/policy.ts'
import { RequestBroker } from '../src/host/requests.ts'
import { BindingStore } from '../src/host/store.ts'
import { createAnswerTool, createGrantTool, createRequestTool, createRevokeTool, requestMessage } from '../src/host/tools.ts'
import type { AgentLike, SandboxPolicy, SessionLike, TextBlock } from '../src/host/types.ts'
import { childAgent, fakeWorkingDirectory, parentAgent, tempDir } from './helpers.ts'

describe('RequestBroker', () => {
  const fields = { child: 'c1', parent: 'p1', workspace: null, paths: [{ path: '/x', directory: false }], reason: 'r' }

  it('opens, lists, answers, and closes requests', async () => {
    const broker = new RequestBroker()
    const request = broker.open(fields)
    expect(request.id).toMatch(/^wr-[0-9a-f]{6}$/u)
    expect(broker.pendingFor('p1')).toEqual([request])
    expect(broker.pendingFor('p2')).toEqual([])
    const waiting = broker.wait(request.id, 10_000, new AbortController().signal)
    expect(broker.settle(request.id, { decision: 'allow', granted: [{ path: '/x', kind: 'file' }] })).toBe(true)
    await expect(waiting).resolves.toMatchObject({ decision: 'allow' })
    expect(broker.get(request.id)).toBeUndefined()
    expect(broker.settle(request.id, { decision: 'deny', granted: [] })).toBe(false)
  })

  it('denies on timeout and rejects on cancellation', async () => {
    vi.useFakeTimers()
    try {
      const broker = new RequestBroker()
      const late = broker.open(fields)
      const waiting = broker.wait(late.id, 5_000, new AbortController().signal)
      vi.advanceTimersByTime(5_000)
      await expect(waiting).resolves.toMatchObject({ decision: 'deny', message: expect.stringMatching(/5 seconds/u) })
      expect(broker.get(late.id)).toBeUndefined()
      const cancelled = broker.open(fields)
      const controller = new AbortController()
      const pending = broker.wait(cancelled.id, 5_000, controller.signal)
      controller.abort(new Error('stop'))
      await expect(pending).rejects.toThrow('stop')
      expect(broker.get(cancelled.id)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** A parent, its bound child, and both tools wired to fakes. */
function setup(options: { sendFails?: boolean } = {}) {
  const root = tempDir()
  const store = new BindingStore(tempDir())
  const workingDirectory = fakeWorkingDirectory()
  const fence = new Fence({ store, workingDirectory })
  const broker = new RequestBroker()
  const parent = parentAgent('p1', root)
  const child = childAgent('c1', parent)
  workingDirectory.directories.set('c1', join(root, 'sub'))
  mkdirSync(join(root, 'sub'))
  store.set({ version: 1, child: 'c1', parent: 'p1', workspace: join(root, 'sub'), grants: [] })
  const sent: { sender: string; target: string; text: string }[] = []
  const subagents = {
    async sendMessage(sender: AgentLike, target: string, content: TextBlock[]) {
      if (options.sendFails === true) throw new Error('parent offline')
      sent.push({ sender: sender.id, target, text: content.map(block => block.text).join('') })
      return 'm1'
    },
  }
  const base = (session: SessionLike): SandboxPolicy => ({ mode: 'workspace-write', workspaceRoot: session.header.cwd ?? root })
  const resolvePolicy = (session: SessionLike) => fence.narrow(base(session), { session })
  const deps = { store, fence, broker, subagents, workingDirectory, resolvePolicy, timeoutMs: () => 60_000 }
  const request = createRequestTool(deps)
  const answer = createAnswerTool(deps)
  const grant = createGrantTool(deps)
  const revoke = createRevokeTool(deps)
  const exec = (agent: AgentLike, signal = new AbortController().signal) =>
    ({ agent, signal, callId: 'x', rootCallId: 'x', name: 'x', arguments: {} }) as never
  /** Start a request and wait until its message reached the parent. */
  const ask = async (args: { paths: string[]; reason: string }) => {
    const result = request.execute(args, exec(child)) as Promise<{ decision: string; granted: { path: string; kind: string }[]; message?: string }>
    await vi.waitFor(() => {
      if (sent.length === 0 && broker.pendingFor('p1').length === 0) throw new Error('not sent yet')
    })
    return { result, id: broker.pendingFor('p1')[0]?.id ?? '' }
  }
  return { root, store, broker, parent, child, sent, request, answer, grant, revoke, exec, ask }
}

describe('grant_write_access and revoke_write_access', () => {
  it('grants without a request, creating directories named with a slash', async () => {
    const { root, store, grant, exec, parent, sent } = setup()
    const result = await grant.execute({ agent_id: 'c1', paths: ['docs/', 'README.md'] }, exec(parent))
    expect(result).toEqual({ agent_id: 'c1', granted: [{ path: join(root, 'docs'), kind: 'dir' }, { path: join(root, 'README.md'), kind: 'file' }] })
    expect(existsSync(join(root, 'docs'))).toBe(true)
    expect(store.get('c1')?.grants.map(item => `${item.kind}:${item.requestId}`)).toEqual(['dir:grant', 'file:grant'])
    expect(sent).toEqual([])
  })

  it('works only on the caller\'s own children and within its reach', async () => {
    const { root, grant, revoke, exec, parent, child } = setup()
    await expect(grant.execute({ agent_id: 'nobody', paths: ['a'] }, exec(parent))).rejects.toThrow(/not a subagent you started/u)
    await expect(grant.execute({ agent_id: 'c1', paths: ['a'] }, exec(parentAgent('p2', root)))).rejects.toThrow(/not a subagent you started/u)
    await expect(revoke.execute({ agent_id: 'c1', paths: ['a'] }, exec(child))).rejects.toThrow(/not a subagent you started/u)
    await expect(grant.execute({ agent_id: 'c1', paths: ['/etc/dbs-test-file'] }, exec(parent))).rejects.toThrow(/outside your own sandbox/u)
  })

  it('revokes granted paths and names the ones that were not granted', async () => {
    const { root, store, grant, revoke, exec, parent } = setup()
    await grant.execute({ agent_id: 'c1', paths: ['docs/', 'README.md'] }, exec(parent))
    const result = await revoke.execute({ agent_id: 'c1', paths: ['README.md', 'other.txt'] }, exec(parent))
    expect(result).toEqual({ agent_id: 'c1', revoked: [{ path: join(root, 'README.md'), kind: 'file' }], not_granted: [join(root, 'other.txt')] })
    expect(store.get('c1')?.grants.map(item => item.path)).toEqual([join(root, 'docs')])
    expect(revoke.output.render({}, result as never)[0]).toMatchObject({ text: expect.stringContaining('Not granted, so nothing to revoke') })
  })
})

describe('request_write_access and answer_write_request', () => {
  it('asks the parent, waits, and grants a file and a new directory', async () => {
    const { root, store, sent, answer, exec, parent, ask } = setup()
    const { result, id } = await ask({ paths: ['../package.json', '../docs/new/'], reason: 'update deps' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sender: 'c1', target: 'p1' })
    expect(sent[0]?.text).toContain(`[write-access request ${id}]`)
    expect(sent[0]?.text).toContain(`- ${join(root, 'package.json')}\n`)
    expect(sent[0]?.text).toContain(`- ${join(root, 'docs', 'new')}/ (directory)`)
    const answered = await answer.execute({ request_id: id, decision: 'allow', message: 'go ahead' }, exec(parent))
    expect(answered).toMatchObject({ request_id: id, decision: 'allow' })
    expect(existsSync(join(root, 'docs', 'new'))).toBe(true)
    await expect(result).resolves.toEqual({
      decision: 'allow',
      granted: [{ path: join(root, 'package.json'), kind: 'file' }, { path: join(root, 'docs', 'new'), kind: 'dir' }],
      message: 'go ahead',
    })
    expect(store.get('c1')?.grants.map(grant => `${grant.kind}:${grant.path}`)).toEqual([
      `file:${join(root, 'package.json')}`, `dir:${join(root, 'docs', 'new')}`,
    ])
  })

  it('lets the parent narrow the grant', async () => {
    const { root, answer, exec, parent, ask } = setup()
    mkdirSync(join(root, 'src'))
    const { result, id } = await ask({ paths: ['../'], reason: 'refactor' })
    await answer.execute({ request_id: id, decision: 'allow', paths: ['src'] }, exec(parent))
    await expect(result).resolves.toMatchObject({ granted: [{ path: join(root, 'src'), kind: 'dir' }] })
  })

  it('passes a denial and its note to the child', async () => {
    const { store, answer, exec, parent, ask } = setup()
    const { result, id } = await ask({ paths: ['../a.txt'], reason: 'r' })
    await answer.execute({ request_id: id, decision: 'deny', message: 'not needed' }, exec(parent))
    await expect(result).resolves.toEqual({ decision: 'deny', granted: [], message: 'not needed' })
    expect(store.get('c1')?.grants).toEqual([])
  })

  it('refuses grants the parent cannot make, and answers from other agents', async () => {
    const { answer, exec, parent, root, broker, ask } = setup()
    const { id } = await ask({ paths: ['/etc/dbs-test-file'], reason: 'r' })
    await expect(answer.execute({ request_id: id, decision: 'allow' }, exec(parent))).rejects.toThrow(/outside your own sandbox/u)
    await expect(answer.execute({ request_id: id, decision: 'allow' }, exec(parentAgent('p2', root)))).rejects.toThrow(/another agent/u)
    expect(broker.get(id)).toBeDefined()
    await expect(answer.execute({ request_id: 'wr-000000', decision: 'deny' }, exec(parent))).rejects.toThrow(/No open/u)
  })

  it('tells a nested parent to request upward first', async () => {
    // Test directories sit under the always-writable temp directory, so the
    // out-of-reach path has to live elsewhere.
    const { answer, exec, store, child, broker } = setup()
    store.set({ version: 1, child: 'g1', parent: 'c1', workspace: null, grants: [] })
    const request = broker.open({ child: 'g1', parent: 'c1', workspace: null, paths: [{ path: '/etc/dbs-nested.txt', directory: false }], reason: 'r' })
    await expect(answer.execute({ request_id: request.id, decision: 'allow' }, exec(child))).rejects.toThrow(/from your own parent/u)
  })

  it('denies at once when the parent cannot be reached', async () => {
    const { request, exec, child, broker } = setup({ sendFails: true })
    await expect(request.execute({ paths: ['../x'], reason: 'r' }, exec(child))).resolves.toMatchObject({
      decision: 'deny', message: expect.stringMatching(/parent offline/u),
    })
    expect(broker.pendingFor('p1')).toEqual([])
  })

  it('is only for children started with the delegation tools', async () => {
    const { request, grant, exec, parent, child, store, root } = setup()
    await expect(request.execute({ paths: ['x'], reason: 'r' }, exec(parent))).rejects.toThrow(/only for subagents/u)
    // A child started by other means under a confined agent shares that agent's access and cannot ask or be granted more.
    const inherited = childAgent('g1', child)
    store.set({ version: 1, child: 'g1', parent: 'c1', workspace: null, grants: [], inherited: true })
    await expect(request.execute({ paths: ['x'], reason: 'r' }, exec(inherited))).rejects.toThrow(/`delegate` or `delegate_fork`/u)
    await expect(grant.execute({ agent_id: 'g1', paths: [join(root, 'sub', 'a')] }, exec(child))).rejects.toThrow(/not a subagent you started/u)
    await expect(grant.execute({ agent_id: 'c1', paths: ['/etc/dbs-test-file'] }, exec(inherited))).rejects.toThrow(/not a subagent you started/u)
    store.set({ version: 1, child: 'g2', parent: 'g1', workspace: null, grants: [] })
    await expect(grant.execute({ agent_id: 'g2', paths: ['/etc/dbs-test-file'] }, exec(inherited))).rejects.toThrow(/agent above you/u)
    expect(parent.id).toBe('p1')
  })

  it('writes a message that names the answer tool and the timeout', () => {
    const text = requestMessage({ id: 'wr-1', child: 'c1', parent: 'p1', workspace: null, paths: [{ path: '/a', directory: true }], reason: 'why', at: 0 }, 600_000)
    expect(text).toContain('it has no sub-workspace')
    expect(text).toContain('- /a/ (directory)')
    expect(text).toContain('`answer_write_request`')
    expect(text).toContain('10 minutes')
  })
})
