/**
 * The plugin's settings page on the Plugins screen.
 *
 * Edits the host half's live config (`models`, `requestTimeoutSeconds`)
 * through the host's settings form for the `complete-subagent` profile entry.
 * Models are added from the same catalog the model picker uses; each one's
 * efforts are checkboxes over what the catalog advertises. A saved model the
 * catalog no longer lists stays, marked unavailable, until it is removed.
 * @module complete-subagent/client/settings
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { MIN_TIMEOUT_SECONDS, modelKey, readModels, readTimeout } from '../shared/settings.ts'
import type { ChildModel } from '../shared/settings.ts'
import type { CatalogGroup, CatalogModel, ConfigFormLike, ConfigViewProps, PathOp, RemoteSessionLike, Translate } from './host.ts'
import { fallbackT } from './locales.ts'

/** The edited values. */
interface Values {
  readonly models: readonly ChildModel[]
  readonly requestTimeoutSeconds: number
}

/**
 * Read form values with defaults.
 * @param value - the form's accepted section.
 * @returns complete values.
 */
export function readValues(value: Record<string, unknown> | undefined): Values {
  return { models: readModels(value?.models), requestTimeoutSeconds: readTimeout(value?.requestTimeoutSeconds) }
}

/**
 * The edits that turn the stored values into the draft.
 * @param stored - the saved values.
 * @param draft - the edited values.
 * @returns one `set` per changed field.
 */
export function changes(stored: Values, draft: Values): PathOp[] {
  const ops: PathOp[] = []
  if (JSON.stringify(draft.models) !== JSON.stringify(stored.models)) {
    ops.push({ op: 'set', path: ['models'], value: draft.models.map(entry => ({ ...entry, reasoningEfforts: [...entry.reasoningEfforts] })) })
  }
  if (draft.requestTimeoutSeconds !== stored.requestTimeoutSeconds) {
    ops.push({ op: 'set', path: ['requestTimeoutSeconds'], value: draft.requestTimeoutSeconds })
  }
  return ops
}

/** One catalog model with its provider. */
interface Listed {
  readonly group: CatalogGroup
  readonly model: CatalogModel
}

/**
 * Build the settings component over the form and the catalog.
 * @param form - the `complete-subagent` settings form.
 * @param getSession - the live `ctx.remote.session`, for the model catalog.
 * @returns the `plugins.bundle.config` entry.
 */
export function createSettings(form: ConfigFormLike, getSession: () => RemoteSessionLike | undefined) {
  // The host form is a class instance: keep its methods bound.
  const subscribe = (listener: () => void) => form.subscribe(listener)
  const getSnapshot = () => form.getSnapshot()
  return function CompleteSubagentSettings(props: ConfigViewProps): ReactNode {
    const t = props.t ?? fallbackT
    const snapshot = useSyncExternalStore(subscribe, getSnapshot)
    const stored = readValues(snapshot.value)
    if (props.view === 'summary') {
      return stored.models.length === 0 ? t('settings.summary.none') : t('settings.summary.some', { count: stored.models.length })
    }
    return <SettingsPage form={form} stored={stored} ready={snapshot.status === 'ready'} writable={snapshot.writable !== false}
      revision={snapshot.revision} getSession={getSession} t={t} />
  }
}

function SettingsPage(props: {
  form: ConfigFormLike
  stored: Values
  ready: boolean
  writable: boolean
  revision: number | undefined
  getSession: () => RemoteSessionLike | undefined
  t: Translate
}): ReactNode {
  const { t, stored } = props
  const [draft, setDraft] = useState<Values>(stored)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [groups, setGroups] = useState<readonly CatalogGroup[]>()
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [adding, setAdding] = useState('')
  const storedKey = JSON.stringify(stored)
  // Re-seed the draft only when the stored values change, not on every render.
  useEffect(() => { setDraft(stored) }, [storedKey])

  useEffect(() => {
    let live = true
    const catalog = props.getSession()?.modelCatalog()
    if (catalog === undefined) {
      setCatalogFailed(true)
      return
    }
    catalog.then((response) => {
      if (!live) return
      if (response.ok && response.value) setGroups(response.value.groups)
      else setCatalogFailed(true)
    }, () => { if (live) setCatalogFailed(true) })
    return () => { live = false }
  }, [props.getSession])

  if (!props.ready) return <p className="complete-subagent-note">{t('settings.loading')}</p>
  const listed: Listed[] = (groups ?? []).flatMap(group => group.models.map(model => ({ group, model })))
  const find = (entry: { provider: string; model: string }) => listed.find(item => item.group.id === entry.provider && item.model.id === entry.model)
  const chosen = new Set(draft.models.map(modelKey))
  const addable = listed.filter(item => !chosen.has(modelKey({ provider: item.group.id, model: item.model.id })))
  const ops = changes(stored, draft)
  const disabled = !props.writable || status === 'saving'
  const update = (patch: Partial<Values>) => {
    setDraft(value => ({ ...value, ...patch }))
    setStatus('idle')
  }
  const setModels = (models: readonly ChildModel[]) => update({ models })
  const save = async () => {
    setStatus('saving')
    try {
      setStatus(await props.form.mutate(ops, props.revision) ? 'saved' : 'failed')
    } catch {
      setStatus('failed')
    }
  }
  const add = () => {
    const item = addable.find(candidate => modelKey({ provider: candidate.group.id, model: candidate.model.id }) === adding)
    if (item === undefined) return
    setModels([...draft.models, { provider: item.group.id, model: item.model.id, reasoningEfforts: [] }])
    setAdding('')
  }
  return (
    <div className="complete-subagent-settings">
      <section className="complete-subagent-section">
        <h3>{t('settings.models')}</h3>
        <p className="complete-subagent-note">{t('settings.models.hint')}</p>
        {draft.models.length === 0 && <p className="complete-subagent-note">{t('settings.models.empty')}</p>}
        <ul className="complete-subagent-models">
          {draft.models.map((entry, index) => {
            const item = find(entry)
            const advertised = item?.model.reasoning?.efforts ?? []
            const extra = entry.reasoningEfforts.filter(effort => !advertised.some(option => option.id === effort)).map(id => ({ id, name: id }))
            const options = [...advertised, ...extra]
            const toggle = (effort: string) => {
              const next = entry.reasoningEfforts.includes(effort)
                ? entry.reasoningEfforts.filter(value => value !== effort)
                : options.map(option => option.id).filter(id => id === effort || entry.reasoningEfforts.includes(id))
              setModels(draft.models.map((value, at) => (at === index ? { ...value, reasoningEfforts: next } : value)))
            }
            return (
              <li key={modelKey(entry)} className="complete-subagent-model">
                <div className="complete-subagent-model-head">
                  <span className="complete-subagent-model-name">{item?.model.name ?? entry.model}</span>
                  <code>{modelKey(entry)}</code>
                  {item === undefined && groups !== undefined && <span className="complete-subagent-tag">{t('settings.unavailable')}</span>}
                  <button type="button" className="complete-subagent-button" disabled={disabled}
                    onClick={() => setModels(draft.models.filter((_, at) => at !== index))}>
                    {t('settings.remove')}
                  </button>
                </div>
                {options.length === 0
                  ? <p className="complete-subagent-note">{t('settings.efforts.none')}</p>
                  : (
                      <fieldset className="complete-subagent-efforts" disabled={disabled}>
                        <legend>{t('settings.efforts')}<span className="complete-subagent-note">{t('settings.efforts.all')}</span></legend>
                        {options.map(option => (
                          <label key={option.id} className="complete-subagent-check">
                            <input type="checkbox" checked={entry.reasoningEfforts.includes(option.id)} onChange={() => toggle(option.id)} />
                            {option.name ?? option.id}
                          </label>
                        ))}
                      </fieldset>
                    )}
              </li>
            )
          })}
        </ul>
        <div className="complete-subagent-add">
          <select value={adding} disabled={disabled || addable.length === 0} onChange={event => setAdding(event.target.value)}
            aria-label={t('settings.add.placeholder')}>
            <option value="">{t('settings.add.placeholder')}</option>
            {(groups ?? []).map(group => {
              const models = addable.filter(item => item.group === group)
              if (models.length === 0) return null
              return (
                <optgroup key={group.id} label={group.name ?? group.id}>
                  {models.map(item => (
                    <option key={item.model.id} value={modelKey({ provider: group.id, model: item.model.id })}>{item.model.name ?? item.model.id}</option>
                  ))}
                </optgroup>
              )
            })}
          </select>
          <button type="button" className="complete-subagent-button" disabled={disabled || adding === ''} onClick={add}>{t('settings.add')}</button>
        </div>
        {catalogFailed && <p className="complete-subagent-note">{t('settings.catalogFailed')}</p>}
      </section>
      <section className="complete-subagent-section">
        <label className="complete-subagent-field">
          <span>{t('settings.timeout')}</span>
          <input type="number" min={MIN_TIMEOUT_SECONDS} step={1} value={draft.requestTimeoutSeconds} disabled={disabled}
            onChange={event => update({ requestTimeoutSeconds: Math.max(MIN_TIMEOUT_SECONDS, Math.round(Number(event.target.value) || MIN_TIMEOUT_SECONDS)) })} />
        </label>
        <p className="complete-subagent-note">{t('settings.timeout.hint', { min: MIN_TIMEOUT_SECONDS })}</p>
      </section>
      {!props.writable && <p className="complete-subagent-note">{t('settings.readonly')}</p>}
      <div className="complete-subagent-actions">
        <button type="button" className="complete-subagent-button" data-primary disabled={disabled || ops.length === 0} onClick={() => void save()}>
          {t('settings.save')}
        </button>
        {status === 'saved' && <span className="complete-subagent-note">{t('settings.saved')}</span>}
        {status === 'failed' && <span className="complete-subagent-error">{t('settings.failed')}</span>}
      </div>
    </div>
  )
}
