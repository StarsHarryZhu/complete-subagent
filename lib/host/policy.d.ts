/**
 * The write fence: narrows a bound child's sandbox policy to its sub-workspace
 * plus what its parent granted.
 *
 * Every enforcing capability (bash's OS sandbox, the fs write fence, terminals,
 * PTC) asks `ctx.sandboxPolicy.resolve({ session })` for each call, and the
 * host's child agents copy the parent's header cwd, so by default a child may
 * write anywhere in the parent's project. {@link patchResolve} wraps the
 * service's prototype method, so every holder of the service, including ones
 * that captured it at load, sees the narrowed policy; disposing restores it.
 * @module complete-subagent/host/policy
 */
import type { Binding, BindingStore } from './store.ts';
import type { SandboxPolicy, SandboxPolicyRequest, SessionLike, WorkingDirectoryLike } from './types.ts';
/** What the fence reads besides the store. */
export interface FenceOptions {
    readonly store: BindingStore;
    /** Effective directories, for relative file-tool targets. */
    readonly workingDirectory?: WorkingDirectoryLike;
    /** Reports a failure that made the fence fall back to read-only. */
    readonly warn?: (message: string) => void;
}
/** Narrows policies for bound children and answers "may this agent modify that path". */
export declare class Fence {
    private readonly options;
    private readonly temp;
    constructor(options: FenceOptions);
    /**
     * The binding in force for a session. An inherited binding takes the access
     * of the nearest ancestor with a binding of its own, as that ancestor holds it
     * now; a broken chain leaves no access (fail closed).
     * @param session - any session.
     * @returns the binding, or undefined for sessions the fence leaves alone.
     */
    bindingOf(session: SessionLike): Binding | undefined;
    /**
     * Narrow one resolved policy. Unbound sessions pass through untouched; a
     * bound child gets `workspace-write` rooted at its sub-workspace (or the temp
     * directory when it has none) and its directory grants as extra roots. The
     * one `write`/`edit` call whose target was granted is rooted at that grant
     * instead, because a host older than 0.2.2-alpha.2 reads only `workspaceRoot`.
     * `read-only` stays read-only. A failure falls back to read-only for subagent
     * sessions rather than widening anything, and stays within that one session.
     * @param policy - the host's resolved policy.
     * @param request - the resolve request (its session decides).
     * @returns the policy to enforce.
     */
    narrow(policy: SandboxPolicy, request: SandboxPolicyRequest): SandboxPolicy;
    /**
     * Whether a session may itself modify a path, judged by its own (possibly
     * narrowed) policy and, for a file, its own file grants. Temp directories
     * count, as they do for the host's `workspace-write`.
     * @param policy - the session's resolved policy.
     * @param session - the session asking.
     * @param path - canonical target.
     * @param kind - whether the target is a directory subtree or one file.
     * @returns true when the session could write there.
     */
    canModify(policy: SandboxPolicy, session: SessionLike, path: string, kind: 'dir' | 'file'): boolean;
    /** The root that admits the running file-tool call's target when it lies in a grant: a granted directory, or a granted file's folder. */
    private grantedCallRoot;
}
/**
 * Wrap `resolve` on the sandbox-policy service's prototype. Cordis hands
 * consumers a tracing proxy whose property reads fall through to the
 * prototype, so patching the prototype reaches every consumer at once.
 * @param service - `ctx.sandboxPolicy` (the proxy or the instance).
 * @param narrow - turns the host's policy into the enforced one.
 * @returns a disposer that restores the original method if it is still ours.
 * @throws when the service has no prototype `resolve` method (a host change).
 */
export declare function patchResolve(service: object, narrow: (policy: SandboxPolicy, request: SandboxPolicyRequest) => SandboxPolicy): () => void;
