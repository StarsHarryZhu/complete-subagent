/**
 * complete-subagent host plugin.
 *
 * Adds its own delegation tools beside the official ones: `delegate` (a fresh
 * child) and `delegate_fork` (a child that inherits the conversation). The
 * `cwd` a parent passes becomes the child's sub-workspace, `writable_paths`
 * grants more up front, and the child may modify nothing else (besides temp
 * directories). For anything else it asks with `request_write_access`; the
 * parent answers with `answer_write_request`, and can grant or revoke at any
 * time with `grant_write_access` / `revoke_write_access`. A parent may also
 * pick the child's model and reasoning effort among those the user lists in
 * the settings. Children run on the host's subagent runtime; the fence narrows
 * the sandbox policy the host already enforces, and anything a confined agent
 * starts by other means is confined the same way. A bundle that mounts the
 * plugin for its own agent preset sets `presets`, and agents of other presets
 * then see none of it; it may also set `childPreset`, the preset `delegate`
 * children run, `ownModel: false`, which keeps those children on the listed
 * models, and the list itself at run time through the `completeSubagent` service.
 * @module complete-subagent
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, PLUGIN_ID, readChildPreset, readModels, readOwnModel, readPresets, readTimeout } from './shared/settings.ts'
import type { ChildModel, ChildModelInput } from './shared/settings.ts'
import { withinCall } from './host/call-scope.ts'
import { canStart, createDelegateTool } from './host/delegate.ts'
import { isLegacyHost, ToolRestrictions } from './host/legacy.ts'
import { Fence, patchResolve } from './host/policy.ts'
import { childContext, pendingContext } from './host/prompt.ts'
import { RequestBroker } from './host/requests.ts'
import { presetScope } from './host/scope.ts'
import { BindingStore, defaultStoreDirectory } from './host/store.ts'
import { createAnswerTool, createGrantTool, createRequestTool, createRevokeTool } from './host/tools.ts'
import { ANSWER_TOOL, DELEGATE_TOOLS, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL } from './host/types.ts'
import type {
  AgentLike,
  AgentPresetsLike,
  AgentsLike,
  DelegateTool,
  LlmLike,
  SandboxPolicyServiceLike,
  SessionProjectionsLike,
  SubagentsLike,
  ToolCallLike,
  WorkingDirectoryLike,
} from './host/types.ts'

export const name = PLUGIN_ID
export const inject = ['tools', 'subagents', 'sandboxPolicy', 'workingDirectory', 'systemPrompt']

export interface Config {
  /** Seconds a parent has to answer a write-access request before it counts as denied. */
  requestTimeoutSeconds: Volatile<number>
  /** Models a parent may choose for a child, with the efforts each allows. */
  models: Volatile<ChildModel[]>
  /** Agent presets whose agents the plugin serves; empty serves every agent. */
  presets: string[]
  /** Agent preset `delegate` children run; empty keeps the parent's. */
  childPreset: string
  /** False keeps `delegate` children off the parent's own model when models are listed. */
  ownModel: boolean
}

/** `ctx.completeSubagent`: what a bundle that mounts this plugin can change at run time. */
export interface CompleteSubagentService {
  /**
   * Replace the `models` setting until the row reloads, so call it whenever the
   * service appears. Does nothing on a copy without `childPreset`: that is a
   * standalone install, whose list belongs to the user's normal sessions.
   * @param models - the models a parent may choose for a child, in order.
   */
  setChildModels(models: readonly ChildModelInput[]): void
}

export const Config: z<Config> = z.object({
  requestTimeoutSeconds: z.natural().min(MIN_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS)
    .description('Seconds a parent agent has to answer a write-access request before it counts as denied').volatile(),
  models: z.array(z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
    reasoningEfforts: z.array(z.string().min(1)).default([]),
  })).default([])
    .description('Models a parent may choose for a child; an empty effort list allows every effort the model supports').volatile(),
  presets: z.array(z.string().min(1)).default([])
    .description('Agent presets whose agents get the tools and prompt texts; empty means every preset'),
  childPreset: z.string().default('')
    .description('Agent preset that children started with delegate run; empty keeps the parent\'s. delegate_fork children always keep it'),
  ownModel: z.boolean().default(true)
    .description('Whether delegate children may run the parent\'s own model. Off, with models listed, they run the first listed model unless the parent names another; delegate_fork children are not affected'),
}) as unknown as z<Config>

/** `AssembleContext` fields the prompt providers read. */
interface AssemblyLike {
  readonly agent?: AgentLike
  readonly scope?: object
}

/** The services this plugin reads, beyond what cordis types. */
interface HostContext {
  readonly tools: {
    register(definition: ToolDefinition, options?: { when?: (context: { agent: AgentLike }) => boolean }): () => void
    get(name: string, scope?: object): ToolDefinition | undefined
    /** Checks each `when` before a step; missing from a host that ignores `when`. */
    readonly resolve?: unknown
  }
  readonly subagents: SubagentsLike
  readonly sandboxPolicy: SandboxPolicyServiceLike
  readonly workingDirectory: WorkingDirectoryLike
  readonly systemPrompt: {
    context(context: { name: string; order: number; text: (context: AssemblyLike) => string; interpolate?: boolean; required?: boolean }): () => void
    getContextOrder(name: 'SUBAGENT_DELEGATION'): number
  }
  get(name: 'llm'): LlmLike | undefined
  get(name: 'agentPresets'): AgentPresetsLike | undefined
  get(name: 'sessionProjections'): SessionProjectionsLike | undefined
  get(name: 'agents'): AgentsLike | undefined
  provide(name: 'completeSubagent', value: CompleteSubagentService): () => void
  // oxlint-disable-next-line typescript/no-explicit-any -- host events are typed by packages this plugin does not import.
  on(name: string, listener: (...args: any[]) => unknown): () => void
}

/** The agent an assembly is for: `agent` when the host sets it, else the agent scope key. */
function agentOf(context: AssemblyLike): AgentLike | undefined {
  if (context.agent !== undefined) return context.agent
  const scope = context.scope as Partial<AgentLike> | undefined
  return typeof scope?.id === 'string' && scope.session !== undefined ? scope as AgentLike : undefined
}

/** A live config value, or undefined when `apply` was called without the loader. */
function live(value: { get(): unknown } | undefined): unknown {
  return value?.get()
}

/**
 * Install the fence, the delegation tools, the write-access tools, and the
 * guidance.
 * @param ctx - the plugin context; the services in {@link inject} are present.
 * @param config - loaded settings.
 */
export function apply(ctx: Context, config: Config): void {
  const host = ctx as unknown as HostContext
  const timeoutMs = (): number => readTimeout(live(config?.requestTimeoutSeconds)) * 1000
  const childPreset = readChildPreset(config?.childPreset)
  let bundleModels: ChildModel[] | undefined
  const models = (): ChildModel[] => bundleModels ?? readModels(live(config?.models))
  const serves = presetScope(readPresets(config?.presets), {
    agentPresets: () => host.get('agentPresets'),
    sessionProjections: () => host.get('sessionProjections'),
  })
  const legacy = isLegacyHost(host.tools)
  const store = new BindingStore(defaultStoreDirectory())
  const broker = new RequestBroker()
  const resolvePolicy = (session: AgentLike['session']) => host.sandboxPolicy.resolve({ session })
  const warn = (message: string): void => {
    try {
      ctx.logger.warn(message)
    } catch {
      // A host call must not fail because its warning could not be logged.
    }
  }
  // The host calls these for every session of every preset, and a throw would
  // fail a step or stop an agent from starting. A plugin failure stays here.
  const guarded = <T>(label: string, fallback: T, run: () => T): T => {
    try {
      return run()
    } catch (error) {
      warn(`${PLUGIN_ID}: ${label} failed: ${String(error)}`)
      return fallback
    }
  }
  const fence = new Fence({ store, workingDirectory: host.workingDirectory, warn })

  let restore: () => void
  try {
    restore = patchResolve(host.sandboxPolicy, (policy, request) => fence.narrow(policy, request))
  } catch (error) {
    warn(`${PLUGIN_ID} is disabled: ${String(error)}`)
    return
  }
  ctx.effect(() => restore)
  // This listener adds no failure of its own; what `next` throws is the host's pipeline and stays its to handle.
  host.on('tools/execute', (call: ToolCallLike, next: () => Promise<unknown>) => withinCall(call, next))

  // A child that a confined agent starts by other means (the official tools,
  // a workflow) shares that agent's access instead of the whole project. Only
  // a served parent passes it on; a child judged without its live parent is
  // judged by its own preset, which it took from that parent. When the parent's
  // preset cannot be read, the child is confined rather than freed.
  host.on('agent/created', ({ agent }: { agent: AgentLike }) => {
    guarded('storing an inherited binding', undefined, () => {
      const { origin, parentSession } = agent.session.header
      if (origin !== 'subagent' || parentSession === undefined) return
      if (store.get(agent.id) !== undefined || store.get(parentSession) === undefined) return
      if (!guarded('reading the parent preset', true, () => serves((host.get('agents')?.get(parentSession) ?? agent).session))) return
      store.set({ version: 1, child: agent.id, parent: parentSession, workspace: null, grants: [], inherited: true })
    })
  })

  const tools = Object.keys(DELEGATE_TOOLS) as DelegateTool[]
  const canDelegate = (agent: AgentLike): boolean => serves(agent.session)
    && tools.some(tool => host.tools.get(tool, agent) !== undefined && canStart(host.subagents, tool, agent))
  const conditions = {
    delegate: (agent: AgentLike): boolean => serves(agent.session) && canStart(host.subagents, 'delegate', agent),
    delegate_fork: (agent: AgentLike): boolean => serves(agent.session) && canStart(host.subagents, 'delegate_fork', agent),
    [REQUEST_TOOL]: (agent: AgentLike): boolean => {
      const binding = store.get(agent.id)
      return binding !== undefined && binding.inherited !== true && serves(agent.session)
    },
    [ANSWER_TOOL]: (agent: AgentLike): boolean => canDelegate(agent) || (broker.pendingFor(agent.id).length > 0 && serves(agent.session)),
    [GRANT_TOOL]: canDelegate,
    [REVOKE_TOOL]: canDelegate,
  }
  type ToolName = keyof typeof conditions
  const visible = (tool: ToolName, agent: AgentLike): boolean => guarded(`the visibility check of ${tool}`, false, () => conditions[tool](agent))

  // The schema lists the configured models, so settings changes rebuild the tools.
  const deps = {
    store,
    fence,
    broker,
    subagents: host.subagents,
    workingDirectory: host.workingDirectory,
    resolvePolicy,
    timeoutMs,
    llm: () => host.get('llm'),
    childPreset,
    ownModel: readOwnModel(config?.ownModel),
  }
  let mounted: { key: string; dispose: () => void } | undefined
  const mount = (): void => {
    const list = models()
    const key = JSON.stringify(list)
    if (mounted?.key === key) return
    // Build first, so a definition that fails to build leaves the old tools in place.
    const definitions = tools.map(tool => createDelegateTool(tool, list, deps))
    mounted?.dispose()
    const disposers: (() => void)[] = []
    mounted = { key, dispose: () => { for (const dispose of disposers) dispose() } }
    definitions.forEach((definition, index) => {
      const tool = tools[index] as DelegateTool
      disposers.push(host.tools.register(definition, { when: ({ agent }) => visible(tool, agent) }))
    })
  }
  mount()
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    mounted?.dispose()
    mounted = undefined
  })
  host.on('loader/volatile-update', () => {
    guarded('rebuilding the delegation tools', undefined, mount)
  })
  // Another loaded copy already holds this name; that is a known limit, not a reason to stop.
  guarded('providing the service', undefined, () => host.provide('completeSubagent', {
    setChildModels(list) {
      if (childPreset === undefined || disposed) return
      bundleModels = readModels(list)
      guarded('rebuilding the delegation tools', undefined, mount)
    },
  }))

  ctx.effect(() => host.tools.register(createRequestTool(deps), { when: ({ agent }) => visible(REQUEST_TOOL, agent) }))
  ctx.effect(() => host.tools.register(createAnswerTool(deps), { when: ({ agent }) => visible(ANSWER_TOOL, agent) }))
  ctx.effect(() => host.tools.register(createGrantTool(deps), { when: ({ agent }) => visible(GRANT_TOOL, agent) }))
  ctx.effect(() => host.tools.register(createRevokeTool(deps), { when: ({ agent }) => visible(REVOKE_TOOL, agent) }))

  // This host drops `when`, so the same conditions become per-agent filters. A
  // step reads its tools before `agent/pre-step`, so a change seen there takes
  // effect on the agent's next step; a new agent is filtered before its first.
  if (legacy) {
    const restrictions = new ToolRestrictions(Object.keys(conditions), (tool, agent) => visible(tool as ToolName, agent))
    const sync = (agent: AgentLike): void => {
      guarded('updating the tool filter', undefined, () => restrictions.sync(agent))
    }
    ctx.effect(() => () => {
      guarded('lifting the tool filters', undefined, () => restrictions.dispose())
    })
    host.on('agent/created', ({ agent }: { agent: AgentLike }) => sync(agent))
    host.on('agent/pre-step', ({ agent }: { agent: AgentLike }, next: () => Promise<unknown>) => {
      sync(agent)
      return next()
    })
    host.on('agent-preset/selected', (sessionId: string) => {
      const agent = guarded('finding the agent of a preset selection', undefined, () => host.get('agents')?.get(sessionId))
      if (agent !== undefined) sync(agent)
    })
    host.on('agent/disposed', ({ agent }: { agent: AgentLike }) => restrictions.forget(agent))
    // Agents that were already running when the plugin loaded fire no `agent/created`.
    for (const agent of guarded('listing the live agents', [], () => host.get('agents')?.list?.() ?? [])) sync(agent)
  }

  ctx.effect(() => host.systemPrompt.context({
    name: `${name}:child`,
    order: host.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 1,
    interpolate: false,
    required: true,
    text: context => guarded('the child context', '', () => {
      const agent = agentOf(context)
      const binding = agent === undefined || !serves(agent.session) ? undefined : fence.bindingOf(agent.session)
      return binding === undefined ? '' : childContext(binding, !legacy)
    }),
  }))
  ctx.effect(() => host.systemPrompt.context({
    name: `${name}:requests`,
    order: host.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 2,
    interpolate: false,
    required: true,
    text: context => guarded('the requests context', '', () => {
      const agent = agentOf(context)
      return agent === undefined || !serves(agent.session) ? '' : pendingContext(broker.pendingFor(agent.id))
    }),
  }))
}
