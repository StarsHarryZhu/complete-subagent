/**
 * complete-subagent host plugin.
 *
 * Adds its own delegation tools beside the official ones: `delegate` (a fresh
 * child) and `delegate_fork` (a child that inherits the conversation). The
 * `cwd` a parent passes becomes the child's sub-workspace, `writable_paths`
 * grants more up front, and the child may modify nothing else (besides temp
 * directories). For anything else it asks with `request_write_access`; the
 * parent answers with `answer_write_request`, and can grant or revoke at any
 * time with `grant_write_access` / `revoke_write_access`. A parent may also
 * pick the child's model and reasoning effort among those the user lists in
 * the settings. Children run on the host's subagent runtime; the fence narrows
 * the sandbox policy the host already enforces, and anything a confined agent
 * starts by other means is confined the same way. A bundle that mounts the
 * plugin for its own agent preset sets `presets`, and agents of other presets
 * then see none of it; it may also set `childPreset`, the preset `delegate`
 * children run, `ownModel: false`, which keeps those children on the listed
 * models, and the list itself at run time through the `completeSubagent` service.
 * @module complete-subagent
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ChildModel, ChildModelInput } from './shared/settings.ts';
export declare const name = "complete-subagent";
export declare const inject: string[];
export interface Config {
    /** Seconds a parent has to answer a write-access request before it counts as denied. */
    requestTimeoutSeconds: Volatile<number>;
    /** Models a parent may choose for a child, with the efforts each allows. */
    models: Volatile<ChildModel[]>;
    /** Agent presets whose agents the plugin serves; empty serves every agent. */
    presets: string[];
    /** Agent preset `delegate` children run; empty keeps the parent's. */
    childPreset: string;
    /** False keeps `delegate` children off the parent's own model when models are listed. */
    ownModel: boolean;
}
/** `ctx.completeSubagent`: what a bundle that mounts this plugin can change at run time. */
export interface CompleteSubagentService {
    /**
     * Replace the `models` setting until the row reloads, so call it whenever the
     * service appears. Does nothing on a copy without `childPreset`: that is a
     * standalone install, whose list belongs to the user's normal sessions.
     * @param models - the models a parent may choose for a child, in order.
     */
    setChildModels(models: readonly ChildModelInput[]): void;
}
export declare const Config: z<Config>;
/**
 * Install the fence, the delegation tools, the write-access tools, and the
 * guidance.
 * @param ctx - the plugin context; the services in {@link inject} are present.
 * @param config - loaded settings.
 */
export declare function apply(ctx: Context, config: Config): void;
