/**
 * Model-facing guidance. A parent reads the delegation and sub-workspace rules
 * in the `delegate` / `delegate_fork` descriptions and parameters; a bound
 * child reads its sub-workspace and grants in a runtime context; a parent with
 * open requests reads them in another.
 * @module complete-subagent/host/prompt
 */
import type { WriteRequest } from './requests.ts';
import type { Binding } from './store.ts';
import type { DelegateTool } from './types.ts';
/**
 * The description of one delegation tool.
 * @param tool - which tool.
 * @param models - the model-selection paragraph from `describeModels`.
 * @returns the full description.
 */
export declare function delegateDescription(tool: DelegateTool, models: string): string;
/** The `prompt` parameter, by whether the child inherits this conversation. */
export declare const PROMPT_DESCRIPTION: Readonly<Record<DelegateTool, string>>;
/** The `cwd` parameter. */
export declare const CWD_DESCRIPTION: string;
/** The `writable_paths` parameter. */
export declare const WRITABLE_PATHS_DESCRIPTION: string;
/** The `model` parameter. */
export declare const MODEL_DESCRIPTION = "The child's model as \"provider/model\", one of the listed choices. Omit it to use your own model.";
/** The `model` parameter when the child cannot run the parent's model. */
export declare const LISTED_MODEL_DESCRIPTION = "The child's model as \"provider/model\", one of the listed choices. Omit it to use the first.";
/** The `reasoning_effort` parameter. */
export declare const EFFORT_DESCRIPTION: string;
/**
 * Runtime context for a bound child.
 * @param binding - the child's binding in force (inherited access already resolved).
 * @returns the context text.
 */
export declare function childContext(binding: Binding, shellReachesGrants?: boolean): string;
/**
 * Runtime context for a parent with open requests.
 * @param requests - its open requests.
 * @returns the context text, or '' when none are open.
 */
export declare function pendingContext(requests: readonly WriteRequest[]): string;
