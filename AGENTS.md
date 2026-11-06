# AGENTS.md

## 1. Role

complete-subagent is a DeepSeek Harness plugin with its own delegation tools beside the official ones: `delegate` starts a fresh child and `delegate_fork` a child that inherits the conversation. The `cwd` a parent passes becomes the child's sub-workspace and `writable_paths` grants more up front; the child may modify files only there (plus temporary directories). To modify anything else it calls `request_write_access` and is paused until the parent answers with `answer_write_request`; the parent can also grant or revoke at any time with `grant_write_access` and `revoke_write_access`. A parent may choose the child's model and reasoning effort among the models the user lists on the plugin's settings page. Children run on the host's own subagent runtime, so messaging, the child conversations in the UI, result notices, and cold resume behave as for the official tools, which stay installed and untouched. Access is enforced by narrowing the sandbox policy the host already applies to bash, file tools, terminals, and code mode, and anything a confined agent starts by other means is confined the same way. The `presets` setting limits the tools and prompt texts to the agents of the listed agent presets: empty (the default) serves every preset. The `childPreset` setting names the agent preset `delegate` children run instead of their parent's. The `ownModel` setting, on by default, can keep `delegate` children off the parent's own model, and a bundle can set the model list at run time through the `completeSubagent` service. The `dsh-assisstant` bundle mounts the plugin as a sub-plugin with `presets: [dsh-assisstant, dsh-assisstant-worker]` and `childPreset: dsh-assisstant-worker`: the assistant's router sessions delegate and approve, and their workers do the work. The plugin supports hosts from 0.2.1-rc.5 on and reads what each host offers; `src/host/legacy.ts` holds what differs on a host older than 0.2.2-alpha.2.

## 2. Constraints

- Never modify the harness checkout, the official subagent packages, or a preset: the plugin is one top-level bundle row that works in every preset.
- With `presets` empty the plugin behaves exactly as without the setting. With presets listed, an agent whose session does not run one of them (as `agentPresets.presetForSession` reports, or on 0.2.1-rc.5 the `agentPreset` session projection, including none recorded) sees no tool and no prompt text, and neither it nor its children get a binding; the fence itself is not scoped and keeps enforcing every binding that exists.
- With `childPreset` empty (the default) a child keeps its parent's preset, as without the setting. Set, it goes with every `delegate` start as `agentPreset`; `delegate_fork` never selects a preset, because the fork backend inherits the parent's context and the host refuses a preset there. A child is served by its own preset, so a bundle that lists `presets` lists `childPreset` there too.
- With `ownModel` on (the default) nothing changes. Off, with models listed, a `delegate` child runs only listed models: an omitted model is the first one, an effort-only call sets that model's effort, the parent's own model cannot be chosen unless it is listed, and an omitted effort never comes from the parent. An empty list leaves the usual rules. `delegate_fork` never follows the setting, though it offers the same list.
- `ctx.completeSubagent.setChildModels` replaces the `models` setting in memory until the row reloads, and rebuilds the delegation tools. It does nothing on a copy without `childPreset`, because that is a standalone install whose list belongs to the user's normal sessions.
- The settings page never shows `presets`, `childPreset`, or `ownModel`: a bundle that mounts the plugin sets them in its patch.
- Never register a tool named `subagent` or `subagent_fork`, and never change the official definitions: the official tools stay exactly as the host ships them.
- Host runtime imports are limited to `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-tools`, and Node built-ins; the browser half uses only the page's `react` and `react/jsx-runtime`. Other host types are structural mirrors.
- The only host behavior changed is `ctx.sandboxPolicy.resolve`, wrapped on its prototype while the plugin is loaded and restored on dispose; without that method the plugin logs a warning and stays disabled.
- Fail closed: a child is bound before it starts, a failed start drops its binding, and an uncertain inherited chain leaves no access.
- A plugin failure must not reach the host: event listeners, visibility checks, and prompt texts run for every session of every preset, so they log a warning and fall back instead of throwing. `tools/execute` passes through only what `next` throws, which is the host's own pipeline.
- A host older than 0.2.2-alpha.2 silently drops `when` and ignores `additionalWritableRoots`. The plugin must keep working there: the same visibility conditions become per-agent `tools.restrict` filters, and a granted `write` or `edit` call is rooted at its grant. Newer hosts are detected by `ctx.tools.resolve`, which arrived with `when`, and never get the filters.
- Package identity: `@starsharryzhu/complete-subagent` version `0.1.0`, `engines.dsh` `>=0.2.1-rc.5 <0.3.0-0`; `tests/manifest.test.ts` pins them.
- `lib/` is generated by `node build.js` and committed, because `link:` and git installs do not build.
- Every folder carries this four-section English file; `tests/agents-md.test.ts` enforces it.

## 3. Contents

- `src` — plugin source: the host entry, the host modules, the settings page, and the shared settings shape.
- `tests` — vitest specs with fake host services, the built settings page under jsdom, and the documentation check.
- `scripts` — the development toolchain linker.
- `locale` — Plugins page title and description in English and Chinese.
- `lib` — generated build output (committed).
- `build.js` — type-check, emit the host half, bundle and self-check the browser half.
- `cordis.patch.yml` — the bundle patch: one top-level row with default settings.
- `package.json` — identity, peers, engine range, `dsh.bundle.patch`, and the browser half.
- `tsconfig.json` — host type-check settings.
- `tsconfig.build.json` — host emit settings for `lib/`.
- `tsconfig.client.json` — browser half compile settings.
- `vitest.config.ts` — test runner settings.
- `README.md` — user documentation in Chinese.
- `.gitignore` — ignores dependencies, browser compile output, and local notes, keeps `lib/`.
- `.github/workflows/publish.yml` — tag-triggered npm publish with OIDC provenance.

## 4. Progress

- Done (2026-11-01): standalone `delegate` / `delegate_fork` on the host's `spawn` and `fork` backends with sub-workspaces, `writable_paths`, reserved child ids bound before start, model and reasoning-effort choice limited by the settings, a settings page on the Plugins screen, inherited confinement for children a confined agent starts by other means, and the four write-access tools; all specs pass.
- Done (2026-11-01): the `presets` setting, so `dsh-assisstant` can mount the plugin for its hidden presets only, and the `childPreset` setting for its two-layer router and worker design; version `0.1.0` is published on npm.
- Done (2026-11-05): the package source is at StarsHarryZhu/complete-subagent with a tag-triggered publish workflow; its npm trusted publisher is configured and pending validation, which the next version tag will complete.
- Done (2026-11-02): support for DSH Desktop 0.2.1-rc.5, which has neither `presetForSession` nor `when` nor `additionalWritableRoots`, and no plugin failure reaches the host. The built plugin passed a throwaway check on the real rc.5 tool, prompt, projection, and sandbox-policy services, with small stand-ins for the agents, the subagent start, and the working directory; the host's real subagent start and the web app are not exercised on rc.5.
- Done (2026-11-02): the `ownModel` setting and the `completeSubagent` service, so a bundle can offer only the worker models it picks. A throwaway check on real hosts, 0.2.1-rc.5 and the 0.2.2-alpha.2 checkout, with a mock model and two probe presets, read each child's first recorded request: it runs the chosen model and effort on both, through the host's real subagent start. A standalone row ignored the service on both. The `dsh-assisstant` bundle itself was not part of that check.
- Carried over from dsh-better-subagent and verified there in the web app (host 0.2.2-alpha.2, 2026-10-29 to 2026-11-01): the kernel-level fence for the write tool and bash, file and directory grants, denials with notes, read-only children without `cwd`, parallel children, grants after a restart and cold resume, a four-child team run, `writable_paths`, grant, and revoke.
- Open: the new tools, the model choice, the settings page, inherited confinement, and the `presets`, `childPreset`, and `ownModel` settings are not yet verified in the web app; the desktop app, which runs 0.2.1-rc.5, is not verified.
- Known limits on 0.2.1-rc.5: shell commands cannot reach any grant, only `write` and `edit` can, and the child context says so; a visibility change other than a new agent or a preset selection takes effect on the agent's next step, so a parent at the depth limit that gets a request sees `answer_write_request` one step late, and the request may time out as denied.
- Known limits: children started outside a confined agent by anything but `delegate` / `delegate_fork` (the official tools, workflows, other plugins' agents such as Mnemon's review agents) keep the official behavior; a single granted file is writable through the `write` and `edit` tools only, not shell commands; a request reaches a parent that is inside a long tool call only at its next step; the web UI draws the new tools' calls as generic tool cards; with `presets` listed, a child a confined agent starts in another preset stays confined but is not told so, and a binding stored while its session was served keeps its fence but loses its tools and texts, and its new children are not confined; two loaded copies of the plugin (a standalone row and a bundle's sub-plugin row) would register the same tool names.
- Goal later: nothing planned.
