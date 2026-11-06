import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
import type { CompleteSubagentService } from '../src/index.ts'
import { currentCall, withinCall } from '../src/host/call-scope.ts'
import { BindingStore, defaultStoreDirectory } from '../src/host/store.ts'
import type { ChildModel } from '../src/shared/settings.ts'
import type { ActivationSpecLike, AgentLike, LlmLike, SandboxPolicy, SandboxPolicyRequest, SessionLike, TextBlock, ToolCallLike } from '../src/host/types.ts'
import { childAgent, fakeWorkingDirectory, parentAgent, tempDir } from './helpers.ts'

type Listener = (...args: any[]) => unknown
type Provider = { name: string; text: (context: { agent?: AgentLike }) => string }
type Registered = { definition: { name: string; description: string; parameters: unknown; execute: (args: unknown, exec: unknown) => Promise<unknown> }; when?: (context: { agent: AgentLike }) => boolean }

/** A live config field the way the loader hands it to `apply`. */
function volatile<T>(value: T) {
  return { value, get() { return this.value } }
}

/**
 * A fake host with just the services and events the plugin uses, and a subagent
 * runtime that creates the child inside the start call. The child runs the
 * agent preset the start selects, else its parent's, as the host records it in
 * the child's header. With `legacy` it behaves like 0.2.1-rc.5: the registry has
 * no `presetForSession`, and `tools.register` drops `when`, leaving per-agent
 * restrictions as the only way to hide a tool.
 */
function fakeHost(root: string, options: { ownResolve?: boolean; failStart?: boolean; providers?: string[]; legacy?: boolean } = {}) {
  const legacy = options.legacy === true
  const failing = new Set<string>()
  const listeners = new Map<string, Listener[]>()
  const disposers: (() => void)[] = []
  const warnings: string[] = []
  class PolicyService {
    resolve(request: SandboxPolicyRequest = {}): SandboxPolicy {
      return { mode: 'workspace-write', workspaceRoot: request.session?.header.cwd ?? root }
    }
  }
  const sandboxPolicy = options.ownResolve === true
    ? { resolve: (request: SandboxPolicyRequest = {}) => new PolicyService().resolve(request) }
    : new PolicyService()
  const tools = new Map<string, Registered>()
  const providers = new Map<string, Provider>()
  const workingDirectory = fakeWorkingDirectory()
  const emit = async (event: string, ...args: unknown[]) => {
    for (const handler of listeners.get(event) ?? []) await handler(...args)
  }
  const listener = (event: string): Listener => {
    const found = listeners.get(event)?.[0]
    if (found === undefined) throw new Error(`no ${event} listener`)
    return found
  }
  const policyOf = (agent: AgentLike) => (sandboxPolicy as PolicyService).resolve({ session: agent.session })
  // Like the host runtime: create the child under the reserved id (which emits
  // agent/created before its first step), then report it.
  const started: { spec: ActivationSpecLike; policyAtCreation: SandboxPolicy }[] = []
  const messages: string[] = []
  const presets = new Map<string, string>()
  const agents = new Map<string, AgentLike>()
  const filters = new Map<string, Set<string>[]>()
  const denied = (tool: string, id: string) => (filters.get(id) ?? []).some(filter => filter.has(tool))
  let presetReads = 0
  let projectionReads = 0
  const agentPresets = legacy ? {} : {
    presetForSession(session: SessionLike) {
      presetReads++
      return presets.get(session.id) ?? null
    },
  }
  const sessionProjections = {
    stateOf(session: SessionLike, key: string) {
      projectionReads++
      return key === 'agentPreset' ? presets.get(session.id) ?? null : undefined
    },
  }
  /** Make an agent live, optionally running a preset. */
  const live = (agent: AgentLike, preset?: string): AgentLike => {
    agents.set(agent.id, agent)
    if (preset !== undefined) presets.set(agent.id, preset)
    if (legacy) {
      Object.assign(agent, {
        ctx: {
          tools: {
            restrict({ deny }: { deny: readonly string[] }) {
              for (const tool of deny) if (!tools.has(tool)) throw new Error(`unknown global tool ${tool}`)
              const filter = new Set(deny)
              filters.set(agent.id, [...filters.get(agent.id) ?? [], filter])
              return () => filters.set(agent.id, (filters.get(agent.id) ?? []).filter(other => other !== filter))
            },
          },
        },
      })
    }
    return agent
  }
  const subagents = {
    async sendMessage(_sender: AgentLike, _target: string, content: TextBlock[]) {
      messages.push(content.map(block => block.text).join(''))
    },
    getProvider: (provider: string) => (options.providers ?? ['spawn', 'fork']).includes(provider) ? { name: provider } : undefined,
    resolveMaxDepth: () => 1,
    async startActivation(spec: ActivationSpecLike) {
      if (options.failStart === true) {
        started.push({ spec, policyAtCreation: { mode: 'read-only', workspaceRoot: '' } })
        throw new Error('backend refused')
      }
      const child: AgentLike = {
        id: spec.childId,
        session: { id: spec.childId, header: { id: spec.childId, cwd: spec.request.parent.session.header.cwd, parentSession: spec.request.parent.id, origin: 'subagent', delegationDepth: 1 } },
      }
      workingDirectory.directories.set(child.id, spec.request.cwd ?? root)
      live(child, spec.request.agentPreset ?? presets.get(spec.request.parent.id))
      await emit('agent/created', { agent: child, source: 'new' })
      started.push({ spec, policyAtCreation: policyOf(child) })
      return { childId: child.id }
    },
  }
  const preflights: unknown[] = []
  const llm: LlmLike = {
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }], defaultEffort: 'high' } }),
    resolveCallConfig: async (config) => { preflights.push(config); return config },
  }
  const services = new Map<string, unknown>()
  const ctx = {
    logger: { warn: (message: string) => warnings.push(message) },
    provide(service: string, value: unknown) {
      if (failing.has('provide')) throw new Error(`service "${service}" has been registered`)
      services.set(service, value)
      const dispose = () => services.delete(service)
      disposers.push(dispose)
      return dispose
    },
    effect(effect: () => unknown) {
      const dispose = effect()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
    },
    on(event: string, handler: Listener) {
      listeners.set(event, [...listeners.get(event) ?? [], handler])
      return () => undefined
    },
    get(service: string) {
      if (failing.has(service)) throw new Error(`${service} failed`)
      const registry = { get: (id: string) => agents.get(id), list: () => [...agents.values()] }
      return ({ llm, agentPresets, sessionProjections, agents: registry } as Record<string, unknown>)[service]
    },
    tools: {
      register(definition: Registered['definition'], registration: { when?: Registered['when'] } = {}) {
        if (failing.has('register')) throw new Error('register failed')
        if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        const entry = { definition, ...legacy ? {} : registration }
        tools.set(definition.name, entry)
        return () => { if (tools.get(definition.name) === entry) tools.delete(definition.name) }
      },
      get: (tool: string, scope?: AgentLike) => scope !== undefined && denied(tool, scope.id) ? undefined : tools.get(tool)?.definition,
      ...legacy ? {} : { resolve: async () => undefined },
    },
    subagents,
    sandboxPolicy,
    workingDirectory,
    systemPrompt: {
      context(provider: Provider) {
        providers.set(provider.name, provider)
        return () => providers.delete(provider.name)
      },
      getContextOrder: () => 120,
    },
  }
  /** Run a tool call the way the executor does: the body inside tools/execute. */
  const call = async (tool: string, agent: AgentLike, args: unknown): Promise<unknown> => {
    const registered = tools.get(tool)
    if (registered === undefined) throw new Error(`${tool} is not registered`)
    const execution: ToolCallLike = { callId: 'call-1', name: tool, arguments: args, agent, signal: new AbortController().signal }
    return listener('tools/execute')(execution, () => registered.definition.execute(args, { ...execution, rootCallId: 'call-1' }))
  }
  return {
    ctx, warnings, tools, providers, workingDirectory, listener, started, preflights, call, emit, messages, presets, live, failing, filters, services,
    service: () => services.get('completeSubagent') as CompleteSubagentService,
    agent: (id: string) => agents.get(id) as AgentLike,
    presetReads: () => presetReads,
    projectionReads: () => projectionReads,
    resolve: policyOf,
    text: (provider: string, agent: AgentLike) => providers.get(provider)?.text({ agent }) ?? '',
    visible: (tool: string, agent: AgentLike) => legacy
      ? tools.has(tool) && !denied(tool, agent.id)
      : tools.get(tool)?.when?.({ agent }) ?? tools.has(tool),
    dispose: () => disposers.reverse().forEach(dispose => dispose()),
  }
}

const config = (models: ChildModel[] = [], presets?: string[], childPreset?: string, ownModel?: boolean) => ({
  requestTimeoutSeconds: volatile(600),
  models: volatile(models),
  ...presets === undefined ? {} : { presets },
  ...childPreset === undefined ? {} : { childPreset },
  ...ownModel === undefined ? {} : { ownModel },
})
const ALL_TOOLS = ['delegate', 'delegate_fork', 'request_write_access', 'answer_write_request', 'grant_write_access', 'revoke_write_access'] as const
const PARENT_TOOLS = ALL_TOOLS.filter(tool => tool !== 'request_write_access')
const properties = (definition: { parameters: unknown } | undefined) => (definition?.parameters as { properties: Record<string, { enum?: string[] }> }).properties

describe('the plugin', () => {
  let previousHome: string | undefined
  beforeEach(() => {
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = tempDir()
  })
  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('declares its name and the services it injects', () => {
    expect(name).toBe('complete-subagent')
    expect(inject).toEqual(['tools', 'subagents', 'sandboxPolicy', 'workingDirectory', 'systemPrompt'])
  })

  it('starts a child that is fenced from its first step, and restores everything on dispose', async () => {
    const root = tempDir()
    const host = fakeHost(root)
    apply(host.ctx as never, config() as never)
    const parent = parentAgent('p1', root)
    expect([...host.tools.keys()].sort()).toEqual(['answer_write_request', 'delegate', 'delegate_fork', 'grant_write_access', 'request_write_access', 'revoke_write_access'])
    expect(properties(host.tools.get('delegate')?.definition).model).toBeUndefined()
    expect(host.tools.get('delegate')?.definition.description).toMatch(/^Delegate a self-contained task/u)

    const result = await host.call('delegate', parent, { description: 'Write docs', prompt: 'go', cwd: 'sub', writable_paths: ['README.md'] })
    const [{ spec, policyAtCreation }] = host.started
    expect(result).toEqual({ kind: 'activation', subagentId: spec.childId })
    expect(spec).toMatchObject({ provider: 'spawn', label: 'Write docs', delivery: 'parent', request: { cwd: join(root, 'sub'), prompt: [{ type: 'text', text: 'go' }], maxDepth: 1 } })
    expect(spec.request.agentOptions).toBeUndefined()
    expect(spec.request.agentPreset).toBeUndefined()
    expect(existsSync(join(root, 'sub'))).toBe(true)
    expect(policyAtCreation.workspaceRoot).toBe(join(root, 'sub'))

    const child = childAgent(spec.childId, parent)
    expect(host.resolve(child).workspaceRoot).toBe(join(root, 'sub'))
    expect(host.resolve(parent).workspaceRoot).toBe(root)
    expect(host.text('complete-subagent:child', child)).toContain(`Sub-workspace: ${join(root, 'sub')}.`)
    expect(host.text('complete-subagent:child', child)).toContain(join(root, 'README.md'))
    expect(host.text('complete-subagent:child', parent)).toBe('')
    for (const [tool, forParent, forChild] of [
      ['request_write_access', false, true],
      ['answer_write_request', true, true],
      ['grant_write_access', true, true],
      ['revoke_write_access', true, true],
    ] as const) {
      expect(host.visible(tool, parent), tool).toBe(forParent)
      expect(host.visible(tool, child), tool).toBe(forChild)
    }

    const execution: ToolCallLike = { callId: 'x', name: 'write', arguments: {}, agent: parent, signal: new AbortController().signal }
    expect(await host.listener('tools/execute')(execution, async () => currentCall())).toBe(execution)

    host.dispose()
    expect(host.resolve(child).workspaceRoot).toBe(root)
    expect(host.tools.size).toBe(0)
    expect(host.providers.size).toBe(0)
  })

  it('starts a fork on the fork backend, with the chosen model and effort', async () => {
    const root = tempDir()
    const host = fakeHost(root)
    apply(host.ctx as never, config([{ provider: 'ds', model: 'pro', reasoningEfforts: ['high', 'max'] }]) as never)
    const parent: AgentLike = { ...parentAgent('p1', root), options: { provider: 'ds', model: 'flash', reasoningEffort: 'max' } }
    expect(properties(host.tools.get('delegate_fork')?.definition).model?.enum).toEqual(['ds/pro'])
    await host.call('delegate_fork', parent, { description: 'Review', prompt: 'look', model: 'ds/pro', reasoning_effort: 'high' })
    expect(host.started[0].spec).toMatchObject({ provider: 'fork', request: { agentOptions: { provider: 'ds', model: 'pro', reasoningEffort: 'high' } } })
    expect(host.started[0].spec.request.cwd).toBeUndefined()
    expect(host.started[0].policyAtCreation.workspaceRoot).not.toBe(root)
    await expect(host.call('delegate', parent, { description: 'x', prompt: 'y', model: 'ds/pro', reasoning_effort: 'low' })).rejects.toThrow(/Choose one of: high, max/u)
    expect(host.started).toHaveLength(1)
  })

  it('rebuilds the delegation tools when the model settings change', async () => {
    const host = fakeHost(tempDir())
    const settings = config()
    apply(host.ctx as never, settings as never)
    const before = host.tools.get('delegate')?.definition
    await host.emit('loader/volatile-update')
    expect(host.tools.get('delegate')?.definition).toBe(before)
    settings.models.value = [{ provider: 'ds', model: 'pro', reasoningEfforts: [] }]
    await host.emit('loader/volatile-update')
    expect(host.tools.get('delegate')?.definition).not.toBe(before)
    expect(properties(host.tools.get('delegate')?.definition).model?.enum).toEqual(['ds/pro'])
    expect(host.tools.get('delegate')?.definition.description).toContain('- ds/pro: any effort it supports')
  })

  it('hides the delegation tools without a backend or at the depth limit', () => {
    const root = tempDir()
    const host = fakeHost(root, { providers: ['spawn'] })
    apply(host.ctx as never, config() as never)
    const parent = parentAgent('p1', root)
    const deep: AgentLike = { ...childAgent('c1', parent), session: { id: 'c1', header: { id: 'c1', origin: 'subagent', parentSession: 'p1', delegationDepth: 1 } } }
    expect(host.visible('delegate', parent)).toBe(true)
    expect(host.visible('delegate_fork', parent)).toBe(false)
    expect(host.visible('delegate', deep)).toBe(false)
    expect(host.visible('grant_write_access', deep)).toBe(false)
  })

  it('forgets the binding when the child fails to start', async () => {
    const root = tempDir()
    const host = fakeHost(root, { failStart: true })
    apply(host.ctx as never, config() as never)
    const parent = parentAgent('p1', root)
    await expect(host.call('delegate', parent, { description: 'x', prompt: 'y', cwd: 'sub' })).rejects.toThrow(/backend refused/u)
    const child = childAgent(host.started[0].spec.childId, parent)
    expect(host.resolve(child).workspaceRoot).toBe(root)
  })

  it('confines a child that a confined agent starts by other means, and nothing else', async () => {
    const root = tempDir()
    const host = fakeHost(root)
    apply(host.ctx as never, config() as never)
    const parent = parentAgent('p1', root)
    await host.call('delegate', parent, { description: 'x', prompt: 'y', cwd: 'sub' })
    const child = childAgent(host.started[0].spec.childId, parent)
    const official = childAgent('official-grandchild', child)
    await host.emit('agent/created', { agent: official, source: 'new' })
    expect(host.resolve(official).workspaceRoot).toBe(join(root, 'sub'))
    expect(host.visible('request_write_access', official)).toBe(false)
    expect(host.text('complete-subagent:child', official)).toContain('cannot ask for more')

    const unrelated = childAgent('official-child', parent)
    await host.emit('agent/created', { agent: unrelated, source: 'new' })
    expect(host.resolve(unrelated).workspaceRoot).toBe(root)
    await host.emit('agent/created', { agent: parentAgent('top', root), source: 'new' })
    expect(host.resolve(parentAgent('top', root)).workspaceRoot).toBe(root)
  })

  describe('with the presets setting', () => {
    it('serves every agent when it is empty, without asking the preset registry', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], []) as never)
      const parent = host.live(parentAgent('p1', root), 'standard')
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, parent), tool).toBe(true)
      await host.call('delegate', parent, { description: 'x', prompt: 'y', cwd: 'sub' })
      const child = childAgent(host.started[0].spec.childId, parent)
      expect(host.resolve(child).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.visible('request_write_access', child)).toBe(true)
      expect(host.text('complete-subagent:child', child)).toContain(`Sub-workspace: ${join(root, 'sub')}.`)
      const official = childAgent('official-grandchild', child)
      await host.emit('agent/created', { agent: official, source: 'new' })
      expect(host.resolve(official).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.presetReads()).toBe(0)
    })

    it('serves agents of the listed presets and their children', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const parent = host.live(parentAgent('p1', root), 'dsh-assisstant')
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, parent), tool).toBe(true)
      expect(host.visible('request_write_access', parent)).toBe(false)

      await host.call('delegate', parent, { description: 'x', prompt: 'y', cwd: 'sub' })
      const child = childAgent(host.started[0].spec.childId, parent)
      expect(host.resolve(child).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.visible('request_write_access', child)).toBe(true)
      expect(host.text('complete-subagent:child', child)).toContain(`Sub-workspace: ${join(root, 'sub')}.`)

      const asked = host.call('request_write_access', child, { paths: ['../notes.md'], reason: 'r' })
      await vi.waitFor(() => expect(host.messages).toHaveLength(1))
      const id = /wr-[0-9a-f]+/u.exec(host.messages[0])?.[0]
      expect(host.text('complete-subagent:requests', parent)).toContain(`${id}`)
      await host.call('answer_write_request', parent, { request_id: id, decision: 'deny' })
      await expect(asked).resolves.toMatchObject({ decision: 'deny' })

      // A child the confined one starts by other means stays confined, even one
      // started with another preset, which then sees none of the plugin.
      const inherited = host.live(childAgent('g1', child), 'dsh-assisstant')
      await host.emit('agent/created', { agent: inherited, source: 'new' })
      expect(host.resolve(inherited).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.text('complete-subagent:child', inherited)).toContain('cannot ask for more')
      const elsewhere = host.live(childAgent('g2', child), 'standard')
      await host.emit('agent/created', { agent: elsewhere, source: 'new' })
      expect(host.resolve(elsewhere).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.text('complete-subagent:child', elsewhere)).toBe('')
      for (const tool of ALL_TOOLS) expect(host.visible(tool, elsewhere), tool).toBe(false)
    })

    it('leaves agents of other presets alone: no tools, no prompt texts, no bindings', async () => {
      const root = tempDir()
      // Bindings left from a time the plugin served every preset: an outsider's
      // own child, bound before the plugin reads the store.
      new BindingStore(defaultStoreDirectory()).set({ version: 1, child: 'o1-kid', parent: 'o1', workspace: null, grants: [] })
      const host = fakeHost(root)
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const outsider = host.live(parentAgent('o1', root), 'standard')
      const unrecorded = host.live(parentAgent('n1', root))
      const kid = host.live(childAgent('o1-kid', outsider), 'standard')
      for (const agent of [outsider, unrecorded, kid]) {
        for (const tool of ALL_TOOLS) expect(host.visible(tool, agent), `${tool} for ${agent.id}`).toBe(false)
        expect(host.text('complete-subagent:child', agent)).toBe('')
      }

      const asked = host.call('request_write_access', kid, { paths: ['../notes.md'], reason: 'r' })
      await vi.waitFor(() => expect(host.messages).toHaveLength(1))
      expect(host.text('complete-subagent:requests', outsider)).toBe('')
      expect(host.visible('answer_write_request', outsider)).toBe(false)
      const id = /wr-[0-9a-f]+/u.exec(host.messages[0])?.[0]
      await host.call('answer_write_request', outsider, { request_id: id, decision: 'deny' })
      await expect(asked).resolves.toMatchObject({ decision: 'deny' })

      for (const [id, parent] of [['o1-other', outsider], ['o1-grandkid', kid]] as const) {
        const started = host.live(childAgent(id, parent), 'standard')
        await host.emit('agent/created', { agent: started, source: 'new' })
        expect(host.resolve(started).workspaceRoot).toBe(root)
        expect(new BindingStore(defaultStoreDirectory()).get(id)).toBeUndefined()
      }
    })
  })

  describe('with the childPreset setting', () => {
    it('starts delegate children on that preset, where they ask a router parent for access', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], ['dsh-assisstant', 'dsh-assisstant-worker'], 'dsh-assisstant-worker') as never)
      const router = host.live(parentAgent('p1', root), 'dsh-assisstant')
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, router), tool).toBe(true)

      await host.call('delegate', router, { description: 'x', prompt: 'y', cwd: 'sub' })
      const { spec } = host.started[0]
      expect(spec.request.agentPreset).toBe('dsh-assisstant-worker')
      const worker = childAgent(spec.childId, router)
      expect(host.presets.get(worker.id)).toBe('dsh-assisstant-worker')
      expect(host.resolve(worker).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.visible('request_write_access', worker)).toBe(true)
      expect(host.text('complete-subagent:child', worker)).toContain(`Sub-workspace: ${join(root, 'sub')}.`)

      const asked = host.call('request_write_access', worker, { paths: ['../notes.md'], reason: 'r' })
      await vi.waitFor(() => expect(host.messages).toHaveLength(1))
      const id = /wr-[0-9a-f]+/u.exec(host.messages[0])?.[0]
      expect(host.text('complete-subagent:requests', router)).toContain(`${id}`)
      await host.call('answer_write_request', router, { request_id: id, decision: 'allow' })
      await expect(asked).resolves.toMatchObject({ decision: 'allow', granted: [{ path: join(root, 'notes.md'), kind: 'file' }] })
    })

    it('never selects a preset for delegate_fork children, or when it is empty', async () => {
      const root = tempDir()
      const forking = fakeHost(root)
      apply(forking.ctx as never, config([], [], 'dsh-assisstant-worker') as never)
      const parent = forking.live(parentAgent('p1', root), 'dsh-assisstant')
      await forking.call('delegate_fork', parent, { description: 'x', prompt: 'y' })
      expect(forking.started[0].spec).toMatchObject({ provider: 'fork' })
      expect(forking.started[0].spec.request.agentPreset).toBeUndefined()

      const empty = fakeHost(root)
      apply(empty.ctx as never, config([], [], '  ') as never)
      await empty.call('delegate', empty.live(parentAgent('p2', root), 'dsh-assisstant'), { description: 'x', prompt: 'y' })
      expect(empty.started[0].spec.request.agentPreset).toBeUndefined()
    })
  })

  describe('with the ownModel setting off', () => {
    const PRO: ChildModel = { provider: 'ds', model: 'pro', reasoningEfforts: ['high'] }
    const MINI: ChildModel = { provider: 'ds', model: 'mini', reasoningEfforts: [] }
    const onRoute = (id: string, root: string) => {
      const parent = parentAgent(id, root)
      return { ...parent, session: { ...parent.session, requestHeader: () => ({ config: { provider: 'ds', model: 'flash', reasoningEffort: 'max' } }) } }
    }

    it('starts delegate children on the first listed model and refuses the parent\'s own', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([PRO, MINI], [], '', false) as never)
      const parent = onRoute('p1', root)
      await host.call('delegate', parent, { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toEqual({ provider: 'ds', model: 'pro' })
      await host.call('delegate', parent, { description: 'd', prompt: 'go', model: 'ds/mini', reasoning_effort: 'low' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toEqual({ provider: 'ds', model: 'mini', reasoningEffort: 'low' })
      await host.call('delegate', parent, { description: 'd', prompt: 'go', reasoning_effort: 'high' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toEqual({ provider: 'ds', model: 'pro', reasoningEffort: 'high' })
      const before = host.started.length
      await expect(host.call('delegate', parent, { description: 'd', prompt: 'go', model: 'ds/flash' })).rejects.toThrow('must be one of ["ds/pro","ds/mini"]')
      expect(host.started).toHaveLength(before)
      const definition = host.tools.get('delegate')?.definition
      expect(definition?.description).not.toContain('your own model;')
      expect(definition?.description).toContain('never your own')
      expect(JSON.stringify(properties(definition).model)).not.toContain('your own')
    })

    it('leaves delegate_fork as it was', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([PRO], [], '', false) as never)
      const parent = onRoute('p1', root)
      await host.call('delegate_fork', parent, { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toBeUndefined()
      await host.call('delegate_fork', parent, { description: 'd', prompt: 'go', reasoning_effort: 'low' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'low' })
      expect(host.tools.get('delegate_fork')?.definition.description).toContain('omit `model` to give the child your own model')
    })

    it('inherits the parent\'s model while the list is empty', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], [], '', false) as never)
      await host.call('delegate', onRoute('p1', root), { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toBeUndefined()
      expect(host.tools.get('delegate')?.definition.description).toContain('Model: the child uses your own model.')
    })
  })

  describe('the completeSubagent service', () => {
    const WORKER = 'worker'
    const LIST = [{ provider: 'ds', model: 'pro' }, { provider: 'ds', model: 'mini', reasoningEfforts: ['low'] }]

    it('replaces the configured list and rebuilds the delegation tools', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      const settings = config([{ provider: 'ds', model: 'configured', reasoningEfforts: [] }], ['router', WORKER], WORKER, false)
      apply(host.ctx as never, settings as never)
      const parent = host.live(parentAgent('p1', root), 'router')
      const before = host.tools.get('delegate')?.definition
      host.service().setChildModels(LIST)
      const after = host.tools.get('delegate')?.definition
      expect(after).not.toBe(before)
      expect(properties(after).model?.enum).toEqual(['ds/pro', 'ds/mini'])
      expect(after?.description).toContain('- ds/pro: any effort it supports')
      expect(after?.description).toContain('- ds/mini: efforts low')
      expect(after?.description).not.toContain('ds/configured')
      await host.call('delegate', parent, { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request).toMatchObject({ agentOptions: { provider: 'ds', model: 'pro' }, agentPreset: WORKER })
      await expect(host.call('delegate', parent, { description: 'd', prompt: 'go', model: 'ds/configured' })).rejects.toThrow('must be one of ["ds/pro","ds/mini"]')
    })

    it('keeps the list through a settings change, skips a rebuild for the same list, and keeps a later one', async () => {
      const host = fakeHost(tempDir())
      const settings = config([], [], WORKER, false)
      apply(host.ctx as never, settings as never)
      host.service().setChildModels(LIST)
      const first = host.tools.get('delegate')?.definition
      host.service().setChildModels(LIST)
      settings.models.value = [{ provider: 'ds', model: 'configured', reasoningEfforts: [] }]
      await host.emit('loader/volatile-update')
      expect(host.tools.get('delegate')?.definition).toBe(first)
      host.service().setChildModels([{ provider: 'ds', model: 'next' }])
      expect(properties(host.tools.get('delegate')?.definition).model?.enum).toEqual(['ds/next'])
    })

    it('falls back to the parent\'s model when set to nothing usable', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], [], WORKER, false) as never)
      host.service().setChildModels(LIST)
      host.service().setChildModels([{ provider: '', model: 'x' }, null] as never)
      expect(properties(host.tools.get('delegate')?.definition).model).toBeUndefined()
      await host.call('delegate', parentAgent('p1', root), { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request.agentOptions).toBeUndefined()
    })

    it('does nothing on a copy without childPreset', () => {
      const host = fakeHost(tempDir())
      apply(host.ctx as never, config([{ provider: 'ds', model: 'mine', reasoningEfforts: [] }]) as never)
      const before = host.tools.get('delegate')?.definition
      host.service().setChildModels(LIST)
      expect(host.tools.get('delegate')?.definition).toBe(before)
      expect(properties(before).model?.enum).toEqual(['ds/mine'])
    })

    it('goes away on dispose and ignores a caller that kept it', () => {
      const host = fakeHost(tempDir())
      apply(host.ctx as never, config([], [], WORKER) as never)
      const service = host.service()
      host.dispose()
      expect(host.services.has('completeSubagent')).toBe(false)
      service.setChildModels(LIST)
      expect(host.tools.size).toBe(0)
    })

    it('reports a rebuild failure instead of throwing at the caller', () => {
      const host = fakeHost(tempDir())
      apply(host.ctx as never, config([], [], WORKER) as never)
      host.failing.add('register')
      expect(() => host.service().setChildModels(LIST)).not.toThrow()
      expect(host.warnings.join('\n')).toMatch(/rebuilding/u)
    })

    it('keeps the plugin working when another copy holds the service name', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      host.failing.add('provide')
      apply(host.ctx as never, config() as never)
      expect(host.warnings.join('\n')).toMatch(/providing the service failed/u)
      await host.call('delegate', parentAgent('p1', root), { description: 'd', prompt: 'go' })
      expect(host.started).toHaveLength(1)
    })

    it('works the same on a host without conditional tools (0.2.1-rc.5)', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['router', WORKER], WORKER, false) as never)
      const router = host.live(parentAgent('p1', root), 'router')
      const other = host.live(parentAgent('p2', root), 'standard')
      await host.emit('agent/created', { agent: router })
      await host.emit('agent/created', { agent: other })
      host.service().setChildModels(LIST)
      expect(host.visible('delegate', router)).toBe(true)
      expect(host.visible('delegate', other)).toBe(false)
      await host.call('delegate', router, { description: 'd', prompt: 'go' })
      expect(host.started.at(-1)?.spec.request).toMatchObject({ agentOptions: { provider: 'ds', model: 'pro' }, agentPreset: WORKER })
    })
  })

  describe('on a host without conditional tools or the preset method (0.2.1-rc.5)', () => {
    const created = async (host: ReturnType<typeof fakeHost>, agent: AgentLike) => {
      await host.emit('agent/created', { agent, source: 'new' })
      return agent
    }

    it('reads presets from the projection and hides every tool from other presets', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const served = await created(host, host.live(parentAgent('p1', root), 'dsh-assisstant'))
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, served), tool).toBe(true)
      expect(host.visible('request_write_access', served)).toBe(false)
      for (const agent of [host.live(parentAgent('o1', root), 'standard'), host.live(parentAgent('n1', root))]) {
        await created(host, agent)
        for (const tool of ALL_TOOLS) expect(host.visible(tool, agent), `${tool} for ${agent.id}`).toBe(false)
        expect(host.text('complete-subagent:child', agent)).toBe('')
      }
      expect(host.projectionReads()).toBeGreaterThan(0)
      expect(host.presetReads()).toBe(0)
    })

    it('runs a router and its workers, and a grant reaches the worker\'s file tools', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['dsh-assisstant', 'dsh-assisstant-worker'], 'dsh-assisstant-worker') as never)
      const router = await created(host, host.live(parentAgent('p1', root), 'dsh-assisstant'))
      await host.call('delegate', router, { description: 'x', prompt: 'y', cwd: 'sub' })
      const { spec } = host.started[0]
      expect(spec.request.agentPreset).toBe('dsh-assisstant-worker')
      const worker = host.agent(spec.childId)
      expect(host.resolve(worker).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.visible('request_write_access', worker)).toBe(true)
      expect(host.visible('delegate', worker)).toBe(false)
      // The filter on the router must not reach its worker, and the reverse.
      expect(host.visible('request_write_access', router)).toBe(false)
      expect(host.visible('delegate', router)).toBe(true)

      const asked = host.call('request_write_access', worker, { paths: ['../notes.md'], reason: 'r' })
      await vi.waitFor(() => expect(host.messages).toHaveLength(1))
      const id = /wr-[0-9a-f]+/u.exec(host.messages[0])?.[0]
      expect(host.text('complete-subagent:requests', router)).toContain(`${id}`)
      await host.call('answer_write_request', router, { request_id: id, decision: 'allow' })
      await expect(asked).resolves.toMatchObject({ decision: 'allow', granted: [{ path: join(root, 'notes.md'), kind: 'file' }] })
      const write: ToolCallLike = { callId: 'c', name: 'write', arguments: { file_path: join(root, 'notes.md') }, agent: worker, signal: new AbortController().signal }
      expect(withinCall(write, () => host.resolve(worker)).workspaceRoot).toBe(root)
      expect(host.resolve(worker).workspaceRoot).toBe(join(root, 'sub'))
    })

    it('serves every agent without reading a preset when the list is empty', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config() as never)
      const parent = await created(host, host.live(parentAgent('p1', root)))
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, parent), tool).toBe(true)
      expect(host.visible('request_write_access', parent)).toBe(false)
      expect(host.projectionReads()).toBe(0)
    })

    it('follows a preset selection and each step, and lifts its filters on dispose', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const agent = await created(host, host.live(parentAgent('p1', root)))
      expect(host.visible('delegate', agent)).toBe(false)

      host.presets.set(agent.id, 'dsh-assisstant')
      await host.emit('agent-preset/selected', agent.id, 'dsh-assisstant')
      for (const tool of PARENT_TOOLS) expect(host.visible(tool, agent), tool).toBe(true)

      host.presets.set(agent.id, 'standard')
      await expect(host.listener('agent/pre-step')({ agent }, async () => 'entered')).resolves.toBe('entered')
      expect(host.visible('delegate', agent)).toBe(false)

      host.dispose()
      expect(host.filters.get(agent.id)).toEqual([])
    })

    it('filters agents that were already live when it loaded', () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      const running = host.live(parentAgent('o1', root), 'standard')
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      expect(host.visible('delegate', running)).toBe(false)
    })

    it('stops tracking a disposed agent', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const agent = await created(host, host.live(parentAgent('o1', root), 'standard'))
      const [filter] = host.filters.get(agent.id) ?? []
      await host.emit('agent/disposed', { agent })
      host.dispose()
      expect(host.filters.get(agent.id)).toEqual([filter])
    })

    it('tells a child that only its file tools reach its grants', async () => {
      const root = tempDir()
      const directory = tempDir()
      const message = 'Also granted by your parent (write and edit tools only, not shell commands):'
      for (const legacy of [true, false]) {
        const host = fakeHost(root, { legacy })
        apply(host.ctx as never, config() as never)
        await host.call('delegate', host.live(parentAgent('p1', root)), { description: 'x', prompt: 'y', cwd: 'sub', writable_paths: [directory] })
        const text = host.text('complete-subagent:child', host.agent(host.started[0].spec.childId))
        expect(text.includes(`${message} ${directory}`)).toBe(legacy)
        expect(text.includes(`(any tool): ${directory}`)).toBe(!legacy)
      }
    })
  })

  describe('when something fails inside the plugin', () => {
    it('still starts agents, and confines a child whose parent\'s preset cannot be read', async () => {
      const root = tempDir()
      const host = fakeHost(root)
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      const parent = host.live(parentAgent('p1', root), 'dsh-assisstant')
      await host.call('delegate', parent, { description: 'x', prompt: 'y', cwd: 'sub' })
      const child = childAgent(host.started[0].spec.childId, parent)
      host.failing.add('agents')
      const grandchild = childAgent('g1', child)
      await expect(host.emit('agent/created', { agent: grandchild, source: 'new' })).resolves.toBeUndefined()
      expect(host.resolve(grandchild).workspaceRoot).toBe(join(root, 'sub'))
      expect(host.warnings.join('\n')).toMatch(/parent preset/u)
    })

    it('shows an agent it cannot read no tools and no text, without throwing', () => {
      const host = fakeHost(tempDir())
      apply(host.ctx as never, config() as never)
      const boom = (): never => { throw new Error('boom') }
      const broken = { get id() { return boom() }, session: { get id() { return boom() }, get header() { return boom() } } } as unknown as AgentLike
      for (const tool of ALL_TOOLS) expect(host.visible(tool, broken), tool).toBe(false)
      expect(host.text('complete-subagent:child', broken)).toBe('')
      expect(host.text('complete-subagent:requests', broken)).toBe('')
      expect(host.warnings.length).toBeGreaterThan(0)
    })

    it('keeps going when rebuilding the tools fails', () => {
      const host = fakeHost(tempDir())
      const settings = config()
      apply(host.ctx as never, settings as never)
      host.failing.add('register')
      settings.models.value = [{ provider: 'deepseek', model: 'pro', reasoningEfforts: [] }]
      expect(() => host.listener('loader/volatile-update')()).not.toThrow()
      expect(host.warnings.join('\n')).toMatch(/rebuilding/u)
    })

    it('lets a step go on when a tool filter cannot be updated', async () => {
      const root = tempDir()
      const host = fakeHost(root, { legacy: true })
      apply(host.ctx as never, config([], ['dsh-assisstant']) as never)
      await expect(host.listener('agent/pre-step')({ agent: parentAgent('no-context', root) }, async () => 'entered')).resolves.toBe('entered')
      expect(host.warnings.join('\n')).toMatch(/tool filter/u)
    })
  })

  it('stays disabled, with a warning, when the host has no prototype resolve', () => {
    const host = fakeHost(tempDir(), { ownResolve: true })
    apply(host.ctx as never, config() as never)
    expect(host.warnings.join('\n')).toMatch(/disabled/u)
    expect(host.tools.size).toBe(0)
    expect(host.providers.size).toBe(0)
  })
})
