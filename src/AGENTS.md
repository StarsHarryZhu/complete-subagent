# AGENTS.md

## 1. Role

The plugin source. `index.ts` is the host entry the bundle row loads: it declares the injected services and the live settings, wraps the sandbox policy, registers the two delegation tools (rebuilt when the model settings change or a bundle sets the list through the `completeSubagent` service) and the four write-access tools, confines children that confined agents start by other means, and adds the child and open-request contexts to the prompt, all of it only for the agents of the configured `presets` when any are listed. On a host that ignores `when`, it applies the same visibility conditions as per-agent filters. Everything with logic lives in `host/`, so the entry stays a readable wiring diagram. `client/` is the browser half, the settings page, and `shared/` holds the settings shape both halves read.

## 2. Constraints

- The host entry exports only `name`, `inject`, `Config`, and `apply`, plus types: no default export and no top-level `await`, as the host loader requires.
- Every host registration goes through `ctx.effect` or `ctx.on`, or is disposed by an effect, so unloading the plugin removes all of it and restores the sandbox policy.
- A callback the host runs for every session (an event listener, a visibility check, a prompt text) logs a warning and falls back rather than throwing, so a plugin failure cannot stop a step or an agent start.
- `host/` never imports from `client/`, and `client/` never imports from `host/`; both may import `shared/`.
- Source files import siblings with `.ts` specifiers; the build rewrites them.

## 3. Contents

- `index.ts` — the host entry: services, live settings, the `completeSubagent` service, and wiring.
- `host` — the fence, delegation, access, model choice, grants, requests, tools, prompts, storage, and path helpers.
- `client` — the settings page on the Plugins screen.
- `shared` — the settings shape and readers used by both halves.

## 4. Progress

- Done: entry wiring for every module and both halves, including the `presets` scope on every tool, both contexts, and inherited bindings, one table of visibility conditions for both kinds of host, and failure guards on every host callback; the `completeSubagent` service.
- Open: nothing.
- Goal later: nothing planned.
