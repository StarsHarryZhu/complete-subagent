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
/**
 * Resolve a model-supplied path against a base directory. `~` and `~/…` name the
 * user's home, as the host's file tools accept.
 * @param base - absolute directory relative paths start from.
 * @param path - the path as the model wrote it.
 * @returns an absolute, lexically normalized path.
 */
export declare function resolveFrom(base: string, path: string): string;
/**
 * The canonical spelling of a path that may not exist yet.
 * @param path - an absolute path.
 * @returns the realpath of its longest existing prefix plus the missing rest.
 */
export declare function canonical(path: string): string;
/**
 * Whether `path` is `root` or lies below it. Both must be canonical.
 * @param path - candidate path.
 * @param root - containing directory.
 * @returns true when contained.
 */
export declare function isUnder(path: string, root: string): boolean;
/**
 * The physical directory a path names right now, as the host accepts it for an
 * additional writable root: existing, a directory, and spelled without symlinks.
 * @param path - a canonical path.
 * @returns the path when it qualifies, otherwise undefined.
 */
export declare function physicalDirectory(path: string): string | undefined;
/**
 * The deepest existing directory at or above a path.
 * @param path - an absolute path.
 * @returns a physical directory that exists.
 */
export declare function nearestDirectory(path: string): string;
/**
 * Whether a model-written path asks for a whole directory: it ends in a separator.
 * @param path - the path as written.
 * @returns true for `dir/` spellings.
 */
export declare function namesDirectory(path: string): boolean;
