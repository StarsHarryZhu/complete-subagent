# AGENTS.md

## 1. Role

Plugin metadata the host's Plugins page reads through the package export `./locale/*.json`: the title and one-sentence description of the plugin in each supported language. The settings page's own copy is not here; it ships inside the browser half (`src/client/locales.ts`) and is registered with the page's locale service when the browser half loads.

## 2. Constraints

- Each file holds only `meta.title` and `meta.description`.
- The titles are pinned by `tests/manifest.test.ts`: "Complete Subagent" in English and its Chinese name in Chinese.
- English and Chinese say the same thing.

## 3. Contents

- `en.json` — English title and description.
- `zh.json` — Chinese title and description.

## 4. Progress

- Done: both languages.
- Open: nothing.
- Goal later: nothing planned.
