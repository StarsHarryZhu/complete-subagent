/**
 * What the plugin does differently on a host older than 0.2.2-alpha.2, which
 * includes 0.2.1-rc.5, the oldest it supports.
 *
 * Two host features arrived in that release: conditional tools, where
 * `tools.register` takes a `when` the host checks before every step, and
 * `additionalWritableRoots` on the sandbox policy. An older `tools.register`
 * silently drops `when`, so every agent would see all of this plugin's tools;
 * {@link ToolRestrictions} applies the same conditions as per-agent `deny`
 * filters instead. An older sandbox ignores the extra roots, so the fence also
 * moves the root of a granted file-tool call, and shell commands cannot reach
 * grants at all there (see `policy.ts` and `childContext`).
 * @module complete-subagent/host/legacy
 */

import type { AgentLike } from './types.ts'

/**
 * Whether this host predates conditional tools. `ToolRuntime.resolve`, which
 * checks each `when`, arrived in the same commit as the option.
 * @param tools - `ctx.tools`.
 * @returns true when `when` would be ignored.
 */
export function isLegacyHost(tools: { readonly resolve?: unknown }): boolean {
  return typeof tools.resolve !== 'function'
}

/**
 * Keeps each agent's `deny` filter equal to the tools it should not see now.
 * A filter covers the agent it was registered through and not its children,
 * because an agent's scope chain leads to its preset, never to its parent.
 */
export class ToolRestrictions {
  private readonly applied = new Map<AgentLike, { readonly hidden: string; readonly lift: () => void }>()

  /**
   * @param tools - the tool names under control, all registered globally.
   * @param visible - whether one agent should see one tool now.
   */
  constructor(
    private readonly tools: readonly string[],
    private readonly visible: (tool: string, agent: AgentLike) => boolean,
  ) {}

  /**
   * Bring one agent's filter up to date; a filter that still fits stays, so an
   * unchanged agent causes no tool-change notice. A condition may read the
   * agent's own tool view, which the old filter still narrowed (the parent-only
   * tools ask whether `delegate` is visible), so a change is checked once more.
   * @param agent - a live agent.
   * @throws when the agent has no scoped tools service.
   */
  sync(agent: AgentLike): void {
    if (this.apply(agent)) this.apply(agent)
  }

  /** Apply the current conditions once; returns whether the filter changed. */
  private apply(agent: AgentLike): boolean {
    const hidden = this.tools.filter(tool => !this.visible(tool, agent))
    const key = hidden.join()
    const current = this.applied.get(agent)
    if ((current?.hidden ?? '') === key) return false
    const scoped = agent.ctx?.tools
    if (scoped === undefined) throw new Error(`agent ${agent.id} has no scoped tools service`)
    // The new filter goes in first: if it throws, the old one still holds.
    const lift = hidden.length === 0 ? undefined : scoped.restrict({ deny: hidden })
    current?.lift()
    if (lift === undefined) this.applied.delete(agent)
    else this.applied.set(agent, { hidden: key, lift })
    return true
  }

  /**
   * Stop tracking a disposed agent; its context already removed the filter.
   * @param agent - the disposed agent.
   */
  forget(agent: AgentLike): void {
    this.applied.delete(agent)
  }

  /** Lift every filter, for the plugin's dispose: the filters belong to the agents' contexts, not the plugin's. */
  dispose(): void {
    for (const { lift } of this.applied.values()) lift()
    this.applied.clear()
  }
}
