/**
 * What a new child may modify, decided from the delegation call's `cwd` and
 * `writable_paths` before the child exists.
 *
 * A `cwd` the parent may modify becomes the child's sub-workspace and is created
 * if missing; no `cwd`, or one outside the parent's writable area, gives the
 * child none. `writable_paths` become grants, checked against the parent's own
 * reach, so nothing outside it can be handed down.
 * @module complete-subagent/host/access
 */

import { mkdirSync } from 'node:fs'
import { issueGrants, requestedPaths } from './grants.ts'
import { canonical, resolveFrom } from './paths.ts'
import type { Fence } from './policy.ts'
import type { BindingStore, Grant } from './store.ts'
import type { AgentLike, SandboxPolicy, SessionLike, WorkingDirectoryLike } from './types.ts'

/** What {@link decideAccess} reads. */
export interface AccessDeps {
  readonly store: BindingStore
  readonly fence: Fence
  readonly workingDirectory: WorkingDirectoryLike
  /** The session's enforced (already narrowed) sandbox policy. */
  readonly resolvePolicy: (session: SessionLike) => SandboxPolicy
}

/** One delegation call's access arguments, unvalidated. */
export interface AccessRequest {
  readonly parent: AgentLike
  readonly cwd: unknown
  readonly writablePaths: unknown
  readonly signal?: AbortSignal
}

/** The decided access of a child that is about to start. */
export interface ChildAccess {
  /** Directory to start the child in; undefined inherits the parent's. */
  readonly cwd?: string
  /** Canonical sub-workspace, or null for none. */
  readonly workspace: string | null
  /** Grants from `writable_paths`. */
  readonly grants: readonly Grant[]
}

/**
 * Decide a new child's sub-workspace and grants, creating the sub-workspace and
 * any granted directory that does not exist yet.
 * @param deps - store, fence, and host services.
 * @param request - the call's parent and arguments.
 * @returns the child's access and start directory.
 * @throws with a model-facing reason when the call must not run.
 */
export async function decideAccess(deps: AccessDeps, request: AccessRequest): Promise<ChildAccess> {
  const { parent } = request
  const writable = request.writablePaths ?? []
  if (!Array.isArray(writable) || writable.some(path => typeof path !== 'string' || path.trim() === '')) {
    throw new Error('writable_paths must be a list of paths')
  }
  if (request.cwd !== undefined && typeof request.cwd !== 'string') throw new Error('cwd must be a path')
  const base = await deps.workingDirectory.ensure(parent, request.signal)
  const policy = deps.resolvePolicy(parent.session)
  const grants = issueGrants({
    fence: deps.fence,
    store: deps.store,
    grantor: parent,
    policy,
    targets: requestedPaths(base, writable as string[]),
    requestId: 'spawn',
  })
  if (request.cwd === undefined || request.cwd.trim() === '') return { workspace: null, grants }
  const target = canonical(resolveFrom(base, request.cwd))
  if (!deps.fence.canModify(policy, parent.session, target, 'dir')) return { cwd: target, workspace: null, grants }
  try {
    mkdirSync(target, { recursive: true })
  } catch {
    // Not a directory (or not creatable): the host reports it when the child starts.
    return { cwd: target, workspace: null, grants }
  }
  const workspace = canonical(target)
  return { cwd: workspace, workspace, grants }
}
