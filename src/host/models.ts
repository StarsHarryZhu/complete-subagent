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

import { modelKey } from '../shared/settings.ts'
import type { ChildModel } from '../shared/settings.ts'
import type { AgentLike, LlmLike, RouteLike } from './types.ts'

/** A route with its provider and model known. */
export interface Route {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The model-facing selection fields of one delegation call, unvalidated. */
export interface ModelRequest {
  readonly model?: unknown
  readonly reasoning_effort?: unknown
}

/**
 * The route an agent's next request uses, as the host hands it to a child
 * (`parentAgentOptionsForDelegation`): the session's request header once it
 * has one, the agent's creation options before.
 * @param agent - the parent.
 * @returns its route, or undefined when the provider or model is unknown.
 */
export function routeOf(agent: AgentLike): Route | undefined {
  const source: RouteLike = agent.session.requestHeader?.()?.config ?? agent.options ?? {}
  if (source.provider === undefined || source.model === undefined) return undefined
  return {
    provider: source.provider,
    model: source.model,
    ...source.reasoningEffort === undefined ? {} : { reasoningEffort: source.reasoningEffort },
  }
}

/** The choices as one line for an error message. */
function choicesLine(models: readonly ChildModel[]): string {
  return models.length === 0 ? 'none are listed in the settings' : models.map(modelKey).join(', ')
}

/** Read one optional non-empty string field. */
function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`\`${field}\` must be a non-empty id`)
  return value.trim()
}

/**
 * Validate one call's model and effort and turn them into child options.
 * @param options - the parent, the settings list, the call's fields, the LLM runtime, and the `ownModel` rule.
 * @returns the child's route, or undefined when the call selects nothing and the child inherits the parent's route.
 * @throws with a model-facing reason naming the allowed choices.
 */
export async function chooseRoute(options: {
  readonly parent: AgentLike
  readonly models: readonly ChildModel[]
  readonly request: ModelRequest
  readonly llm: LlmLike | undefined
  readonly signal?: AbortSignal
  /** False keeps the child off the parent's own model when models are listed. */
  readonly ownModel?: boolean
}): Promise<Route | undefined> {
  const named = optionalId(options.request.model, 'model')
  const effort = optionalId(options.request.reasoning_effort, 'reasoning_effort')
  const onlyListed = options.ownModel === false && options.models.length > 0
  if (named === undefined && effort === undefined && !onlyListed) return undefined
  const own = routeOf(options.parent)
  const listed = (key: string) => options.models.find(entry => modelKey(entry) === key)
  let route: Route
  if (onlyListed) {
    const entry = named === undefined ? options.models[0] : listed(named)
    if (entry === undefined) throw new Error(`Model "${named}" is not offered for subagents. Choose one of: ${choicesLine(options.models)}; or omit \`model\` to use the first.`)
    route = entry
  } else if (named === undefined || (own !== undefined && named === modelKey(own))) {
    if (own === undefined) throw new Error('Your own model is not known yet, so the child\'s reasoning effort cannot be set; omit `reasoning_effort`.')
    route = own
  } else {
    const entry = listed(named)
    if (entry === undefined) throw new Error(`Model "${named}" is not offered for subagents. Choose one of: ${choicesLine(options.models)}; or omit \`model\` to use your own.`)
    route = entry
  }
  const key = modelKey(route)
  const sameRoute = own !== undefined && modelKey(own) === key
  const allowed = listed(key)?.reasoningEfforts ?? []
  const llm = options.llm
  if (llm === undefined) throw new Error('The child model cannot be checked because the `llm` service is unavailable.')
  let chosen = effort
  if (effort !== undefined) {
    const offered = allowed.length > 0
      ? allowed
      : (await llm.resolveModelInfo(route.provider, route.model, options.signal)).reasoning?.efforts.map(item => item.id) ?? []
    if (!offered.includes(effort)) {
      throw new Error(offered.length === 0
        ? `${key} has no selectable reasoning effort; omit \`reasoning_effort\`.`
        : `Reasoning effort "${effort}" is not offered for ${key}. Choose one of: ${offered.join(', ')}.`)
    }
  } else if (sameRoute ? onlyListed : allowed.length > 0) {
    const fallback = (await llm.resolveModelInfo(route.provider, route.model, options.signal)).reasoning?.defaultEffort
    if (allowed.length > 0 && (fallback === undefined || !allowed.includes(fallback))) chosen = allowed[0]
    // On the parent's own route the host keeps the parent's effort unless one is named.
    else if (sameRoute) chosen = fallback
  }
  const reasoningEffort = chosen ?? (sameRoute ? own?.reasoningEffort : undefined)
  await llm.resolveCallConfig({
    provider: route.provider,
    model: route.model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }, options.signal)
  return { provider: route.provider, model: route.model, ...chosen === undefined ? {} : { reasoningEffort: chosen } }
}

/**
 * The model-selection paragraph of a delegation tool's description.
 * @param models - the settings list.
 * @param ownModel - false keeps the child off the parent's own model when models are listed.
 * @returns the text the parent reads.
 */
export function describeModels(models: readonly ChildModel[], ownModel = true): string {
  const efforts = (entry: ChildModel): string => entry.reasoningEfforts.length === 0
    ? 'any effort it supports'
    : `efforts ${entry.reasoningEfforts.join(', ')}`
  if (models.length === 0) {
    return 'Model: the child uses your own model. `reasoning_effort` may be any effort your model supports; omitted, the child keeps your current effort.'
  }
  if (!ownModel) {
    return [
      'Model: the child runs one of these models, never your own. Omit `model` to use the first; `reasoning_effort` applies to the model the child runs.',
      ...models.map(entry => `- ${modelKey(entry)}: ${efforts(entry)}`),
      'An omitted effort uses the model\'s default, or its first listed effort when the default is not listed.',
    ].join('\n')
  }
  return [
    'Model: omit `model` to give the child your own model; `reasoning_effort` may then be any effort your model supports '
    + '(only the listed ones if your model is listed below), and an omitted effort keeps your current one.',
    'Other models you may choose with `model`:',
    ...models.map(entry => `- ${modelKey(entry)}: ${efforts(entry)}`),
    'On another model, an omitted effort uses that model\'s default, or its first listed effort when the default is not listed.',
  ].join('\n')
}
