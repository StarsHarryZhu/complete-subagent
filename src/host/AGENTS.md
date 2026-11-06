# AGENTS.md

## 1. Role

The host modules. A delegation call decides the child's sub-workspace and `writable_paths` grants (`access.ts`) and its model and reasoning effort (`models.ts`), stores the binding under a reserved child id, and only then starts the child on the host's subagent runtime (`delegate.ts`); bindings and grants are stored per child session (`store.ts`); every sandbox policy the host resolves for a bound child, or for a child a confined agent started by other means, is narrowed to its access (`policy.ts`, with `call-scope.ts` for single-file grants); grants are issued under one authority rule (`grants.ts`); the child asks and the parent answers, grants, and revokes through four tools (`tools.ts`, with open requests in `requests.ts`); and the prompt texts explain all of it (`prompt.ts`). When the settings list agent presets, only the agents of those presets are served (`scope.ts`). What differs on a host older than 0.2.2-alpha.2 lives in `legacy.ts`.

## 2. Constraints

- All stored and compared paths are canonical (`paths.ts`), matching what the host's fs fence and Seatbelt profile compare.
- Additional writable roots must be existing physical directories, or the host rejects the whole policy; the fence drops anything else.
- 0.2.1-rc.5 reads only `workspaceRoot`, so the one file-tool call whose target lies in a grant is rooted at that grant; every other call keeps the sub-workspace, which is why shell commands cannot reach grants there.
- An agent may grant only what its own, possibly narrowed, policy lets it modify.
- A child's binding is stored before its start call and deleted if the start fails, so the fence applies from its first step and nothing is matched afterwards.
- An inherited binding holds no access of its own; the fence resolves it to the nearest ancestor's current access, and a broken chain leaves none.
- The delegation result text is `started subagent <id>`, as the official tools write it.
- Only a `spawn` start carries the configured `childPreset` as `agentPreset`; a `fork` start never selects a preset.
- A child's route goes only through the start's `agentOptions`, which both 0.2.1-rc.5 and 0.2.2-alpha.2 use for its first request; nothing selects a model afterwards.
- `ownModel` off applies to `delegate` only. On the parent's own route the host hands down the parent's effort unless one is named, so `models.ts` names the effort there.
- A model outside the list fails first in the tool's own `enum` check, with the host's "must be one of" message; the message in `models.ts` covers a call that gets past it.
- Requests live in memory only; bindings and grants are the only durable state.
- With presets listed, an agent whose preset cannot be read (no service, none recorded, a failure) is not served; an empty list serves every agent without reading a preset.
- A session's preset comes from `agentPresets.presetForSession` when the host has that method, since newer hosts deprecate the alternative, and otherwise from the `agentPreset` session projection.
- A `tools.restrict` filter belongs to the agent's own context, not the plugin's, so the plugin lifts it on dispose. It never reaches the agent's children, because an agent's scope chain leads to its preset, not its parent.
- A failure in the fence stays in the session it hit: a subagent falls back to read-only, a top-level session keeps the host's policy, and other sessions are not touched.
- No module imports a host package other than `@deepseek-ai/dsh-tools`; host shapes come from `types.ts`.

## 3. Contents

- `types.ts` — structural mirrors of the host services, the delegation tools and their backends, and the write-access tool names.
- `scope.ts` — reading a session's preset on any host, and which agents the plugin serves under the `presets` setting.
- `legacy.ts` — detecting a host older than 0.2.2-alpha.2, and the per-agent tool filters that replace `when` there.
- `paths.ts` — resolving, canonicalizing, and comparing paths.
- `store.ts` — per-child bindings and grants as JSON files under the DSH home.
- `call-scope.ts` — the running tool call, carried through async work.
- `policy.ts` — the fence: policy narrowing, the root of a granted file-tool call, inherited access, "may modify" checks, and the prototype patch.
- `access.ts` — the sub-workspace and `writable_paths` grants of a child about to start.
- `models.ts` — the parent's route, the child's model and effort choice under the settings and `ownModel`, and its description.
- `delegate.ts` — the `delegate` and `delegate_fork` tools, the child preset and the `ownModel` rule of a `delegate` start, and when they are offered.
- `grants.ts` — resolving requested paths and issuing grants within the grantor's reach.
- `requests.ts` — open write-access requests, answers, timeouts, and cancellation.
- `tools.ts` — `request_write_access`, `answer_write_request`, `grant_write_access`, and `revoke_write_access`.
- `prompt.ts` — the delegation descriptions and parameter texts, the child context, which says what reaches its grants on this host, and the open-requests context.

## 4. Progress

- Done: every module, covered by the specs in the tests folder.
- Verified in the real web app, before the move to standalone tools: the fence, grants, requests, and storage with the host's own sandbox enforcing the narrowed policy (2026-10-29 to 2026-11-01).
- Checked on the real rc.5 tool, prompt, projection, and sandbox-policy services (2026-11-02): `legacy.ts`, `scope.ts`, and the single-root grant, with stand-ins for agents and the subagent start.
- Checked on real 0.2.1-rc.5 and 0.2.2-alpha.2 hosts with a mock model (2026-11-02): `delegate.ts` and `models.ts`, from the tool call to the child's first recorded request.
- Open: `delegate.ts`, `models.ts`, `scope.ts`, `legacy.ts`, and inherited confinement are not yet verified in a real web app.
- Goal later: nothing planned.
