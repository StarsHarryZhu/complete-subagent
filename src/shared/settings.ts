/**
 * The settings both halves read: which models a parent may choose for a child,
 * which reasoning efforts each allows, and how long a parent has to answer.
 * The host half declares them as live config fields; the browser half edits
 * them on the Plugins page. Only the host half reads `presets`, `childPreset`,
 * and `ownModel`, which a bundle that mounts this plugin sets in its patch.
 * @module complete-subagent/shared/settings
 */

/** The npm package name: the browser bundle's registration id and the Plugins page key. */
export const PACKAGE_NAME = '@starsharryzhu/complete-subagent'

/** Bundle row id, settings form id, and plugin name; it keeps the original spelling. */
export const PLUGIN_ID = 'complete-subagent'

/** One model a parent may choose for a child. */
export interface ChildModel {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Exact model id within that provider. */
  readonly model: string
  /** Efforts a parent may choose for it; empty allows every effort the model advertises. */
  readonly reasoningEfforts: readonly string[]
}

/** A model as a bundle hands it to the plugin at run time: an omitted effort list allows every effort. */
export type ChildModelInput = Omit<ChildModel, 'reasoningEfforts'> & { readonly reasoningEfforts?: readonly string[] }

/** Seconds a parent has to answer a write-access request, unless the settings say otherwise. */
export const DEFAULT_TIMEOUT_SECONDS = 600

/** The shortest answer time the settings accept. */
export const MIN_TIMEOUT_SECONDS = 10

/**
 * The id a parent passes as `model`.
 * @param route - provider and model.
 * @returns `provider/model`.
 */
export function modelKey(route: { readonly provider: string; readonly model: string }): string {
  return `${route.provider}/${route.model}`
}

/**
 * Read a stored model list, dropping malformed entries, repeated models, and
 * repeated efforts.
 * @param value - the stored `models` field.
 * @returns the usable entries in their stored order.
 */
export function readModels(value: unknown): ChildModel[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const models: ChildModel[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { provider, model, reasoningEfforts } = item as Record<string, unknown>
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') continue
    const key = modelKey({ provider, model })
    if (seen.has(key)) continue
    seen.add(key)
    const efforts = Array.isArray(reasoningEfforts)
      ? [...new Set((reasoningEfforts as unknown[]).filter((effort): effort is string => typeof effort === 'string' && effort !== ''))]
      : []
    models.push({ provider, model, reasoningEfforts: efforts })
  }
  return models
}

/**
 * Read a stored preset list, dropping anything but non-empty strings and repeats.
 * @param value - the stored `presets` field.
 * @returns the preset ids in their stored order; empty means every preset.
 */
export function readPresets(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set((value as unknown[]).filter((preset): preset is string => typeof preset === 'string' && preset !== ''))]
}

/**
 * Read a stored child preset.
 * @param value - the stored `childPreset` field.
 * @returns the preset id, or undefined when none is set.
 */
export function readChildPreset(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Read the stored `ownModel` flag.
 * @param value - the stored field.
 * @returns false only when the field says so.
 */
export function readOwnModel(value: unknown): boolean {
  return value !== false
}

/**
 * Read a stored answer time.
 * @param value - the stored `requestTimeoutSeconds` field.
 * @returns whole seconds, at least {@link MIN_TIMEOUT_SECONDS}.
 */
export function readTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_TIMEOUT_SECONDS ? value : DEFAULT_TIMEOUT_SECONDS
}
