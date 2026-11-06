/**
 * The delegation tools: `delegate` starts a fresh child on the host's `spawn`
 * backend, `delegate_fork` one that inherits this conversation on `fork`.
 *
 * Children run on the host's own subagent runtime, so `send_message`,
 * `list_agents`, `interrupt_agent`, the child conversations in the UI, result
 * notices, and cold resume all work as they do for the official tools. The
 * call decides the child's access and route first, stores the binding under a
 * reserved child id, and only then starts the child, so the fence applies from
 * the child's first step and no binding has to be matched afterwards.
 * @module complete-subagent/host/delegate
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ChildModel } from '../shared/settings.ts';
import type { AccessDeps } from './access.ts';
import type { AgentLike, DelegateTool, LlmLike, SubagentsLike } from './types.ts';
/** What the delegation tools read. */
export interface DelegateDeps extends AccessDeps {
    readonly subagents: SubagentsLike;
    /** The LLM runtime, read at call time because it is optional. */
    readonly llm: () => LlmLike | undefined;
    /** Reserves child ids; replaceable in tests. */
    readonly newId?: () => string;
    /** Agent preset a `delegate` child runs; undefined keeps the parent's. */
    readonly childPreset?: string;
    /** False keeps a `delegate` child off the parent's own model when models are listed. */
    readonly ownModel?: boolean;
}
/**
 * Build one delegation tool for the current settings. The model list is fixed
 * into the schema, so the entry rebuilds the tools when the settings change.
 * @param tool - which tool.
 * @param models - the settings' model list.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export declare function createDelegateTool(tool: DelegateTool, models: readonly ChildModel[], deps: DelegateDeps): ToolDefinition;
/**
 * Whether an agent may delegate on a backend now: the backend is registered
 * and the agent is below the user's depth limit. A limit that cannot be read
 * leaves the tool visible; the runtime then rejects the start.
 * @param subagents - the subagent runtime.
 * @param tool - which tool.
 * @param agent - the would-be parent.
 * @returns true when the tool should be offered.
 */
export declare function canStart(subagents: SubagentsLike, tool: DelegateTool, agent: AgentLike): boolean;
