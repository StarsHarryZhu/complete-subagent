/**
 * What a new child may modify, decided from the delegation call's `cwd` and
 * `writable_paths` before the child exists.
 *
 * A `cwd` the parent may modify becomes the child's sub-workspace and is created
 * if missing; no `cwd`, or one outside the parent's writable area, gives the
 * child none. `writable_paths` become grants, checked against the parent's own
 * reach, so nothing outside it can be handed down.
 * @module complete-subagent/host/access
 */
import type { Fence } from './policy.ts';
import type { BindingStore, Grant } from './store.ts';
import type { AgentLike, SandboxPolicy, SessionLike, WorkingDirectoryLike } from './types.ts';
/** What {@link decideAccess} reads. */
export interface AccessDeps {
    readonly store: BindingStore;
    readonly fence: Fence;
    readonly workingDirectory: WorkingDirectoryLike;
    /** The session's enforced (already narrowed) sandbox policy. */
    readonly resolvePolicy: (session: SessionLike) => SandboxPolicy;
}
/** One delegation call's access arguments, unvalidated. */
export interface AccessRequest {
    readonly parent: AgentLike;
    readonly cwd: unknown;
    readonly writablePaths: unknown;
    readonly signal?: AbortSignal;
}
/** The decided access of a child that is about to start. */
export interface ChildAccess {
    /** Directory to start the child in; undefined inherits the parent's. */
    readonly cwd?: string;
    /** Canonical sub-workspace, or null for none. */
    readonly workspace: string | null;
    /** Grants from `writable_paths`. */
    readonly grants: readonly Grant[];
}
/**
 * Decide a new child's sub-workspace and grants, creating the sub-workspace and
 * any granted directory that does not exist yet.
 * @param deps - store, fence, and host services.
 * @param request - the call's parent and arguments.
 * @returns the child's access and start directory.
 * @throws with a model-facing reason when the call must not run.
 */
export declare function decideAccess(deps: AccessDeps, request: AccessRequest): Promise<ChildAccess>;
