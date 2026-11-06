/**
 * Durable bindings: which sub-workspace a child owns and what its parent granted.
 *
 * One JSON file per child session under
 * `$DSH_HOME/plugin-data/complete-subagent/children/`. A child keeps its session
 * id when it is cold-resumed (a finished child woken by `send_message`, or any
 * child after a restart), so the same file applies again. Reads are synchronous
 * and cached, because the sandbox policy is resolved synchronously on every
 * capability call; writes replace the file atomically.
 * @module complete-subagent/host/store
 */
/** One path a parent let its child modify. */
export interface Grant {
    /** Canonical absolute path. */
    readonly path: string;
    /** A directory grant covers its subtree for every tool; a file grant covers the file for `write`/`edit`. */
    readonly kind: 'dir' | 'file';
    /** The request that produced it. */
    readonly requestId: string;
    /** Unix epoch milliseconds. */
    readonly at: number;
}
/** Everything the fence needs to know about one child. */
export interface Binding {
    readonly version: 1;
    /** Child session id. */
    readonly child: string;
    /** Parent session id. */
    readonly parent: string;
    /** Canonical sub-workspace, or null when the child has none. */
    readonly workspace: string | null;
    readonly grants: readonly Grant[];
    /**
     * Set for a child that a confined agent started some other way (the official
     * subagent tools, a workflow): it holds whatever access its parent holds now,
     * and `workspace` / `grants` stay empty.
     */
    readonly inherited?: true;
}
/**
 * The default store directory, following the host's home rule: `DSH_HOME`, then
 * `~/.dsh`.
 * @param env - environment to read.
 * @returns the absolute directory holding one file per child.
 */
export declare function defaultStoreDirectory(env?: NodeJS.ProcessEnv): string;
/** File-backed binding store with a synchronous read cache. */
export declare class BindingStore {
    readonly directory: string;
    private readonly cache;
    /** @param directory - where the per-child files live; created on first write. */
    constructor(directory: string);
    /**
     * The binding of one child, or undefined when it was not bound by this plugin.
     * @param child - child session id.
     * @returns the stored binding.
     */
    get(child: string): Binding | undefined;
    /**
     * Store a binding, replacing any earlier one for the same child. The cache is
     * updated first, so a failed write still fences the child for the life of
     * this process; the failure is rethrown for the caller to report.
     * @param binding - the complete binding.
     */
    set(binding: Binding): void;
    /**
     * Forget a child, for a delegation that failed to start.
     * @param child - child session id.
     */
    delete(child: string): void;
    /**
     * Add grants to a bound child, skipping ones it already holds.
     * @param child - child session id.
     * @param grants - new grants.
     * @returns the updated binding.
     * @throws when the child is not bound.
     */
    addGrants(child: string, grants: readonly Grant[]): Binding;
    /**
     * Remove a bound child's grants on the given paths, of either kind.
     * @param child - child session id.
     * @param paths - canonical paths to take back.
     * @returns the removed grants.
     * @throws when the child is not bound.
     */
    removeGrants(child: string, paths: readonly string[]): Grant[];
    private fileOf;
    private load;
}
