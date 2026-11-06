/**
 * Which agents the plugin serves: every agent, or only those whose session
 * runs one of the configured agent presets.
 *
 * A bundle that mounts this plugin for its own preset sets `presets`, so the
 * tools and prompt texts stay out of every other preset's sessions. A child
 * records its parent's preset unless it was started with one of its own, so a
 * served agent's children are served too.
 * @module complete-subagent/host/scope
 */

import type { AgentPresetsLike, SessionLike, SessionProjectionsLike } from './types.ts'

/** Where a session's preset can be read, each looked up at call time because both are optional. */
export interface PresetSources {
  readonly agentPresets: () => AgentPresetsLike | undefined
  readonly sessionProjections: () => SessionProjectionsLike | undefined
}

/**
 * The preset a session runs. The registry's method comes first because newer
 * hosts deprecate reading its projection directly; 0.2.1-rc.5 has no such
 * method, and the projection is how that host reads it too.
 * @param session - the session.
 * @param sources - the host services to read.
 * @returns the preset id, or undefined when none can be read.
 */
export function sessionPreset(session: SessionLike, sources: PresetSources): string | undefined {
  const registry = sources.agentPresets()
  const preset: unknown = typeof registry?.presetForSession === 'function'
    ? registry.presetForSession(session)
    : sources.sessionProjections()?.stateOf(session, 'agentPreset')
  return typeof preset === 'string' ? preset : undefined
}

/**
 * Build the "does the plugin serve this session" check.
 * @param presets - the configured preset ids; empty serves every session.
 * @param sources - the host services a session's preset is read from.
 * @returns the check. With presets configured, a session whose preset cannot be
 *   read (no service, none recorded, a failure) is not served.
 */
export function presetScope(presets: readonly string[], sources: PresetSources): (session: SessionLike) => boolean {
  if (presets.length === 0) return () => true
  const allowed = new Set(presets)
  return (session) => {
    try {
      const preset = sessionPreset(session, sources)
      return preset !== undefined && allowed.has(preset)
    } catch {
      return false
    }
  }
}
