/**
 * Structural mirrors of the host services this plugin reads.
 *
 * The plugin imports only `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, and
 * `@deepseek-ai/dsh-tools` at runtime, so these types mirror only the fields it
 * uses from `@deepseek-ai/dsh-session` (header), `@deepseek-ai/dsh-agent`,
 * `@deepseek-ai/dsh-agent-preset-registry`, `@deepseek-ai/dsh-session-projection`,
 * `@deepseek-ai/dsh-sandbox-policy`, `@deepseek-ai/dsh-working-directory`,
 * `@deepseek-ai/dsh-subagent`, and `@deepseek-ai/dsh-llm`. Each mirror names its
 * source for the next reader, and says so when a field is missing from the
 * oldest supported host, 0.2.1-rc.5.
 * @module complete-subagent/host/types
 */

/** `SessionHeader`: the immutable storage metadata of one session. */
export interface SessionHeaderLike {
  readonly id: string
  /** Absolute directory the session was created in; the sandbox workspace root. */
  readonly cwd?: string
  /** Direct creator of a subagent session. */
  readonly parentSession?: string
  /** `'subagent'` for a delegated child. */
  readonly origin?: 'subagent'
  /** Persisted delegation depth of a child (`delegationDepthOf`). */
  readonly delegationDepth?: number
}

/** The provider, model, and effort of one LLM route (`AgentOptions` / `LlmCallConfig`). */
export interface RouteLike {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** `Session`: identity, header, and the route of its next request. */
export interface SessionLike {
  readonly id: string
  readonly header: SessionHeaderLike
  /** The latest request header; its `config` is the session's current route. */
  requestHeader?(): { readonly config?: RouteLike } | undefined
}

/** `Agent`: a live agent; its id is its session id. */
export interface AgentLike {
  readonly id: string
  readonly session: SessionLike
  /** Creation options: the route before the first request, and a runtime depth. */
  readonly options?: RouteLike & { readonly subagentDepth?: number }
  /** The agent's scoped context; a restriction made through it covers this agent only. */
  readonly ctx?: {
    readonly tools?: { restrict(filter: { readonly deny: readonly string[] }): () => void }
  }
}

/** `ctx.agents` (`AgentRegistry` of `@deepseek-ai/dsh-agent`): live agents by id. */
export interface AgentsLike {
  get(id: string): AgentLike | undefined
  /** All live agents. */
  list?(): readonly AgentLike[]
}

/** `ctx.agentPresets` (`AgentPresetRegistry` of `@deepseek-ai/dsh-agent-preset-registry`). */
export interface AgentPresetsLike {
  /** The preset a session runs: its header's, or a later selection; null when none was recorded. Missing from 0.2.1-rc.5. */
  presetForSession?(session: SessionLike): string | null
}

/** `ctx.sessionProjections` (`SessionProjectionRegistry` of `@deepseek-ai/dsh-session-projection`). */
export interface SessionProjectionsLike {
  /** One projection's current state, or undefined when its key is not registered. */
  stateOf(session: SessionLike, key: string): unknown
}

/** `SandboxMode` of `@deepseek-ai/dsh-sandbox`. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** `SandboxExecutionPolicy`: what one confined capability call may write. */
export interface SandboxPolicy {
  readonly mode: SandboxMode
  readonly workspaceRoot: string
  readonly additionalWritableRoots?: readonly string[]
  readonly sessionId?: string
}

/** `SandboxPolicyRequest`. */
export interface SandboxPolicyRequest {
  readonly session?: SessionLike
  readonly mode?: SandboxMode
}

/** `ctx.sandboxPolicy` (`SandboxPolicyService`). */
export interface SandboxPolicyServiceLike {
  resolve(request?: SandboxPolicyRequest): SandboxPolicy
}

/** `ctx.workingDirectory` (`WorkingDirectoryService`). */
export interface WorkingDirectoryLike {
  /** Effective directory of a session, without repairing a vanished one. */
  get(session: SessionLike): string
  /** Effective directory of an agent, restoring the header cwd when it vanished. */
  ensure(agent: AgentLike, signal?: AbortSignal): Promise<string>
}

/** One text content block, the only kind this plugin authors. */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** `SubagentActivationSpec` with a reserved child id, as this plugin fills it. */
export interface ActivationSpecLike {
  /** Registered backend: `spawn` (fresh child) or `fork` (inherits the conversation). */
  readonly provider: string
  /** Short task label shown with the child. */
  readonly label: string
  /** Reserved child session id, so the child is bound before it exists. */
  readonly childId: string
  readonly request: {
    readonly cwd?: string
    readonly prompt: TextBlock[]
    readonly parent: AgentLike
    /** Preset the child runs instead of the parent's; only a backend that does not inherit the parent's context accepts it. */
    readonly agentPreset?: string
    readonly agentOptions?: RouteLike
    readonly maxDepth?: number
  }
  readonly signal: AbortSignal
  /** `parent`: the runtime notifies the parent model when the child finishes. */
  readonly delivery: 'parent'
}

/** `ctx.subagents` (`SubagentRuntime`). */
export interface SubagentsLike {
  /** Adjacent-agent messaging, for write-access requests. */
  sendMessage(sender: AgentLike, targetId: string, content: TextBlock[], options: { signal: AbortSignal }): Promise<unknown>
  /** Start a managed child; resolves once it is published. */
  startActivation(spec: ActivationSpecLike): Promise<{ readonly childId: string }>
  /** The user's delegation depth limit, or undefined when there is none. */
  resolveMaxDepth(): number | undefined
  /** A registered backend, or undefined. */
  getProvider(name: string): unknown
}

/** `LlmResolvedModelInfo`, reduced to its reasoning levels. */
export interface ModelInfoLike {
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string }[]
    readonly defaultEffort?: string
  }
}

/** `ctx.llm` (`LlmRuntime`). */
export interface LlmLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<ModelInfoLike>
  resolveCallConfig(config: RouteLike, signal?: AbortSignal): Promise<unknown>
}

/** `ToolExecution`: the fields the pipeline listeners read. */
export interface ToolCallLike {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: AgentLike
  readonly signal: AbortSignal
}

/** This plugin's delegation tools and the backend each starts children on. */
export const DELEGATE_TOOLS = {
  delegate: 'spawn',
  delegate_fork: 'fork',
} as const

/** A delegation tool name. */
export type DelegateTool = keyof typeof DELEGATE_TOOLS

/** The child's tool for asking its parent. */
export const REQUEST_TOOL = 'request_write_access'
/** The parent's tool for answering a request. */
export const ANSWER_TOOL = 'answer_write_request'
/** The parent's tool for granting without a request. */
export const GRANT_TOOL = 'grant_write_access'
/** The parent's tool for taking grants back. */
export const REVOKE_TOOL = 'revoke_write_access'
