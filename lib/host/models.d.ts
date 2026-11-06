/**
 * Choosing a child's model and reasoning effort.
 *
 * A parent keeps its own model unless it names one the user listed in the
 * settings. A listed model allows the efforts listed with it, or every effort
 * it advertises when none are listed; the parent's own model, when it is not
 * listed, allows every effort it advertises. An omitted effort keeps the
 * parent's effort on the parent's model; on another model it is that model's
 * default, or the first listed effort when the default is not among them.
 *
 * With `ownModel` off and models listed, only the listed models run: an omitted
 * model is the first one, an effort-only call sets that model's effort, and an
 * omitted effort never comes from the parent, even when the parent runs the
 * same model. An empty list leaves the rules above.
 * @module complete-subagent/host/models
 */
import type { ChildModel } from '../shared/settings.ts';
import type { AgentLike, LlmLike } from './types.ts';
/** A route with its provider and model known. */
export interface Route {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
}
/** The model-facing selection fields of one delegation call, unvalidated. */
export interface ModelRequest {
    readonly model?: unknown;
    readonly reasoning_effort?: unknown;
}
/**
 * The route an agent's next request uses, as the host hands it to a child
 * (`parentAgentOptionsForDelegation`): the session's request header once it
 * has one, the agent's creation options before.
 * @param agent - the parent.
 * @returns its route, or undefined when the provider or model is unknown.
 */
export declare function routeOf(agent: AgentLike): Route | undefined;
/**
 * Validate one call's model and effort and turn them into child options.
 * @param options - the parent, the settings list, the call's fields, the LLM runtime, and the `ownModel` rule.
 * @returns the child's route, or undefined when the call selects nothing and the child inherits the parent's route.
 * @throws with a model-facing reason naming the allowed choices.
 */
export declare function chooseRoute(options: {
    readonly parent: AgentLike;
    readonly models: readonly ChildModel[];
    readonly request: ModelRequest;
    readonly llm: LlmLike | undefined;
    readonly signal?: AbortSignal;
    /** False keeps the child off the parent's own model when models are listed. */
    readonly ownModel?: boolean;
}): Promise<Route | undefined>;
/**
 * The model-selection paragraph of a delegation tool's description.
 * @param models - the settings list.
 * @param ownModel - false keeps the child off the parent's own model when models are listed.
 * @returns the text the parent reads.
 */
export declare function describeModels(models: readonly ChildModel[], ownModel?: boolean): string;
