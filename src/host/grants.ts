/**
 * Turning model-written paths into grants.
 *
 * Grants come from three places: `writable_paths` on a delegation call, an
 * `answer_write_request` that allows, and `grant_write_access`. All three follow
 * one rule: an agent may grant only what its own, possibly narrowed, policy lets
 * it modify, which makes grants nest — a grandchild's need beyond its parent's
 * reach must first be requested one level up.
 * @module complete-subagent/host/grants
 */

import { mkdirSync } from 'node:fs'
import { canonical, namesDirectory, physicalDirectory, resolveFrom } from './paths.ts'
import type { Fence } from './policy.ts'
import type { RequestedPath } from './requests.ts'
import type { BindingStore, Grant } from './store.ts'
import { REQUEST_TOOL } from './types.ts'
import type { AgentLike, SandboxPolicy } from './types.ts'

/**
 * Resolve model-written paths against an agent's directory. A path names a
 * directory when it ends in "/" or already is one.
 * @param base - the agent's current directory.
 * @param paths - relative or absolute paths as the model wrote them.
 * @returns canonical paths with their kind.
 */
export function requestedPaths(base: string, paths: readonly string[]): RequestedPath[] {
  return paths.map((raw) => {
    const path = canonical(resolveFrom(base, raw))
    return { path, directory: namesDirectory(raw) || physicalDirectory(path) !== undefined }
  })
}

/** What {@link issueGrants} checks against. */
export interface IssueOptions {
  readonly fence: Fence
  readonly store: BindingStore
  /** The granting agent. */
  readonly grantor: AgentLike
  /** The grantor's enforced (already narrowed) policy. */
  readonly policy: SandboxPolicy
  readonly targets: readonly RequestedPath[]
  /** Recorded on each grant: a request id, or `spawn` for `writable_paths`. */
  readonly requestId: string
}

/**
 * Check that the grantor may modify every target, create missing directories,
 * and build the grants. Nothing is created unless every target passes.
 * @param options - grantor, policy, and targets.
 * @returns one grant per target.
 * @throws when a target is beyond the grantor's reach, naming where to ask instead.
 */
export function issueGrants(options: IssueOptions): Grant[] {
  const { fence, store, grantor, policy, targets } = options
  const refused = targets.filter(target => !fence.canModify(policy, grantor.session, target.path, target.directory ? 'dir' : 'file'))
  if (refused.length > 0) {
    const own = store.get(grantor.id)
    const advice = own === undefined
      ? 'They are outside your own sandbox.'
      : own.inherited === true
        ? 'They are outside what the agent above you may modify.'
        : `Request them from your own parent with \`${REQUEST_TOOL}\` first.`
    throw new Error(`You cannot grant paths you cannot modify yourself: ${refused.map(target => target.path).join(', ')}. ${advice}`)
  }
  const at = Date.now()
  return targets.map((target) => {
    if (target.directory && physicalDirectory(target.path) === undefined) mkdirSync(target.path, { recursive: true })
    return { path: canonical(target.path), kind: target.directory ? 'dir' : 'file', requestId: options.requestId, at }
  })
}

/**
 * One granted path as the model reads it.
 * @param grant - the path and its kind.
 * @returns a list line.
 */
export function grantLine(grant: { path: string; kind: 'dir' | 'file' }): string {
  return grant.kind === 'dir'
    ? `- ${grant.path}/ (directory: any tool, including shell commands)`
    : `- ${grant.path} (file: the write and edit tools only)`
}
