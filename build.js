/**
 * Build the published halves.
 *
 * 1. Type-check the host half (`tsconfig.json`: no DOM types).
 * 2. Emit the host half to `lib/` with `tsc` as plain ESM, which Node loads like
 *    any other package.
 * 3. Compile the browser half with `tsc` (`tsconfig.client.json`: no Node types)
 *    to CommonJS modules in `.client-build/`.
 * 4. Wrap every browser module in its own function inside one module-loader
 *    factory, `window.__ModuleLoader__.load({ id, factory })`, which is the only
 *    form the page's module system registers. Only the page's shared modules
 *    in {@link EXTERNALS} leave the bundle; any other request is a build error.
 * 5. Self-check: execute the bundle, call `apply(ctx)` exactly the way cordis
 *    does (`apply(ctx, config)` with no config), and require every registration
 *    to happen and every effect to clean up.
 *
 * The build has no dependency beyond the TypeScript compiler. `lib/` is generated:
 * edit `src/`, never `lib/`.
 * @module complete-subagent/build
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const LIB = join(ROOT, 'lib')
const CLIENT_OUT = join(ROOT, '.client-build')
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_NAME = PACKAGE.name

/** The browser module the factory returns: the plugin object. */
const ENTRY = 'client/index.js'

/** Requests the page's module table answers. Everything else must be bundled. */
const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

/** Stylesheets inlined as string modules: published request → source file. */
const STYLESHEETS = { 'client/styles.css': join(ROOT, 'src', 'client', 'styles.css') }

if (!existsSync(TSC)) fail(`TypeScript is not linked; run "node scripts/link-dev.mjs" first (looked for ${TSC})`)
tsc(['--noEmit', '-p', join(ROOT, 'tsconfig.json')], 'host typecheck')
rmSync(LIB, { recursive: true, force: true })
tsc(['-p', join(ROOT, 'tsconfig.build.json')], 'host emit')
assertNoTsSpecifiers(LIB)
rmSync(CLIENT_OUT, { recursive: true, force: true })
tsc(['-p', join(ROOT, 'tsconfig.client.json')], 'client compile')
const modules = collectModules()
const bundle = bundleClient(modules)
mkdirSync(LIB, { recursive: true })
writeFileSync(join(LIB, 'client.js'), bundle)
writeFileSync(join(LIB, 'client.modules.txt'), `/** Bundled client modules (${modules.length}):\n${modules.map(module => ` *   ${module.id}`).join('\n')}\n */\n`)
await selfCheck(bundle)
console.log(`build: lib/index.js, lib/host, lib/shared, lib/client.js (${modules.length} modules, ${Buffer.byteLength(bundle)} bytes); self-check passed`)

/** Run the TypeScript compiler, failing the build with its output. */
function tsc(args, label) {
  try {
    execFileSync(process.execPath, [TSC, ...args], { cwd: ROOT, stdio: 'pipe' })
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    fail(`${label} failed:\n${output}`)
  }
}

/** A host module that still imports `./x.ts` would not load in Node. */
function assertNoTsSpecifiers(directory) {
  for (const file of walk(directory)) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    if (/from\s+['"]\.{1,2}\/[^'"]+\.tsx?['"]/u.test(text)) fail(`${relative(ROOT, file)} still imports a .ts specifier`)
  }
}

/** Every compiled browser module plus the inlined stylesheets, with their requests checked. */
function collectModules() {
  const found = []
  for (const file of walk(CLIENT_OUT)) {
    if (!file.endsWith('.js')) continue
    found.push({ id: relative(CLIENT_OUT, file).split(sep).join('/'), body: readFileSync(file, 'utf8') })
  }
  for (const [id, source] of Object.entries(STYLESHEETS)) {
    found.push({ id, body: `"use strict";\nmodule.exports = ${JSON.stringify(readFileSync(source, 'utf8'))};\n` })
  }
  found.sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(found.map(module => module.id))
  if (!ids.has(ENTRY)) fail(`the client entry ${ENTRY} was not compiled`)
  for (const module of found) {
    for (const match of module.body.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)) {
      const request = match[1]
      if (request.startsWith('.')) {
        const target = resolveRequest(module.id, request)
        if (!ids.has(target)) fail(`${module.id} requires ${request}, which resolves to ${target} and was not built`)
      } else if (!EXTERNALS.includes(request)) {
        fail(`${module.id} requires "${request}"; the browser half may only use ${EXTERNALS.join(', ')} from outside the bundle`)
      }
    }
    if (/\b(?:eval\s*\(|new\s+Function\s*\()/u.test(module.body)) fail(`${module.id} evaluates code at runtime`)
  }
  return found
}

/** Resolve a relative request against a module id. */
function resolveRequest(from, request) {
  const parts = from.split('/')
  parts.pop()
  for (const part of request.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** Emit the factory registration. */
function bundleClient(found) {
  const definitions = found.map(module => [
    `    ${JSON.stringify(module.id)}: function (module, exports, require) {`,
    indent(module.body.trimEnd(), 6),
    '    },',
  ].join('\n')).join('\n')
  return `/* ${PACKAGE_NAME} ${PACKAGE.version} — generated by build.js from src/; do not edit. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_NAME)},
  factory: (require) => {
    "use strict";
    const definitions = {
${definitions}
    };
    const externals = new Set(${JSON.stringify(EXTERNALS)});
    const cache = Object.create(null);
    const resolve = (from, request) => {
      const parts = from.split("/");
      parts.pop();
      for (const part of request.split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      return parts.join("/");
    };
    const load = (id) => {
      const cached = cache[id];
      if (cached !== undefined) return cached.exports;
      if (!Object.hasOwn(definitions, id)) throw new Error(${JSON.stringify(`${PACKAGE_NAME}: missing bundled module `)} + id);
      const module = { exports: {} };
      cache[id] = module;
      definitions[id].call(module.exports, module, module.exports, (request) => {
        if (externals.has(request)) return require(request);
        if (request.startsWith(".")) return load(resolve(id, request));
        throw new Error(${JSON.stringify(`${PACKAGE_NAME}: `)} + id + " requested " + request + ", which this bundle does not provide");
      });
      return module.exports;
    };
    return load(${JSON.stringify(ENTRY)});
  },
});
`
}

/**
 * Execute the bundle and drive it through the real activation contract.
 *
 * `apply` is called the way cordis calls a page entry (`apply(ctx, undefined)`),
 * every contribution must register into its seat, and disposing must remove
 * every one of them and the stylesheet.
 */
async function selfCheck(source) {
  let registration
  const appended = []
  const fakeDocument = {
    head: { appendChild: (node) => { appended.push(node); node.parent = true } },
    createElement: () => ({
      attributes: {},
      textContent: '',
      setAttribute(name, value) { this.attributes[name] = value },
      remove() { this.parent = false },
    }),
  }
  new Function('window', 'document', source)({ __ModuleLoader__: { load: (value) => { registration = value } } }, fakeDocument)
  if (registration?.id !== PACKAGE_NAME) fail(`the bundle registered ${JSON.stringify(registration?.id)}, not ${PACKAGE_NAME}`)
  const react = loadReact()
  const requested = []
  const exports = registration.factory((request) => {
    requested.push(request)
    if (request === 'react') return react.react
    if (request === 'react/jsx-runtime') return react.jsx
    if (request === 'react-dom') return react.dom
    throw new Error(`unexpected require: ${request}`)
  })
  if (exports.name !== PACKAGE_NAME) fail('the client entry does not export its package name')
  if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) fail('the client entry must inject "slots"')
  if (typeof exports.apply !== 'function') fail('the client entry exports no apply function')
  for (const request of requested) if (!EXTERNALS.includes(request)) fail(`the bundle required ${request} at load`)

  const registered = []
  const disposers = []
  const slots = {
    inject: (name, callback) => { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) },
    register: (options, component) => {
      const entry = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    },
  }
  const dictionaries = []
  const services = {
    slots,
    locale: {
      register: (namespace) => { dictionaries.push(namespace); return () => dictionaries.splice(dictionaries.indexOf(namespace), 1) },
    },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    'remote.session': {},
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => undefined, mutate: async () => true }) },
  }
  const ctx = {
    get: name => services[name],
    effect: (execute) => { const dispose = execute(); if (typeof dispose === 'function') disposers.push(dispose) },
    inject: (deps, callback) => { if (deps.every(dep => services[dep] !== undefined)) callback(ctx) },
  }
  // Exactly what cordis does for a page entry: the second argument is the entry config, undefined.
  exports.apply.call(undefined, ctx, undefined)
  const keyed = name => registered.filter(entry => entry.name === name).map(entry => entry.key).sort()
  if (!keyed('plugins.bundle.config').includes(PACKAGE_NAME)) fail('apply(ctx) did not register the settings page')
  if (!dictionaries.includes(PACKAGE_NAME)) fail('apply(ctx) did not register the dictionaries')
  if (appended.length !== 1 || appended[0].attributes['data-plugin'] !== PACKAGE_NAME) fail('apply(ctx) did not mount exactly one tagged stylesheet')
  if (registered.length !== 1) fail(`apply(ctx) registered ${registered.length} slot entries; expected exactly 1`)
  for (const dispose of disposers.reverse()) dispose()
  if (registered.length !== 0 || dictionaries.length !== 0 || appended[0].parent !== false) {
    fail('disposing the plugin left a registration or the stylesheet behind')
  }
}

/** The development React when it is linked, otherwise a stand-in good enough to load modules. */
function loadReact() {
  const require = createRequire(join(ROOT, 'package.json'))
  try {
    return { react: require('react'), jsx: require('react/jsx-runtime'), dom: require('react-dom') }
  } catch {
    const unavailable = () => { throw new Error('React is not linked; run node scripts/link-dev.mjs') }
    return { react: { Component: class {}, Fragment: 'fragment', useState: unavailable }, jsx: { jsx: unavailable, jsxs: unavailable, Fragment: 'fragment' }, dom: { createPortal: unavailable } }
  }
}

/** Indent every non-empty line of a block. */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(line => (line === '' ? '' : pad + line)).join('\n')
}

/** Every file below a directory, recursively. */
function walk(directory) {
  if (!existsSync(directory)) return []
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(full))
    else found.push(full)
  }
  return found
}

/** Stop the build with a message. */
function fail(message) {
  console.error(`build: ${message}`)
  process.exit(1)
}
