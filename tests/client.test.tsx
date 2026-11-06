// @vitest-environment jsdom
/**
 * The browser half through its real registration path: the built bundle is
 * loaded as the page loads it (a `__ModuleLoader__` registration whose factory
 * receives the module table's `require`), `apply(ctx)` runs as cordis runs it,
 * and the settings page renders with real React.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { changes, readValues } from '../src/client/settings.tsx'
import type { PathOp } from '../src/client/host.ts'

type Component = (props: Record<string, unknown>) => React.ReactNode

const CATALOG = {
  groups: [{
    id: 'ds',
    name: 'DeepSeek',
    models: [
      { id: 'flash', name: 'Flash', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
      { id: 'pro', name: 'Pro', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] } },
    ],
  }],
}

function loadClient(stored: Record<string, unknown>) {
  const source = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  let registration: { id: string; factory: (require: (request: string) => unknown) => Record<string, unknown> } | undefined
  new Function('window', source)({ __ModuleLoader__: { load: (value: never) => { registration = value } } })
  if (registration === undefined) throw new Error('the bundle did not register itself')
  const exports = registration.factory((request) => {
    if (request === 'react') return React
    if (request === 'react/jsx-runtime') return JsxRuntime
    if (request === 'react-dom') return ReactDom
    throw new Error(`no module ${request}`)
  })
  const registrations: Array<Record<string, unknown>> = []
  const mutations: { ops: readonly PathOp[]; revision?: number }[] = []
  // A real form keeps its snapshot reference stable until the next change.
  const snapshot = { status: 'ready', value: stored, writable: true, revision: 7 }
  const services: Record<string, unknown> = {
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ ...options, component })
        return () => undefined
      },
    },
    locale: { register: () => () => undefined },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: CATALOG }) } },
    'remote.session': {},
    configForms: {
      get: (id: string) => {
        if (id !== 'complete-subagent') throw new Error(`unexpected form ${id}`)
        return {
          getSnapshot: () => snapshot,
          subscribe: () => () => undefined,
          mutate: async (ops: readonly PathOp[], revision?: number) => { mutations.push({ ops, revision }); return true },
        }
      },
    },
  }
  const ctx = {
    get: (name: string) => services[name],
    effect: (execute: () => unknown) => { execute() },
    // Like cordis: a scope only runs once every dependency it names is present.
    inject: (deps: string[], callback: (scope: unknown) => void) => { if (deps.every(dep => services[dep] !== undefined)) callback(ctx) },
  }
  ;(exports.apply as (ctx: unknown) => void)(ctx)
  const Settings = registrations.find(entry => entry.name === 'plugins.bundle.config' && entry.key === '@starsharryzhu/complete-subagent')?.component as Component
  return { Settings, mutations }
}

afterEach(() => {
  cleanup()
})

describe('settings values', () => {
  it('reads stored values with defaults and drops malformed models', () => {
    expect(readValues(undefined)).toEqual({ models: [], requestTimeoutSeconds: 600 })
    expect(readValues({
      requestTimeoutSeconds: 3,
      models: [{ provider: 'ds', model: 'pro', reasoningEfforts: ['high', 'high', ''] }, { provider: 'ds', model: 'pro' }, { model: 'x' }],
    })).toEqual({ models: [{ provider: 'ds', model: 'pro', reasoningEfforts: ['high'] }], requestTimeoutSeconds: 600 })
  })

  it('writes only the fields that changed', () => {
    const stored = { models: [], requestTimeoutSeconds: 600 }
    expect(changes(stored, stored)).toEqual([])
    expect(changes(stored, { ...stored, requestTimeoutSeconds: 120 })).toEqual([{ op: 'set', path: ['requestTimeoutSeconds'], value: 120 }])
  })
})

describe('settings page', () => {
  it('summarizes the model list', () => {
    const { Settings } = loadClient({ models: [{ provider: 'ds', model: 'pro', reasoningEfforts: [] }] })
    render(<Settings view="summary" />)
    expect(document.body.textContent).toBe('1 models to choose for children')
    cleanup()
    const empty = loadClient({})
    render(<empty.Settings view="summary" />)
    expect(document.body.textContent).toBe('Children use their parent\'s model')
  })

  it('adds a catalog model, limits its efforts, and saves against the read revision', async () => {
    const { Settings, mutations } = loadClient({ models: [{ provider: 'ds', model: 'flash', reasoningEfforts: [] }, { provider: 'gone', model: 'old', reasoningEfforts: ['x'] }] })
    await act(async () => { render(<Settings view="page" />) })
    expect(screen.getByText('Flash')).toBeTruthy()
    expect(screen.getByText('Unavailable')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a model to add' }), { target: { value: 'ds/pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const pro = screen.getByText('Pro').closest('li') as HTMLElement
    fireEvent.click(pro.querySelectorAll('input[type="checkbox"]')[1])
    fireEvent.click(pro.querySelectorAll('input[type="checkbox"]')[0])
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '90' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(mutations).toEqual([{
      revision: 7,
      ops: [
        { op: 'set', path: ['models'], value: [
          { provider: 'ds', model: 'flash', reasoningEfforts: [] },
          { provider: 'ds', model: 'pro', reasoningEfforts: ['high', 'max'] },
        ] },
        { op: 'set', path: ['requestTimeoutSeconds'], value: 90 },
      ],
    }])
    expect(screen.getByText('Saved; it applies from the next step')).toBeTruthy()
  })

  it('offers only models that are not listed yet', async () => {
    const { Settings } = loadClient({ models: [{ provider: 'ds', model: 'flash', reasoningEfforts: [] }] })
    await act(async () => { render(<Settings view="page" />) })
    const options = [...screen.getByRole('combobox').querySelectorAll('option')].map(option => option.textContent)
    expect(options).toEqual(['Choose a model to add', 'Pro'])
  })
})
