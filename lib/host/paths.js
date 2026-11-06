/**
 * Path helpers shared by the fence, the spawn binder, and the request tools.
 *
 * Every path the plugin stores or compares is canonical: absolute, with the
 * longest existing prefix resolved through `realpath` (so `/tmp` is
 * `/private/tmp` on darwin, as in the host's own sandbox roots) and any missing
 * suffix appended as spelled. Comparing canonical paths is what the host's fs
 * fence and Seatbelt profile do, so a decision made here matches the one they
 * enforce.
 * @module complete-subagent/host/paths
 */
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
/**
 * Resolve a model-supplied path against a base directory. `~` and `~/…` name the
 * user's home, as the host's file tools accept.
 * @param base - absolute directory relative paths start from.
 * @param path - the path as the model wrote it.
 * @returns an absolute, lexically normalized path.
 */
export function resolveFrom(base, path) {
    if (path === '~')
        return homedir();
    if (path.startsWith('~/'))
        return join(homedir(), path.slice(2));
    return isAbsolute(path) ? resolve(path) : resolve(base, path);
}
/**
 * The canonical spelling of a path that may not exist yet.
 * @param path - an absolute path.
 * @returns the realpath of its longest existing prefix plus the missing rest.
 */
export function canonical(path) {
    const missing = [];
    let current = resolve(path);
    while (true) {
        try {
            const real = realpathSync.native(current);
            return missing.length === 0 ? real : join(real, ...missing.reverse());
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return resolve(path);
            missing.push(basename(current));
            current = parent;
        }
    }
}
/**
 * Whether `path` is `root` or lies below it. Both must be canonical.
 * @param path - candidate path.
 * @param root - containing directory.
 * @returns true when contained.
 */
export function isUnder(path, root) {
    if (path === root)
        return true;
    const prefix = root.endsWith(sep) ? root : root + sep;
    return path.startsWith(prefix);
}
/**
 * The physical directory a path names right now, as the host accepts it for an
 * additional writable root: existing, a directory, and spelled without symlinks.
 * @param path - a canonical path.
 * @returns the path when it qualifies, otherwise undefined.
 */
export function physicalDirectory(path) {
    try {
        const real = realpathSync.native(path);
        return real === resolve(path) && statSync(real).isDirectory() ? real : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * The deepest existing directory at or above a path.
 * @param path - an absolute path.
 * @returns a physical directory that exists.
 */
export function nearestDirectory(path) {
    let current = canonical(path);
    while (physicalDirectory(current) === undefined) {
        const parent = dirname(current);
        if (parent === current)
            return current;
        current = parent;
    }
    return current;
}
/**
 * Whether a model-written path asks for a whole directory: it ends in a separator.
 * @param path - the path as written.
 * @returns true for `dir/` spellings.
 */
export function namesDirectory(path) {
    return path.endsWith('/') || path.endsWith(sep);
}
