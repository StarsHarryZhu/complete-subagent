/**
 * Turning model-written paths into grants.
 *
 * Grants come from three places: `writable_paths` on a delegation call, an
 * `answer_write_request` that allows, and `grant_write_access`. All three follow
 * one rule: an agent may grant only what its own, possibly narrowed, policy lets
 * it modify, which makes grants nest — a grandchild's need beyond its parent's
 * reach must first be requested one level up.
 * @module complete-subagent/host/grants
 */
import type { Fence } from './policy.ts';
import type { RequestedPath } from './requests.ts';
import type { BindingStore, Grant } from './store.ts';
import type { AgentLike, SandboxPolicy } from './types.ts';
/**
 * Resolve model-written paths against an agent's directory. A path names a
 * directory when it ends in "/" or already is one.
 * @param base - the agent's current directory.
 * @param paths - relative or absolute paths as the model wrote them.
 * @returns canonical paths with their kind.
 */
export declare function requestedPaths(base: string, paths: readonly string[]): RequestedPath[];
/** What {@link issueGrants} checks against. */
export interface IssueOptions {
    readonly fence: Fence;
    readonly store: BindingStore;
    /** The granting agent. */
    readonly grantor: AgentLike;
    /** The grantor's enforced (already narrowed) policy. */
    readonly policy: SandboxPolicy;
    readonly targets: readonly RequestedPath[];
    /** Recorded on each grant: a request id, or `spawn` for `writable_paths`. */
    readonly requestId: string;
}
/**
 * Check that the grantor may modify every target, create missing directories,
 * and build the grants. Nothing is created unless every target passes.
 * @param options - grantor, policy, and targets.
 * @returns one grant per target.
 * @throws when a target is beyond the grantor's reach, naming where to ask instead.
 */
export declare function issueGrants(options: IssueOptions): Grant[];
/**
 * One granted path as the model reads it.
 * @param grant - the path and its kind.
 * @returns a list line.
 */
export declare function grantLine(grant: {
    path: string;
    kind: 'dir' | 'file';
}): string;
