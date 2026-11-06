/**
 * The delegation tools: `delegate` starts a fresh child on the host's `spawn`
 * backend, `delegate_fork` one that inherits this conversation on `fork`.
 *
 * Children run on the host's own subagent runtime, so `send_message`,
 * `list_agents`, `interrupt_agent`, the child conversations in the UI, result
 * notices, and cold resume all work as they do for the official tools. The
 * call decides the child's access and route first, stores the binding under a
 * reserved child id, and only then starts the child, so the fence applies from
 * the child's first step and no binding has to be matched afterwards.
 * @module complete-subagent/host/delegate
 */
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { modelKey } from "../shared/settings.js";
import { decideAccess } from "./access.js";
import { chooseRoute, describeModels } from "./models.js";
import { CWD_DESCRIPTION, EFFORT_DESCRIPTION, LISTED_MODEL_DESCRIPTION, MODEL_DESCRIPTION, PROMPT_DESCRIPTION, WRITABLE_PATHS_DESCRIPTION, delegateDescription, } from "./prompt.js";
import { DELEGATE_TOOLS } from "./types.js";
/**
 * Build one delegation tool for the current settings. The model list is fixed
 * into the schema, so the entry rebuilds the tools when the settings change.
 * @param tool - which tool.
 * @param models - the settings' model list.
 * @param deps - shared state and services.
 * @returns a registry-ready definition.
 */
export function createDelegateTool(tool, models, deps) {
    const provider = DELEGATE_TOOLS[tool];
    // A fork continues the parent's conversation, so its own model stays the default there.
    const ownModel = provider === 'spawn' ? deps.ownModel !== false : true;
    return defineTool({
        name: tool,
        description: delegateDescription(tool, describeModels(models, ownModel)),
        parameters: {
            description: {
                type: 'string',
                required: true,
                description: 'A short (3-5 word) description of the delegated task, for display.',
            },
            prompt: { type: 'string', required: true, description: PROMPT_DESCRIPTION[tool] },
            cwd: { type: 'string', description: CWD_DESCRIPTION },
            writable_paths: { type: 'array', items: { type: 'string' }, description: WRITABLE_PATHS_DESCRIPTION },
            ...models.length === 0 ? {} : {
                model: { type: 'string', enum: models.map(modelKey), description: ownModel ? MODEL_DESCRIPTION : LISTED_MODEL_DESCRIPTION },
            },
            reasoning_effort: { type: 'string', description: EFFORT_DESCRIPTION },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    kind: { type: 'string', required: true, const: 'activation' },
                    subagentId: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `started subagent ${value.subagentId}` }],
        },
        isConcurrencySafe: () => true,
        async execute(raw, exec) {
            const args = raw;
            const parent = exec.agent;
            if (parent === undefined)
                throw new Error(`${tool} requires a calling agent`);
            const access = await decideAccess(deps, { parent, cwd: args.cwd, writablePaths: args.writable_paths, signal: exec.signal });
            const route = await chooseRoute({
                parent,
                models,
                request: { model: args.model, reasoning_effort: args.reasoning_effort },
                llm: deps.llm(),
                signal: exec.signal,
                ownModel,
            });
            exec.signal.throwIfAborted();
            const maxDepth = deps.subagents.resolveMaxDepth();
            // The fork backend inherits the parent's context, so only spawn may select a preset.
            const agentPreset = provider === 'spawn' ? deps.childPreset : undefined;
            const childId = deps.newId?.() ?? randomUUID();
            deps.store.set({ version: 1, child: childId, parent: parent.session.id, workspace: access.workspace, grants: access.grants });
            try {
                const started = await deps.subagents.startActivation({
                    provider,
                    label: args.description,
                    childId,
                    request: {
                        ...access.cwd === undefined ? {} : { cwd: access.cwd },
                        prompt: [{ type: 'text', text: args.prompt }],
                        parent,
                        ...agentPreset === undefined ? {} : { agentPreset },
                        ...route === undefined ? {} : { agentOptions: route },
                        ...maxDepth === undefined ? {} : { maxDepth },
                    },
                    signal: exec.signal,
                    delivery: 'parent',
                });
                return { kind: 'activation', subagentId: started.childId };
            }
            catch (error) {
                deps.store.delete(childId);
                throw error;
            }
        },
    });
}
/**
 * Whether an agent may delegate on a backend now: the backend is registered
 * and the agent is below the user's depth limit. A limit that cannot be read
 * leaves the tool visible; the runtime then rejects the start.
 * @param subagents - the subagent runtime.
 * @param tool - which tool.
 * @param agent - the would-be parent.
 * @returns true when the tool should be offered.
 */
export function canStart(subagents, tool, agent) {
    if (subagents.getProvider(DELEGATE_TOOLS[tool]) === undefined)
        return false;
    let maxDepth;
    try {
        maxDepth = subagents.resolveMaxDepth();
    }
    catch {
        return true;
    }
    if (maxDepth === undefined)
        return true;
    const depth = Math.max(agent.session.header.delegationDepth ?? 0, agent.options?.subagentDepth ?? 0);
    return depth < maxDepth;
}
