/**
 * The model-facing write-access tools: a bound child's `request_write_access`,
 * and its parent's `answer_write_request`, `grant_write_access`, and
 * `revoke_write_access`.
 *
 * A request reaches the parent through the host's adjacent-agent channel
 * (`ctx.subagents.sendMessage`): a running parent sees it at its next step, an
 * idle parent starts a turn. The child's call then waits for the answer, so a
 * granted child continues in the same turn. A parent can also grant or revoke
 * without a request; the child reads its current access in its runtime context
 * at every step, and the fence applies it to the next capability call.
 * @module complete-subagent/host/tools
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Fence } from './policy.ts';
import type { RequestBroker, WriteRequest } from './requests.ts';
import type { BindingStore } from './store.ts';
import { ANSWER_TOOL, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL } from './types.ts';
import type { SandboxPolicy, SessionLike, SubagentsLike, WorkingDirectoryLike } from './types.ts';
export { ANSWER_TOOL, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL };
/** What the tools read. */
export interface ToolDeps {
    readonly store: BindingStore;
    readonly fence: Fence;
    readonly broker: RequestBroker;
    readonly subagents: SubagentsLike;
    readonly workingDirectory: WorkingDirectoryLike;
    /** The session's enforced (already narrowed) sandbox policy. */
    readonly resolvePolicy: (session: SessionLike) => SandboxPolicy;
    /** How long a parent has to answer. */
    readonly timeoutMs: () => number;
}
/** The message the parent receives. */
export declare function requestMessage(request: WriteRequest, timeoutMs: number): string;
/**
 * The child-side tool.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export declare function createRequestTool(deps: ToolDeps): ToolDefinition;
/**
 * The parent-side answer.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export declare function createAnswerTool(deps: ToolDeps): ToolDefinition;
/**
 * The parent-side grant without a request.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export declare function createGrantTool(deps: ToolDeps): ToolDefinition;
/**
 * The parent-side revocation.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export declare function createRevokeTool(deps: ToolDeps): ToolDefinition;
