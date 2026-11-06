# AGENTS.md

## 1. Role

The browser half: one settings page on the Plugins screen, registered as the `plugins.bundle.config` entry for this package. It edits the host half's live settings, the models a parent may choose for a child with the reasoning efforts each allows and the write-access answer time, through the host's settings form for the `complete-subagent` profile entry. Models are added from the same catalog the model picker reads, and each model's efforts are checkboxes over what the catalog advertises.

## 2. Constraints

- Import no harness package, not even for types: every host shape is a structural mirror in `host.ts`, with every field optional so an older host degrades instead of throwing.
- Runtime imports are only `react` and `react/jsx-runtime`; the build fails on anything else from outside the bundle.
- Saving writes only the changed fields, fenced by the revision the draft was read at, so `presets` and `childPreset`, which the page never shows, survive a save.
- A saved model the catalog no longer lists stays, marked unavailable, until the user removes it.
- Copy lives in `locales.ts` in Chinese and English; class names start with `complete-subagent-`.

## 3. Contents

- `index.ts` — the browser entry: dictionaries, stylesheet, model catalog access, and the settings page registration.
- `host.ts` — structural mirrors of the slot, locale, settings form, and catalog services.
- `settings.tsx` — the settings page and its summary line.
- `locales.ts` — the page copy in Chinese and English.
- `styles.css` — the page stylesheet over the host's design tokens.
- `css.d.ts` — the type of the inlined stylesheet module.

## 4. Progress

- Done: the page renders, adds and removes models, limits efforts, edits the answer time, and saves; covered by `tests/client.test.tsx` against the built bundle.
- Open: not yet checked in the real web app.
- Goal later: nothing planned.
