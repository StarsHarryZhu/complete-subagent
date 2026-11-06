/**
 * The write fence: narrows a bound child's sandbox policy to its sub-workspace
 * plus what its parent granted.
 *
 * Every enforcing capability (bash's OS sandbox, the fs write fence, terminals,
 * PTC) asks `ctx.sandboxPolicy.resolve({ session })` for each call, and the
 * host's child agents copy the parent's header cwd, so by default a child may
 * write anywhere in the parent's project. {@link patchResolve} wraps the
 * service's prototype method, so every holder of the service, including ones
 * that captured it at load, sees the narrowed policy; disposing restores it.
 * @module complete-subagent/host/policy
 */

import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { currentCall } from './call-scope.ts'
import { canonical, isUnder, nearestDirectory, physicalDirectory, resolveFrom } from './paths.ts'
import type { Binding, BindingStore } from './store.ts'
import type { SandboxPolicy, SandboxPolicyRequest, SessionLike, WorkingDirectoryLike } from './types.ts'

/** File tools whose single target a grant may admit by moving the call's root, and the argument naming it. */
const FILE_TOOLS: Readonly<Record<string, string>> = {
  write: 'file_path',
  edit: 'file_path',
  str_replace_editor: 'path',
}

/** What the fence reads besides the store. */
export interface FenceOptions {
  readonly store: BindingStore
  /** Effective directories, for relative file-tool targets. */
  readonly workingDirectory?: WorkingDirectoryLike
  /** Reports a failure that made the fence fall back to read-only. */
  readonly warn?: (message: string) => void
}

/** How many inherited bindings the fence follows before it gives up and closes. */
const MAX_INHERITANCE = 32

/** Narrows policies for bound children and answers "may this agent modify that path". */
export class Fence {
  private readonly temp = canonical(tmpdir())

  constructor(private readonly options: FenceOptions) {}

  /**
   * The binding in force for a session. An inherited binding takes the access
   * of the nearest ancestor with a binding of its own, as that ancestor holds it
   * now; a broken chain leaves no access (fail closed).
   * @param session - any session.
   * @returns the binding, or undefined for sessions the fence leaves alone.
   */
  bindingOf(session: SessionLike): Binding | undefined {
    const own = this.options.store.get(session.id)
    if (own?.inherited !== true) return own
    let source: Binding | undefined = own
    for (let hops = 0; source?.inherited === true && hops < MAX_INHERITANCE; hops++) source = this.options.store.get(source.parent)
    const access = source === undefined || source.inherited === true ? { workspace: null, grants: [] } : source
    return { ...own, workspace: access.workspace, grants: access.grants }
  }

  /**
   * Narrow one resolved policy. Unbound sessions pass through untouched; a
   * bound child gets `workspace-write` rooted at its sub-workspace (or the temp
   * directory when it has none) and its directory grants as extra roots. The
   * one `write`/`edit` call whose target was granted is rooted at that grant
   * instead, because a host older than 0.2.2-alpha.2 reads only `workspaceRoot`.
   * `read-only` stays read-only. A failure falls back to read-only for subagent
   * sessions rather than widening anything, and stays within that one session.
   * @param policy - the host's resolved policy.
   * @param request - the resolve request (its session decides).
   * @returns the policy to enforce.
   */
  narrow(policy: SandboxPolicy, request: SandboxPolicyRequest): SandboxPolicy {
    const session = request.session
    if (session === undefined) return policy
    try {
      const binding = this.bindingOf(session)
      if (binding === undefined || policy.mode === 'read-only') return policy
      const roots = new Set<string>(policy.additionalWritableRoots ?? [])
      for (const grant of binding.grants) {
        if (grant.kind !== 'dir') continue
        const directory = physicalDirectory(grant.path)
        if (directory !== undefined) roots.add(directory)
      }
      const callRoot = this.grantedCallRoot(session, binding)
      if (callRoot !== undefined) roots.add(callRoot)
      return {
        ...policy,
        mode: 'workspace-write',
        workspaceRoot: callRoot ?? binding.workspace ?? this.temp,
        additionalWritableRoots: [...roots],
      }
    } catch (error) {
      if (session.header.origin !== 'subagent') return policy
      this.options.warn?.(`complete-subagent: fence failed for ${session.id}, using read-only: ${String(error)}`)
      return { ...policy, mode: 'read-only' }
    }
  }

  /**
   * Whether a session may itself modify a path, judged by its own (possibly
   * narrowed) policy and, for a file, its own file grants. Temp directories
   * count, as they do for the host's `workspace-write`.
   * @param policy - the session's resolved policy.
   * @param session - the session asking.
   * @param path - canonical target.
   * @param kind - whether the target is a directory subtree or one file.
   * @returns true when the session could write there.
   */
  canModify(policy: SandboxPolicy, session: SessionLike, path: string, kind: 'dir' | 'file'): boolean {
    if (policy.mode === 'danger-full-access') return true
    if (policy.mode === 'read-only') return false
    const roots = [policy.workspaceRoot, ...policy.additionalWritableRoots ?? [], '/tmp', this.temp].map(canonical)
    if (roots.some(root => isUnder(path, root))) return true
    if (kind !== 'file') return false
    return this.bindingOf(session)?.grants.some(grant => grant.kind === 'file' && grant.path === path) === true
  }

  /** The root that admits the running file-tool call's target when it lies in a grant: a granted directory, or a granted file's folder. */
  private grantedCallRoot(session: SessionLike, binding: Binding): string | undefined {
    if (binding.grants.length === 0) return undefined
    const call = currentCall()
    if (call?.agent?.session.id !== session.id) return undefined
    const key = FILE_TOOLS[call.name]
    if (key === undefined) return undefined
    const raw = (call.arguments as Record<string, unknown> | null | undefined)?.[key]
    if (typeof raw !== 'string' || raw === '') return undefined
    const base = this.options.workingDirectory?.get(session) ?? session.header.cwd ?? process.cwd()
    const target = canonical(resolveFrom(base, raw))
    if (binding.workspace !== null && isUnder(target, binding.workspace)) return undefined
    for (const grant of binding.grants) {
      if (grant.kind === 'file' && grant.path === target) return nearestDirectory(dirname(target))
      if (grant.kind === 'dir' && isUnder(target, grant.path)) {
        const directory = physicalDirectory(grant.path)
        if (directory !== undefined) return directory
      }
    }
    return undefined
  }
}

/**
 * Wrap `resolve` on the sandbox-policy service's prototype. Cordis hands
 * consumers a tracing proxy whose property reads fall through to the
 * prototype, so patching the prototype reaches every consumer at once.
 * @param service - `ctx.sandboxPolicy` (the proxy or the instance).
 * @param narrow - turns the host's policy into the enforced one.
 * @returns a disposer that restores the original method if it is still ours.
 * @throws when the service has no prototype `resolve` method (a host change).
 */
export function patchResolve(
  service: object,
  narrow: (policy: SandboxPolicy, request: SandboxPolicyRequest) => SandboxPolicy,
): () => void {
  const prototype = Object.getPrototypeOf(service) as { resolve?: unknown } | null
  const original = prototype?.resolve
  if (prototype === null || typeof original !== 'function') {
    throw new Error('sandboxPolicy.resolve is not a prototype method; this host version is not supported')
  }
  const patched = function resolve(this: unknown, request?: SandboxPolicyRequest): SandboxPolicy {
    const policy = (original as (request?: SandboxPolicyRequest) => SandboxPolicy).call(this, request)
    return narrow(policy, request ?? {})
  }
  prototype.resolve = patched
  return () => {
    if (prototype.resolve === patched) prototype.resolve = original
  }
}
