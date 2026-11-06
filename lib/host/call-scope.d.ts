/**
 * The tool call whose body is running, for code that the body reaches only
 * indirectly. The sandbox policy is resolved deep inside a tool body with just a
 * session, so a single-file grant can only be honored if the fence can see which
 * call, and which target, asked. A `tools/execute` waterfall listener enters this
 * scope around each body; async work started by the body inherits it.
 * @module complete-subagent/host/call-scope
 */
import type { ToolCallLike } from './types.ts';
/**
 * The call whose body is running in this async context.
 * @returns the call, or undefined outside a tool body.
 */
export declare function currentCall(): ToolCallLike | undefined;
/**
 * Run a tool body inside the scope of its call.
 * @param call - the dispatching call.
 * @param run - the body (the waterfall's `next`).
 * @returns whatever the body returns.
 */
export declare function withinCall<T>(call: ToolCallLike, run: () => T): T;
