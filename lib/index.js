/**
 * complete-subagent host plugin.
 *
 * Adds its own delegation tools beside the official ones: `delegate` (a fresh
 * child) and `delegate_fork` (a child that inherits the conversation). The
 * `cwd` a parent passes becomes the child's sub-workspace, `writable_paths`
 * grants more up front, and the child may modify nothing else (besides temp
 * directories). For anything else it asks with `request_write_access`; the
 * parent answers with `answer_write_request`, and can grant or revoke at any
 * time with `grant_write_access` / `revoke_write_access`. A parent may also
 * pick the child's model and reasoning effort among those the user lists in
 * the settings. Children run on the host's subagent runtime; the fence narrows
 * the sandbox policy the host already enforces, and anything a confined agent
 * starts by other means is confined the same way. A bundle that mounts the
 * plugin for its own agent preset sets `presets`, and agents of other presets
 * then see none of it; it may also set `childPreset`, the preset `delegate`
 * children run, `ownModel: false`, which keeps those children on the listed
 * models, and the list itself at run time through the `completeSubagent` service.
 * @module complete-subagent
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, PLUGIN_ID, readChildPreset, readModels, readOwnModel, readPresets, readTimeout } from "./shared/settings.js";
import { withinCall } from "./host/call-scope.js";
import { canStart, createDelegateTool } from "./host/delegate.js";
import { isLegacyHost, ToolRestrictions } from "./host/legacy.js";
import { Fence, patchResolve } from "./host/policy.js";
import { childContext, pendingContext } from "./host/prompt.js";
import { RequestBroker } from "./host/requests.js";
import { presetScope } from "./host/scope.js";
import { BindingStore, defaultStoreDirectory } from "./host/store.js";
import { createAnswerTool, createGrantTool, createRequestTool, createRevokeTool } from "./host/tools.js";
import { ANSWER_TOOL, DELEGATE_TOOLS, GRANT_TOOL, REQUEST_TOOL, REVOKE_TOOL } from "./host/types.js";
export const name = PLUGIN_ID;
export const inject = ['tools', 'subagents', 'sandboxPolicy', 'workingDirectory', 'systemPrompt'];
export const Config = z.object({
    requestTimeoutSeconds: z.natural().min(MIN_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS)
        .description('Seconds a parent agent has to answer a write-access request before it counts as denied').volatile(),
    models: z.array(z.object({
        provider: z.string().min(1).required(),
        model: z.string().min(1).required(),
        reasoningEfforts: z.array(z.string().min(1)).default([]),
    })).default([])
        .description('Models a parent may choose for a child; an empty effort list allows every effort the model supports').volatile(),
    presets: z.array(z.string().min(1)).default([])
        .description('Agent presets whose agents get the tools and prompt texts; empty means every preset'),
    childPreset: z.string().default('')
        .description('Agent preset that children started with delegate run; empty keeps the parent\'s. delegate_fork children always keep it'),
    ownModel: z.boolean().default(true)
        .description('Whether delegate children may run the parent\'s own model. Off, with models listed, they run the first listed model unless the parent names another; delegate_fork children are not affected'),
});
/** The agent an assembly is for: `agent` when the host sets it, else the agent scope key. */
function agentOf(context) {
    if (context.agent !== undefined)
        return context.agent;
    const scope = context.scope;
    return typeof scope?.id === 'string' && scope.session !== undefined ? scope : undefined;
}
/** A live config value, or undefined when `apply` was called without the loader. */
function live(value) {
    return value?.get();
}
/**
 * Install the fence, the delegation tools, the write-access tools, and the
 * guidance.
 * @param ctx - the plugin context; the services in {@link inject} are present.
 * @param config - loaded settings.
 */
export function apply(ctx, config) {
    const host = ctx;
    const timeoutMs = () => readTimeout(live(config?.requestTimeoutSeconds)) * 1000;
    const childPreset = readChildPreset(config?.childPreset);
    let bundleModels;
    const models = () => bundleModels ?? readModels(live(config?.models));
    const serves = presetScope(readPresets(config?.presets), {
        agentPresets: () => host.get('agentPresets'),
        sessionProjections: () => host.get('sessionProjections'),
    });
    const legacy = isLegacyHost(host.tools);
    const store = new BindingStore(defaultStoreDirectory());
    const broker = new RequestBroker();
    const resolvePolicy = (session) => host.sandboxPolicy.resolve({ session });
    const warn = (message) => {
        try {
            ctx.logger.warn(message);
        }
        catch {
            // A host call must not fail because its warning could not be logged.
        }
    };
    // The host calls these for every session of every preset, and a throw would
    // fail a step or stop an agent from starting. A plugin failure stays here.
    const guarded = (label, fallback, run) => {
        try {
            return run();
        }
        catch (error) {
            warn(`${PLUGIN_ID}: ${label} failed: ${String(error)}`);
            return fallback;
        }
    };
    const fence = new Fence({ store, workingDirectory: host.workingDirectory, warn });
    let restore;
    try {
        restore = patchResolve(host.sandboxPolicy, (policy, request) => fence.narrow(policy, request));
    }
    catch (error) {
        warn(`${PLUGIN_ID} is disabled: ${String(error)}`);
        return;
    }
    ctx.effect(() => restore);
    // This listener adds no failure of its own; what `next` throws is the host's pipeline and stays its to handle.
    host.on('tools/execute', (call, next) => withinCall(call, next));
    // A child that a confined agent starts by other means (the official tools,
    // a workflow) shares that agent's access instead of the whole project. Only
    // a served parent passes it on; a child judged without its live parent is
    // judged by its own preset, which it took from that parent. When the parent's
    // preset cannot be read, the child is confined rather than freed.
    host.on('agent/created', ({ agent }) => {
        guarded('storing an inherited binding', undefined, () => {
            const { origin, parentSession } = agent.session.header;
            if (origin !== 'subagent' || parentSession === undefined)
                return;
            if (store.get(agent.id) !== undefined || store.get(parentSession) === undefined)
                return;
            if (!guarded('reading the parent preset', true, () => serves((host.get('agents')?.get(parentSession) ?? agent).session)))
                return;
            store.set({ version: 1, child: agent.id, parent: parentSession, workspace: null, grants: [], inherited: true });
        });
    });
    const tools = Object.keys(DELEGATE_TOOLS);
    const canDelegate = (agent) => serves(agent.session)
        && tools.some(tool => host.tools.get(tool, agent) !== undefined && canStart(host.subagents, tool, agent));
    const conditions = {
        delegate: (agent) => serves(agent.session) && canStart(host.subagents, 'delegate', agent),
        delegate_fork: (agent) => serves(agent.session) && canStart(host.subagents, 'delegate_fork', agent),
        [REQUEST_TOOL]: (agent) => {
            const binding = store.get(agent.id);
            return binding !== undefined && binding.inherited !== true && serves(agent.session);
        },
        [ANSWER_TOOL]: (agent) => canDelegate(agent) || (broker.pendingFor(agent.id).length > 0 && serves(agent.session)),
        [GRANT_TOOL]: canDelegate,
        [REVOKE_TOOL]: canDelegate,
    };
    const visible = (tool, agent) => guarded(`the visibility check of ${tool}`, false, () => conditions[tool](agent));
    // The schema lists the configured models, so settings changes rebuild the tools.
    const deps = {
        store,
        fence,
        broker,
        subagents: host.subagents,
        workingDirectory: host.workingDirectory,
        resolvePolicy,
        timeoutMs,
        llm: () => host.get('llm'),
        childPreset,
        ownModel: readOwnModel(config?.ownModel),
    };
    let mounted;
    const mount = () => {
        const list = models();
        const key = JSON.stringify(list);
        if (mounted?.key === key)
            return;
        // Build first, so a definition that fails to build leaves the old tools in place.
        const definitions = tools.map(tool => createDelegateTool(tool, list, deps));
        mounted?.dispose();
        const disposers = [];
        mounted = { key, dispose: () => { for (const dispose of disposers)
                dispose(); } };
        definitions.forEach((definition, index) => {
            const tool = tools[index];
            disposers.push(host.tools.register(definition, { when: ({ agent }) => visible(tool, agent) }));
        });
    };
    mount();
    let disposed = false;
    ctx.effect(() => () => {
        disposed = true;
        mounted?.dispose();
        mounted = undefined;
    });
    host.on('loader/volatile-update', () => {
        guarded('rebuilding the delegation tools', undefined, mount);
    });
    // Another loaded copy already holds this name; that is a known limit, not a reason to stop.
    guarded('providing the service', undefined, () => host.provide('completeSubagent', {
        setChildModels(list) {
            if (childPreset === undefined || disposed)
                return;
            bundleModels = readModels(list);
            guarded('rebuilding the delegation tools', undefined, mount);
        },
    }));
    ctx.effect(() => host.tools.register(createRequestTool(deps), { when: ({ agent }) => visible(REQUEST_TOOL, agent) }));
    ctx.effect(() => host.tools.register(createAnswerTool(deps), { when: ({ agent }) => visible(ANSWER_TOOL, agent) }));
    ctx.effect(() => host.tools.register(createGrantTool(deps), { when: ({ agent }) => visible(GRANT_TOOL, agent) }));
    ctx.effect(() => host.tools.register(createRevokeTool(deps), { when: ({ agent }) => visible(REVOKE_TOOL, agent) }));
    // This host drops `when`, so the same conditions become per-agent filters. A
    // step reads its tools before `agent/pre-step`, so a change seen there takes
    // effect on the agent's next step; a new agent is filtered before its first.
    if (legacy) {
        const restrictions = new ToolRestrictions(Object.keys(conditions), (tool, agent) => visible(tool, agent));
        const sync = (agent) => {
            guarded('updating the tool filter', undefined, () => restrictions.sync(agent));
        };
        ctx.effect(() => () => {
            guarded('lifting the tool filters', undefined, () => restrictions.dispose());
        });
        host.on('agent/created', ({ agent }) => sync(agent));
        host.on('agent/pre-step', ({ agent }, next) => {
            sync(agent);
            return next();
        });
        host.on('agent-preset/selected', (sessionId) => {
            const agent = guarded('finding the agent of a preset selection', undefined, () => host.get('agents')?.get(sessionId));
            if (agent !== undefined)
                sync(agent);
        });
        host.on('agent/disposed', ({ agent }) => restrictions.forget(agent));
        // Agents that were already running when the plugin loaded fire no `agent/created`.
        for (const agent of guarded('listing the live agents', [], () => host.get('agents')?.list?.() ?? []))
            sync(agent);
    }
    ctx.effect(() => host.systemPrompt.context({
        name: `${name}:child`,
        order: host.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 1,
        interpolate: false,
        required: true,
        text: context => guarded('the child context', '', () => {
            const agent = agentOf(context);
            const binding = agent === undefined || !serves(agent.session) ? undefined : fence.bindingOf(agent.session);
            return binding === undefined ? '' : childContext(binding, !legacy);
        }),
    }));
    ctx.effect(() => host.systemPrompt.context({
        name: `${name}:requests`,
        order: host.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 2,
        interpolate: false,
        required: true,
        text: context => guarded('the requests context', '', () => {
            const agent = agentOf(context);
            return agent === undefined || !serves(agent.session) ? '' : pendingContext(broker.pendingFor(agent.id));
        }),
    }));
}
