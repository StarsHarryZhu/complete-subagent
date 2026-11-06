# AGENTS.md

## 1. Role

What both halves agree on: the package name, the plugin id (the bundle row id and settings form id, kept from the original spelling), and the shape of the live settings: the models a parent may choose for a child with their allowed reasoning efforts plus the write-access answer time, the agent presets the plugin serves, the preset `delegate` children run, and whether they may run the parent's own model. The host half reads these values when it builds the delegation tools and checks a call; the browser half reads and writes the models and the answer time on the settings page, and never the other three fields, which a bundle sets in its patch.

## 2. Constraints

- Pure data and functions with no imports, so it compiles into both halves.
- The readers accept anything and return clean values: malformed entries, repeated models, repeated efforts, and repeated or empty presets are dropped, a blank child preset reads as none, `ownModel` is off only when it is literally false, and an invalid answer time falls back to the default.

## 3. Contents

- `settings.ts` — the plugin id, the child model shapes, the `provider/model` key, and the readers for the five settings fields.

## 4. Progress

- Done: used by the host entry, the model choice, and the settings page.
- Open: nothing.
- Goal later: nothing planned.
