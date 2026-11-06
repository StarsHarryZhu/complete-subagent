/**
 * The settings both halves read: which models a parent may choose for a child,
 * which reasoning efforts each allows, and how long a parent has to answer.
 * The host half declares them as live config fields; the browser half edits
 * them on the Plugins page. Only the host half reads `presets`, `childPreset`,
 * and `ownModel`, which a bundle that mounts this plugin sets in its patch.
 * @module complete-subagent/shared/settings
 */
/** The npm package name: the browser bundle's registration id and the Plugins page key. */
export declare const PACKAGE_NAME = "@starsharryzhu/complete-subagent";
/** Bundle row id, settings form id, and plugin name; it keeps the original spelling. */
export declare const PLUGIN_ID = "complete-subagent";
/** One model a parent may choose for a child. */
export interface ChildModel {
    /** Registered LLM provider id. */
    readonly provider: string;
    /** Exact model id within that provider. */
    readonly model: string;
    /** Efforts a parent may choose for it; empty allows every effort the model advertises. */
    readonly reasoningEfforts: readonly string[];
}
/** A model as a bundle hands it to the plugin at run time: an omitted effort list allows every effort. */
export type ChildModelInput = Omit<ChildModel, 'reasoningEfforts'> & {
    readonly reasoningEfforts?: readonly string[];
};
/** Seconds a parent has to answer a write-access request, unless the settings say otherwise. */
export declare const DEFAULT_TIMEOUT_SECONDS = 600;
/** The shortest answer time the settings accept. */
export declare const MIN_TIMEOUT_SECONDS = 10;
/**
 * The id a parent passes as `model`.
 * @param route - provider and model.
 * @returns `provider/model`.
 */
export declare function modelKey(route: {
    readonly provider: string;
    readonly model: string;
}): string;
/**
 * Read a stored model list, dropping malformed entries, repeated models, and
 * repeated efforts.
 * @param value - the stored `models` field.
 * @returns the usable entries in their stored order.
 */
export declare function readModels(value: unknown): ChildModel[];
/**
 * Read a stored preset list, dropping anything but non-empty strings and repeats.
 * @param value - the stored `presets` field.
 * @returns the preset ids in their stored order; empty means every preset.
 */
export declare function readPresets(value: unknown): string[];
/**
 * Read a stored child preset.
 * @param value - the stored `childPreset` field.
 * @returns the preset id, or undefined when none is set.
 */
export declare function readChildPreset(value: unknown): string | undefined;
/**
 * Read the stored `ownModel` flag.
 * @param value - the stored field.
 * @returns false only when the field says so.
 */
export declare function readOwnModel(value: unknown): boolean;
/**
 * Read a stored answer time.
 * @param value - the stored `requestTimeoutSeconds` field.
 * @returns whole seconds, at least {@link MIN_TIMEOUT_SECONDS}.
 */
export declare function readTimeout(value: unknown): number;
