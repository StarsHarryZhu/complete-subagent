# AGENTS.md

## 1. Role

The vitest specs. Module specs drive each host module with fake working-directory, subagent, LLM, and sandbox services and real temporary directories; the policy spec also patches a service registered in the real cordis, so the prototype patch is checked through the same tracing proxy the host hands out; the plugin spec runs `apply` against a fake host whose subagent runtime creates the child inside the start call, from delegation to dispose; the client spec loads the built browser bundle the way the page does and renders the settings page with real React under jsdom; two specs check the manifest and this documentation set.

## 2. Constraints

- Never call a real model, the network, or the user's DSH home: specs that load the entry point `DSH_HOME` at a temporary directory.
- Test directories live under the temp directory, which the fence always treats as writable, so out-of-reach paths must be spelled outside it.
- Fakes honor the host contracts the plugin relies on, such as the agent being its own scope key, `agent/created` firing before a child's first step, and a child recording the agent preset its start selects, else its parent's. The plugin fake is a current host by default, and with `legacy` it behaves like 0.2.1-rc.5: no `presetForSession`, no `tools.resolve`, and `when` dropped.
- The client spec reads `lib/client.js`, so run `node build.js` before the specs.

## 3. Contents

- `helpers.ts` — temporary directories, fake agents, and a fake working-directory service.
- `paths.test.ts` — resolving, canonicalizing, containment, and directory checks.
- `store.test.ts` — persistence, cache, malformed files, inherited marks, deletion, grant merging, and grant removal.
- `policy.test.ts` — narrowing, inherited access, fail-closed cases, single-file grants, the root of a granted file-tool call, failures staying in their session, "may modify", and the real cordis proxy patch.
- `access.test.ts` — sub-workspace choice, directory creation, `writable_paths` grants, and refusals.
- `models.test.ts` — the parent's route, model and effort choice under the settings and with `ownModel` off, defaults, refusals, and the description.
- `requests.test.ts` — the broker and all four tools: allow, narrow, deny, grant, revoke, refusals, nesting, inherited children, and an unreachable parent.
- `prompt.test.ts` — the delegation texts, the two contexts, and what a child is told reaches its grants.
- `scope.test.ts` — the `presets`, `childPreset`, and `ownModel` readers, reading a session's preset on both kinds of host, and which sessions the scope serves.
- `legacy.test.ts` — detecting an old host and the per-agent tool filters.
- `plugin.test.ts` — `apply` end to end against a fake host: binding before start, fork with a chosen model, rebuilding on settings changes, visibility, a failed start, inherited confinement, the `presets` setting (empty, served presets, other presets), the `childPreset` setting (a router and its workers, fork and empty), the `ownModel` setting (delegate, fork, an empty list), the `completeSubagent` service (replacing the list, no-op without `childPreset`, dispose, failures, a 0.2.1-rc.5 host), a 0.2.1-rc.5 host (filters, preset selection, each step, dispose, grants), failures staying inside the plugin, and the disabled path.
- `client.test.tsx` — the built settings page: summary, adding a model, limiting efforts, saving, and the add list.
- `manifest.test.ts` — package name, version, engine range, browser half, locale titles, bundle row, and built files.
- `agents-md.test.ts` — every folder carries a four-section English AGENTS.md whose Contents list is true.

## 4. Progress

- Done: all specs pass.
- Open: the real host is exercised only by hand in the web app, and rc.5's real services only by a throwaway script outside this repository.
- Goal later: nothing planned.
