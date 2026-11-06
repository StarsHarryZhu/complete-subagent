/**
 * The model-facing write-access tools: a bound child's `request_write_access`,
 * and its parent's `answer_write_request`, `grant_write_access`, and
 * `revoke_write_access`.
 *
 * A request reaches the parent through the host's adjacent-agent channel
 * (`ctx.subagents.sendMessage`): a running parent sees it at its next step, an
 * idle parent starts a turn. The child's call then waits for the answer, so a
 * granted child continues in the same turn. A parent can also grant or revoke
 * without a request; the child reads its current access in its runtime context
 * at every step, and the fence applies it to the next capability call.
 * @module complete-subagent/host/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { grantLine, issueGrants, requestedPaths } from './grants.ts'
import type { Fence } from './policy.ts'
import type { RequestBroker, WriteAnswer, WriteRequest } from './requests.ts'
import type { BindingStore } from './store.ts'
import { ANSWER_TOOL, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL } from './types.ts'
import type { AgentLike, SandboxPolicy, SessionLike, SubagentsLike, WorkingDirectoryLike } from './types.ts'

export { ANSWER_TOOL, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL }

/** What the tools read. */
export interface ToolDeps {
  readonly store: BindingStore
  readonly fence: Fence
  readonly broker: RequestBroker
  readonly subagents: SubagentsLike
  readonly workingDirectory: WorkingDirectoryLike
  /** The session's enforced (already narrowed) sandbox policy. */
  readonly resolvePolicy: (session: SessionLike) => SandboxPolicy
  /** How long a parent has to answer. */
  readonly timeoutMs: () => number
}

const GRANTED_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: ['dir', 'file'] },
    },
  },
} as const

const PATHS_DESCRIPTION = 'Relative to your current directory or absolute. End a path with "/" for a whole directory '
  + '(every tool, including shell commands); a single file is writable through the write and edit tools only.'

/** The message the parent receives. */
export function requestMessage(request: WriteRequest, timeoutMs: number): string {
  const where = request.workspace === null ? 'it has no sub-workspace' : `its sub-workspace is ${request.workspace}`
  return [
    `[write-access request ${request.id}] Subagent ${request.child} asks to modify paths outside its sub-workspace (${where}):`,
    ...request.paths.map(item => item.directory ? `- ${item.path}/ (directory)` : `- ${item.path}`),
    `Reason: ${request.reason}`,
    `It is paused until you answer with \`${ANSWER_TOOL}\` (request_id "${request.id}", decision "allow" or "deny"; `
    + `optional \`paths\` to grant a narrower set, optional \`message\` for the subagent). `
    + `Unanswered, it is denied after ${Math.round(timeoutMs / 60_000)} minutes.`,
  ].join('\n')
}

/** Render an answer for the child. */
function renderAnswer(answer: WriteAnswer): string {
  const lines = answer.decision === 'allow'
    ? ['Allowed. You may now modify:', ...answer.granted.map(grantLine)]
    : ['Denied. Do not modify these paths; continue within your sub-workspace or report back to your parent.']
  if (answer.message !== undefined && answer.message !== '') lines.push(`Parent's note: ${answer.message}`)
  return lines.join('\n')
}

/** The calling agent, which every tool here needs. */
function callerOf(exec: { agent?: unknown }, tool: string): AgentLike {
  const agent = exec.agent as AgentLike | undefined
  if (agent === undefined) throw new Error(`${tool} requires a calling agent`)
  return agent
}

/**
 * The caller's own bound child.
 * @returns the child session id.
 * @throws when the id is not a child the caller started through the delegation tools.
 */
function ownChild(deps: ToolDeps, parent: AgentLike, agentId: string): string {
  const id = agentId.trim()
  const binding = deps.store.get(id)
  if (binding?.parent !== parent.id || binding.inherited === true) {
    throw new Error(`"${id}" is not a subagent you started with \`delegate\` or \`delegate_fork\`.`)
  }
  return id
}

/**
 * The child-side tool.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export function createRequestTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: REQUEST_TOOL,
    description: 'Ask your parent agent for permission to modify paths outside your sub-workspace. '
      + 'You are paused until it answers; on "allow" the listed paths become writable for the rest of your work. '
      + 'End a path with "/" to ask for a whole directory (every tool, including shell commands); '
      + 'a single file is granted to the write and edit tools only.',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Paths to modify, relative to your current directory or absolute. Ask only for what the task needs.',
      },
      reason: {
        type: 'string',
        required: true,
        description: 'One or two sentences: what you will change there and why.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decision: { type: 'string', required: true, enum: ['allow', 'deny'] },
          granted: GRANTED_SCHEMA,
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderAnswer(value as WriteAnswer) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<WriteAnswer> {
      const child = callerOf(exec, REQUEST_TOOL)
      const binding = deps.store.get(child.id)
      if (binding === undefined || binding.inherited === true) {
        throw new Error(`${REQUEST_TOOL} is only for subagents started with \`delegate\` or \`delegate_fork\``)
      }
      if (args.paths.length === 0) throw new Error('List at least one path')
      const base = await deps.workingDirectory.ensure(child, exec.signal)
      const request = deps.broker.open({
        child: child.id,
        parent: binding.parent,
        workspace: binding.workspace,
        paths: requestedPaths(base, args.paths),
        reason: args.reason.trim(),
      })
      try {
        await deps.subagents.sendMessage(child, binding.parent, [{ type: 'text', text: requestMessage(request, deps.timeoutMs()) }], { signal: exec.signal })
      } catch (error) {
        deps.broker.close(request.id)
        if (exec.signal.aborted) throw error
        return { decision: 'deny', granted: [], message: `Your parent agent could not be reached (${error instanceof Error ? error.message : String(error)}); nothing was granted.` }
      }
      return await deps.broker.wait(request.id, deps.timeoutMs(), exec.signal)
    },
  })
}

/**
 * The parent-side answer.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export function createAnswerTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: ANSWER_TOOL,
    description: 'Answer a write-access request from one of your subagents (a message tagged "[write-access request wr-…]"). '
      + 'The subagent is paused until you answer. You can grant only paths you can modify yourself.',
    parameters: {
      request_id: { type: 'string', required: true, description: 'The id from the request, like "wr-1a2b3c".' },
      decision: { type: 'string', required: true, enum: ['allow', 'deny'] },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: `Allow only: the paths to grant instead of the requested ones. ${PATHS_DESCRIPTION} Omit to grant exactly what was requested.`,
      },
      message: { type: 'string', description: 'Optional note for the subagent, such as why you denied or narrowed the request.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          request_id: { type: 'string', required: true },
          decision: { type: 'string', required: true, enum: ['allow', 'deny'] },
          granted: GRANTED_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.decision === 'allow'
          ? [`Allowed ${value.request_id}. The subagent may now modify:`, ...value.granted.map(grant => grantLine(grant as { path: string; kind: 'dir' | 'file' }))].join('\n')
          : `Denied ${value.request_id}.`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = callerOf(exec, ANSWER_TOOL)
      const id = args.request_id.trim()
      const open = (): WriteRequest => {
        const request = deps.broker.get(id)
        if (request === undefined) throw new Error(`No open write-access request "${id}": it was already answered, timed out, or was cancelled.`)
        if (request.parent !== parent.id) throw new Error(`Request "${id}" was sent to another agent.`)
        return request
      }
      const request = open()
      const message = args.message?.trim()
      const note = message === undefined || message === '' ? {} : { message }
      if (args.decision === 'deny') {
        deps.broker.settle(id, { decision: 'deny', granted: [], ...note })
        return { request_id: id, decision: 'deny' as const, granted: [] }
      }
      const targets = args.paths === undefined
        ? request.paths
        : requestedPaths(await deps.workingDirectory.ensure(parent, exec.signal), args.paths)
      if (targets.length === 0) throw new Error('Grant at least one path, or deny the request')
      open()
      const grants = issueGrants({ fence: deps.fence, store: deps.store, grantor: parent, policy: deps.resolvePolicy(parent.session), targets, requestId: id })
      deps.store.addGrants(request.child, grants)
      const granted = grants.map(grant => ({ path: grant.path, kind: grant.kind }))
      deps.broker.settle(id, { decision: 'allow', granted, ...note })
      return { request_id: id, decision: 'allow' as const, granted }
    },
  })
}

/**
 * The parent-side grant without a request.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export function createGrantTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: GRANT_TOOL,
    description: 'Let one of your subagents modify more paths without waiting for it to ask, for example when you give it follow-up work. '
      + 'A running subagent sees the new access at its next step. You can grant only paths you can modify yourself.',
    parameters: {
      agent_id: { type: 'string', required: true, description: 'The subagent id returned when you started it.' },
      paths: { type: 'array', required: true, items: { type: 'string' }, description: `Paths to grant. ${PATHS_DESCRIPTION}` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent_id: { type: 'string', required: true },
          granted: GRANTED_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [`Granted to ${value.agent_id}:`, ...value.granted.map(grant => grantLine(grant as { path: string; kind: 'dir' | 'file' }))].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = callerOf(exec, GRANT_TOOL)
      const child = ownChild(deps, parent, args.agent_id)
      if (args.paths.length === 0) throw new Error('List at least one path')
      const targets = requestedPaths(await deps.workingDirectory.ensure(parent, exec.signal), args.paths)
      const grants = issueGrants({ fence: deps.fence, store: deps.store, grantor: parent, policy: deps.resolvePolicy(parent.session), targets, requestId: 'grant' })
      deps.store.addGrants(child, grants)
      return { agent_id: child, granted: grants.map(grant => ({ path: grant.path, kind: grant.kind })) }
    },
  })
}

/**
 * The parent-side revocation.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export function createRevokeTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: REVOKE_TOOL,
    description: 'Take back paths you granted to one of your subagents. It takes effect at once, also for a running subagent. '
      + 'The sub-workspace itself cannot be revoked.',
    parameters: {
      agent_id: { type: 'string', required: true, description: 'The subagent id returned when you started it.' },
      paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Granted paths to take back, relative to your current directory or absolute.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent_id: { type: 'string', required: true },
          revoked: GRANTED_SCHEMA,
          not_granted: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = value.revoked.length === 0
          ? [`Nothing revoked from ${value.agent_id}.`]
          : [`Revoked from ${value.agent_id}:`, ...value.revoked.map(grant => grantLine(grant as { path: string; kind: 'dir' | 'file' }))]
        if (value.not_granted.length > 0) lines.push(`Not granted, so nothing to revoke: ${value.not_granted.join(', ')}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = callerOf(exec, REVOKE_TOOL)
      const child = ownChild(deps, parent, args.agent_id)
      const paths = requestedPaths(await deps.workingDirectory.ensure(parent, exec.signal), args.paths).map(target => target.path)
      const removed = deps.store.removeGrants(child, paths)
      const gone = new Set(removed.map(grant => grant.path))
      return {
        agent_id: child,
        revoked: removed.map(grant => ({ path: grant.path, kind: grant.kind })),
        not_granted: paths.filter(path => !gone.has(path)),
      }
    },
  })
}
