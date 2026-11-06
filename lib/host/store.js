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
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * The default store directory, following the host's home rule: `DSH_HOME`, then
 * `~/.dsh`.
 * @param env - environment to read.
 * @returns the absolute directory holding one file per child.
 */
export function defaultStoreDirectory(env = process.env) {
    const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh');
    return join(home, 'plugin-data', 'complete-subagent', 'children');
}
/** File-backed binding store with a synchronous read cache. */
export class BindingStore {
    directory;
    cache = new Map();
    /** @param directory - where the per-child files live; created on first write. */
    constructor(directory) {
        this.directory = directory;
    }
    /**
     * The binding of one child, or undefined when it was not bound by this plugin.
     * @param child - child session id.
     * @returns the stored binding.
     */
    get(child) {
        const cached = this.cache.get(child);
        if (cached !== undefined)
            return cached ?? undefined;
        const loaded = this.load(child);
        this.cache.set(child, loaded ?? null);
        return loaded;
    }
    /**
     * Store a binding, replacing any earlier one for the same child. The cache is
     * updated first, so a failed write still fences the child for the life of
     * this process; the failure is rethrown for the caller to report.
     * @param binding - the complete binding.
     */
    set(binding) {
        this.cache.set(binding.child, binding);
        mkdirSync(this.directory, { recursive: true });
        const file = this.fileOf(binding.child);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify(binding, null, 2)}\n`);
        renameSync(temp, file);
    }
    /**
     * Forget a child, for a delegation that failed to start.
     * @param child - child session id.
     */
    delete(child) {
        this.cache.set(child, null);
        rmSync(this.fileOf(child), { force: true });
    }
    /**
     * Add grants to a bound child, skipping ones it already holds.
     * @param child - child session id.
     * @param grants - new grants.
     * @returns the updated binding.
     * @throws when the child is not bound.
     */
    addGrants(child, grants) {
        const binding = this.get(child);
        if (binding === undefined)
            throw new Error(`child ${child} has no binding`);
        const held = new Set(binding.grants.map(grant => `${grant.kind}:${grant.path}`));
        const added = grants.filter(grant => !held.has(`${grant.kind}:${grant.path}`));
        const next = { ...binding, grants: [...binding.grants, ...added] };
        this.set(next);
        return next;
    }
    /**
     * Remove a bound child's grants on the given paths, of either kind.
     * @param child - child session id.
     * @param paths - canonical paths to take back.
     * @returns the removed grants.
     * @throws when the child is not bound.
     */
    removeGrants(child, paths) {
        const binding = this.get(child);
        if (binding === undefined)
            throw new Error(`child ${child} has no binding`);
        const targets = new Set(paths);
        const removed = binding.grants.filter(grant => targets.has(grant.path));
        if (removed.length > 0)
            this.set({ ...binding, grants: binding.grants.filter(grant => !targets.has(grant.path)) });
        return removed;
    }
    fileOf(child) {
        return join(this.directory, `${encodeURIComponent(child)}.json`);
    }
    load(child) {
        let text;
        try {
            text = readFileSync(this.fileOf(child), 'utf8');
        }
        catch {
            return undefined;
        }
        try {
            const value = JSON.parse(text);
            if (value.version !== 1 || value.child !== child || typeof value.parent !== 'string')
                return undefined;
            if (value.workspace !== null && typeof value.workspace !== 'string')
                return undefined;
            const grants = Array.isArray(value.grants)
                ? value.grants.filter((grant) => typeof grant?.path === 'string' && (grant.kind === 'dir' || grant.kind === 'file'))
                : [];
            return { version: 1, child, parent: value.parent, workspace: value.workspace, grants, ...value.inherited === true ? { inherited: true } : {} };
        }
        catch {
            return undefined;
        }
    }
}
