/**
 * Model-facing guidance. A parent reads the delegation and sub-workspace rules
 * in the `delegate` / `delegate_fork` descriptions and parameters; a bound
 * child reads its sub-workspace and grants in a runtime context; a parent with
 * open requests reads them in another.
 * @module complete-subagent/host/prompt
 */

import type { WriteRequest } from './requests.ts'
import type { Binding } from './store.ts'
import { ANSWER_TOOL, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL } from './types.ts'
import type { DelegateTool } from './types.ts'

/** What a delegation tool is for, by whether the child inherits this conversation. */
const PURPOSE: Readonly<Record<DelegateTool, string>> = {
  delegate: 'Delegate a self-contained task to a subagent: a separate agent that works in its own context, so the work '
    + '(research, a scoped implementation, an analysis) does not consume this conversation\'s context.',
  delegate_fork: 'Delegate a task to a subagent that inherits this conversation: a child seeded with all completed turns so far '
    + '(not the current in-flight turn). Use it when the subtask builds on this conversation\'s context, such as a follow-up '
    + 'analysis, a review, or a continuation, without consuming this conversation\'s context for the work itself.',
}

/** How a started child reports back and how to keep working meanwhile. */
const LIFECYCLE = 'It returns the subagent\'s id at once; the runtime notifies you with its result when it finishes. '
  + 'Use `send_message` to steer it while it runs or to continue its conversation afterwards. '
  + 'Start independent delegations together in one message and keep working; when only waiting remains, end your turn instead of polling.'

/** The sub-workspace rules every delegation tool states. */
const SUB_WORKSPACES = [
  'Sub-workspaces: the `cwd` you pass becomes the child\'s sub-workspace, created if missing, and the only place where it may modify files '
  + 'besides temporary directories and `writable_paths`. Without a `cwd`, or with one outside your own writable area, the child can read but not modify the workspace.',
  `A child that needs more sends you a "[write-access request wr-…]" message and is paused until you answer with \`${ANSWER_TOOL}\`. `
  + `You can also change a child's access at any time with \`${GRANT_TOOL}\` and \`${REVOKE_TOOL}\`. `
  + 'You can grant only paths you can modify yourself, and whatever your child starts is confined the same way.',
].join(' ')

/**
 * The description of one delegation tool.
 * @param tool - which tool.
 * @param models - the model-selection paragraph from `describeModels`.
 * @returns the full description.
 */
export function delegateDescription(tool: DelegateTool, models: string): string {
  const cache = tool === 'delegate_fork'
    ? ' Choosing another model loses the provider-side reuse of the inherited conversation.'
    : ''
  return `${PURPOSE[tool]} ${LIFECYCLE}\n\n${SUB_WORKSPACES}\n\n${models}${cache}`
}

/** The `prompt` parameter, by whether the child inherits this conversation. */
export const PROMPT_DESCRIPTION: Readonly<Record<DelegateTool, string>> = {
  delegate: 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.',
  delegate_fork: 'The task for the subagent. It already sees this conversation\'s completed turns, so build on them and state only what is new.',
}

/** The `cwd` parameter. */
export const CWD_DESCRIPTION = 'The child\'s sub-workspace and initial directory; relative paths use your current directory. '
  + 'It is created if missing, and the child may modify files only there (plus temporary directories and `writable_paths`). '
  + 'Omit it, or name a directory outside your own writable area, and the child can read but not modify the workspace. '
  + 'Later directory changes in either agent are independent.'

/** The `writable_paths` parameter. */
export const WRITABLE_PATHS_DESCRIPTION = 'Paths outside the sub-workspace that the child may also modify from the start, '
  + 'relative to your current directory or absolute. End a path with "/" (or name an existing directory) to grant the whole directory '
  + 'to every tool, including shell commands; a single file is writable through the write and edit tools only. '
  + 'You can grant only what you can modify yourself; the child asks you for anything else.'

/** The `model` parameter. */
export const MODEL_DESCRIPTION = 'The child\'s model as "provider/model", one of the listed choices. Omit it to use your own model.'

/** The `model` parameter when the child cannot run the parent's model. */
export const LISTED_MODEL_DESCRIPTION = 'The child\'s model as "provider/model", one of the listed choices. Omit it to use the first.'

/** The `reasoning_effort` parameter. */
export const EFFORT_DESCRIPTION = 'The child\'s reasoning effort id, such as "low", "high", or "max", among those its model allows. '
  + 'Use lower efforts for simple, mechanical work and higher ones for hard reasoning.'

/**
 * Runtime context for a bound child.
 * @param binding - the child's binding in force (inherited access already resolved).
 * @returns the context text.
 */
export function childContext(binding: Binding, shellReachesGrants = true): string {
  const lines = [
    binding.workspace === null
      ? 'Sub-workspace: none. You can read the workspace, but you may modify files only in temporary directories.'
      : `Sub-workspace: ${binding.workspace}. You may modify files only under this directory and temporary directories.`,
  ]
  const directories = binding.grants.filter(grant => grant.kind === 'dir').map(grant => grant.path)
  const files = binding.grants.filter(grant => grant.kind === 'file').map(grant => grant.path)
  const from = binding.inherited === true ? 'to the agent above you' : 'by your parent'
  const fileToolsOnly = '(write and edit tools only, not shell commands)'
  if (directories.length > 0) lines.push(`Also granted ${from} ${shellReachesGrants ? '(any tool)' : fileToolsOnly}: ${directories.join(', ')}`)
  if (files.length > 0) lines.push(`Also granted ${from} ${fileToolsOnly}: ${files.join(', ')}`)
  lines.push(binding.inherited === true
    ? 'Your parent is a confined subagent, so you share its access and cannot ask for more. If the task needs other paths, report that back instead.'
    : `To modify anything else, call \`${REQUEST_TOOL}\` with the exact paths and a short reason, and wait for the answer. `
      + 'This replaces approval: do not set `sandbox_permissions`.')
  return lines.join('\n')
}

/**
 * Runtime context for a parent with open requests.
 * @param requests - its open requests.
 * @returns the context text, or '' when none are open.
 */
export function pendingContext(requests: readonly WriteRequest[]): string {
  if (requests.length === 0) return ''
  return [
    `Write-access requests waiting for your \`${ANSWER_TOOL}\` answer (the subagents are paused):`,
    ...requests.map(request => `- ${request.id} from ${request.child}: ${request.paths.map(item => item.directory ? `${item.path}/` : item.path).join(', ')} — ${request.reason}`),
  ].join('\n')
}
